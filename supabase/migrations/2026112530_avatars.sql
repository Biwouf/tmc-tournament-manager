-- Photo de profil, socle (P1-a du brief compte/profil v3.2, §6.1 à §6.4 ; 25/11/2026).
-- À appliquer avant la PWA. Aucune écriture sur les données existantes.
-- * profile_details (lisible de son seul propriétaire) porte le chemin et l'année de naissance,
--   jamais profiles, lisible par anon.
-- * Bucket privé `avatars`, fichiers `{user}/{version}-512` et `{user}/{version}-128`, sans extension
--   (le type, WebP ou JPEG, est celui enregistré par Storage). Jamais d'écrasement : pas de policy UPDATE.
-- * Verrou mineurs en base : sans année connue, la personne est traitée comme mineure.
-- Reportés à P1-c : club_member_remove_avatar (avec son Edge Function), team_compo_*, club-members.
BEGIN;

ALTER TABLE public.profile_details
  ADD COLUMN avatar_path text UNIQUE,
  ADD COLUMN avatar_updated_at timestamptz,
  ADD COLUMN avatar_removed_reason text,
  ADD COLUMN birth_year smallint CHECK (birth_year BETWEEN 1900 AND 2100),
  -- `{user}/{version}`, toujours dans le dossier de la personne.
  ADD CONSTRAINT profile_details_avatar_path_check
    CHECK (avatar_path ~ ('^' || user_id::text || '/[0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12}$'));

-- Actions d'un admin sur le profil d'une personne (année corrigée ; photo retirée en P1-c).
CREATE TABLE public.profile_admin_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  club_id uuid NOT NULL REFERENCES public.clubs(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  actor_id uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  action text NOT NULL,
  details jsonb NOT NULL DEFAULT '{}',
  created_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.profile_admin_events ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.profile_admin_events FROM anon, authenticated;

-- ============================================================
-- Helpers internes : jamais exécutables par le client (sinon, test de l'âge d'un autre).
-- ============================================================
-- Prudent : mineur tant que l'année courante moins l'année de naissance vaut au plus 18,
-- et tant que l'année est inconnue (ou le profil absent).
CREATE FUNCTION public.is_minor(p_user uuid) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
  SELECT coalesce(
    (SELECT extract(year FROM now() AT TIME ZONE 'Europe/Paris')::int - birth_year <= 18
       FROM profile_details WHERE user_id = p_user), true)
$$;

-- Qui voit la photo de p_owner : soi, les super-admins et, s'il est majeur, les membres
-- d'un club actif dont il est aussi membre.
CREATE FUNCTION public.avatar_readable(p_owner uuid) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
  SELECT auth.uid() IS NOT NULL AND (
    p_owner = auth.uid()
    OR is_super_admin()
    OR (NOT is_minor(p_owner) AND EXISTS (
      SELECT 1 FROM club_members a
        JOIN club_members b ON b.club_id = a.club_id
        JOIN clubs c ON c.id = a.club_id AND c.status = 'active'
       WHERE a.user_id = auth.uid() AND b.user_id = p_owner)))
$$;
REVOKE ALL ON FUNCTION public.is_minor(uuid), public.avatar_readable(uuid) FROM PUBLIC, anon, authenticated;

-- ============================================================
-- Bucket et policies (comparaisons en texte, aucun cast ::uuid : cf. 20260822)
-- ============================================================
INSERT INTO storage.buckets(id, name, public, file_size_limit, allowed_mime_types)
  VALUES ('avatars', 'avatars', false, 307200, ARRAY['image/webp', 'image/jpeg']);

-- Les autres ne lisent que la photo en cours : un ancien fichier, ou une photo retirée dont le
-- fichier n'est pas encore supprimé, n'est plus lisible que de son propriétaire.
CREATE FUNCTION public.avatar_object_readable(p_name text) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
  SELECT auth.uid() IS NOT NULL AND (
    split_part(p_name, '/', 1) = auth.uid()::text
    OR (p_name ~ '-(512|128)$' AND EXISTS (
      SELECT 1 FROM profile_details d
       WHERE d.avatar_path = left(p_name, -4) AND avatar_readable(d.user_id))))
$$;
CREATE FUNCTION public.avatar_object_writable(p_name text) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
  SELECT auth.uid() IS NOT NULL
    AND p_name ~ ('^' || auth.uid()::text || '/[0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12}-(512|128)$')
    AND NOT is_minor(auth.uid())
$$;
REVOKE ALL ON FUNCTION public.avatar_object_readable(text), public.avatar_object_writable(text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.avatar_object_readable(text), public.avatar_object_writable(text) TO authenticated;

CREATE POLICY avatars_read ON storage.objects FOR SELECT TO authenticated
  USING (bucket_id = 'avatars' AND public.avatar_object_readable(name));
CREATE POLICY avatars_insert_own ON storage.objects FOR INSERT TO authenticated
  WITH CHECK (bucket_id = 'avatars' AND public.avatar_object_writable(name));
CREATE POLICY avatars_delete_own ON storage.objects FOR DELETE TO authenticated
  USING (bucket_id = 'avatars' AND split_part(name, '/', 1) = auth.uid()::text);

-- ============================================================
-- RPC
-- ============================================================
-- Pose la photo déjà envoyée (les deux tailles) et renvoie l'ancien chemin, à supprimer par
-- l'API Storage après le toast ; NULL s'il n'y en avait pas, ou si c'est la même version.
CREATE FUNCTION public.profile_set_avatar(p_version uuid) RETURNS text
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  me uuid := auth.uid();
  new_path text := auth.uid()::text || '/' || p_version::text;
  old_path text;
BEGIN
  IF me IS NULL THEN RAISE EXCEPTION 'FORBIDDEN'; END IF;
  IF p_version IS NULL THEN RAISE EXCEPTION 'VALIDATION_ERROR'; END IF;
  SELECT avatar_path INTO old_path FROM profile_details WHERE user_id = me FOR UPDATE;
  IF is_minor(me) THEN RAISE EXCEPTION 'AVATAR_LOCKED'; END IF;
  IF (SELECT count(*) FROM storage.objects
       WHERE bucket_id = 'avatars' AND name IN (new_path || '-512', new_path || '-128')) <> 2 THEN
    RAISE EXCEPTION 'AVATAR_MISSING';
  END IF;
  UPDATE profile_details
     SET avatar_path = new_path, avatar_updated_at = now(), avatar_removed_reason = NULL
   WHERE user_id = me;
  RETURN nullif(old_path, new_path);
END $$;

CREATE FUNCTION public.profile_clear_avatar() RETURNS text
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  me uuid := auth.uid();
  old_path text;
BEGIN
  IF me IS NULL THEN RAISE EXCEPTION 'FORBIDDEN'; END IF;
  SELECT avatar_path INTO old_path FROM profile_details WHERE user_id = me FOR UPDATE;
  IF old_path IS NOT NULL THEN
    UPDATE profile_details SET avatar_path = NULL, avatar_updated_at = now() WHERE user_id = me;
  END IF;
  RETURN old_path;
END $$;

-- Une seule saisie par la personne ; ensuite, seul un admin corrige. Rejouer la même année est sans effet.
CREATE FUNCTION public.profile_set_birth_year(p_year smallint) RETURNS smallint
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  me uuid := auth.uid();
  saved smallint;
BEGIN
  IF me IS NULL THEN RAISE EXCEPTION 'FORBIDDEN'; END IF;
  IF p_year IS NULL OR p_year NOT BETWEEN 1900 AND extract(year FROM now() AT TIME ZONE 'Europe/Paris')::int THEN
    RAISE EXCEPTION 'VALIDATION_ERROR';
  END IF;
  INSERT INTO profile_details(user_id, birth_year) VALUES (me, p_year)
    ON CONFLICT (user_id) DO UPDATE SET birth_year = coalesce(profile_details.birth_year, excluded.birth_year)
    RETURNING birth_year INTO saved;
  IF saved <> p_year THEN RAISE EXCEPTION 'BIRTH_YEAR_LOCKED'; END IF;
  RETURN saved;
END $$;

-- Admin d'un club actif dont la personne est membre ; jamais sa propre année (un mineur peut
-- créer un club d'essai et en être admin).
CREATE FUNCTION public.club_member_set_birth_year(p_club uuid, p_user uuid, p_year smallint) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE old_year smallint;
BEGIN
  IF NOT course_is_admin(p_club) OR p_user IS NOT DISTINCT FROM auth.uid()
     OR NOT EXISTS (SELECT 1 FROM club_members WHERE club_id = p_club AND user_id = p_user) THEN
    RAISE EXCEPTION 'FORBIDDEN';
  END IF;
  IF p_year IS NULL OR p_year NOT BETWEEN 1900 AND extract(year FROM now() AT TIME ZONE 'Europe/Paris')::int THEN
    RAISE EXCEPTION 'VALIDATION_ERROR';
  END IF;
  INSERT INTO profile_details(user_id) VALUES (p_user) ON CONFLICT DO NOTHING;
  SELECT birth_year INTO old_year FROM profile_details WHERE user_id = p_user FOR UPDATE;
  IF old_year IS NOT DISTINCT FROM p_year THEN RETURN; END IF;
  UPDATE profile_details SET birth_year = p_year WHERE user_id = p_user;
  INSERT INTO profile_admin_events(club_id, user_id, actor_id, action, details)
    VALUES (p_club, p_user, auth.uid(), 'birth_year', jsonb_build_object('from', old_year, 'to', p_year));
END $$;

REVOKE ALL ON FUNCTION public.profile_set_avatar(uuid), public.profile_clear_avatar(),
  public.profile_set_birth_year(smallint), public.club_member_set_birth_year(uuid, uuid, smallint) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.profile_set_avatar(uuid), public.profile_clear_avatar(),
  public.profile_set_birth_year(smallint), public.club_member_set_birth_year(uuid, uuid, smallint) TO authenticated;

-- Reprise de 2026112102_account_hub.sql ; seul le bloc `profile` change (avatar_path, birth_year, email).
CREATE OR REPLACE FUNCTION public.course_my_context(p_club uuid) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=public AS $$
BEGIN
 IF auth.uid() IS NULL OR NOT EXISTS(SELECT 1 FROM clubs WHERE id=p_club AND status='active') THEN RAISE EXCEPTION 'FORBIDDEN'; END IF;
 RETURN jsonb_build_object('server_now',now(),'is_member',course_is_member(p_club),'signup_status',(SELECT status FROM club_signup_requests WHERE club_id=p_club AND user_id=auth.uid()),
  'signup_requested_at',(SELECT created_at FROM club_signup_requests WHERE club_id=p_club AND user_id=auth.uid()),
  'can_manage',course_is_admin(p_club) OR EXISTS(SELECT 1 FROM courses WHERE club_id=p_club AND owner_id=auth.uid() AND course_is_member(p_club)),
  'profile',(SELECT jsonb_build_object('prenom',p.prenom,'nom',p.nom,'sex',d.sex,'classement',d.classement,'revision',coalesce(d.revision,0),
   'avatar_path',d.avatar_path,'birth_year',d.birth_year,'email',(SELECT u.email FROM auth.users u WHERE u.id=p.id)) FROM profiles p LEFT JOIN profile_details d ON d.user_id=p.id WHERE p.id=auth.uid()),
  'captain_teams',coalesce((SELECT jsonb_agg(jsonb_build_object('genre',c.genre,'categorie',c.categorie,'numero',e.numero) ORDER BY c.genre,c.categorie,e.numero)
     FROM team_equipe_captains k JOIN team_equipes e ON e.id=k.equipe_id JOIN team_competitions c ON c.id=e.competition_id JOIN team_saisons s ON s.id=c.saison_id
     WHERE k.club_id=p_club AND k.user_id=auth.uid() AND s.actif),'[]'::jsonb),
  'mine_count',(SELECT count(*) FROM courses c JOIN course_registrations r ON r.course_id=c.id WHERE c.club_id=p_club AND r.user_id=auth.uid() AND r.status IN ('pending','approved') AND c.cancelled_at IS NULL AND c.starts_at+make_interval(mins=>c.duration_minutes)>now()),
  'attention_count',(SELECT count(*) FROM course_registrations r JOIN courses c ON c.id=r.course_id WHERE c.club_id=p_club AND course_can_manage(p_club,c.id) AND c.cancelled_at IS NULL AND c.starts_at>now() AND r.status='pending'));
END $$;

COMMIT;
