-- Barème FFT complet (brief compte/profil v3.2, §6.7) : 5e série (40/2, 40/1) et numérotés (Top).
-- À appliquer avant la PWA. « NC » reste accepté (compos, anciennes inscriptions) ; -30 reste refusé.
-- Même liste que TENNIS_RANKINGS (shared/tennisRankings.ts), contrôlée par `npm run test:account`.
BEGIN;

CREATE OR REPLACE FUNCTION public.is_tennis_ranking(p_rank text) RETURNS boolean
LANGUAGE sql IMMUTABLE SET search_path = public AS $$
  SELECT p_rank IN ('NC','40/2','40/1','40','30/5','30/4','30/3','30/2','30/1','30','15/5','15/4','15/3','15/2','15/1',
    '15','5/6','4/6','3/6','2/6','1/6','0','-2/6','-4/6','-15','Top')
$$;
REVOKE ALL ON FUNCTION public.is_tennis_ranking(text) FROM PUBLIC, anon, authenticated;

ALTER TABLE public.profile_details DROP CONSTRAINT IF EXISTS profile_details_classement_check;
ALTER TABLE public.profile_details ADD CONSTRAINT profile_details_classement_check CHECK (classement IN
  ('NC','40/2','40/1','40','30/5','30/4','30/3','30/2','30/1','30','15/5','15/4','15/3','15/2','15/1',
   '15','5/6','4/6','3/6','2/6','1/6','0','-2/6','-4/6','-15','Top'));

-- Inscription : reprise de 2026092001, seule la liste des classements change.
CREATE OR REPLACE FUNCTION public.signup_fill_profile_internal(p_user uuid,p_prenom text,p_nom text,p_sex text,p_classement text)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE changed integer;
BEGIN
 IF coalesce(length(btrim(p_prenom)),0) NOT BETWEEN 1 AND 100
 OR coalesce(length(btrim(p_nom)),0) NOT BETWEEN 1 AND 100
 OR coalesce(p_sex,'') NOT IN ('female','male')
 OR (p_classement IS NOT NULL AND NOT is_tennis_ranking(p_classement)) THEN RAISE EXCEPTION 'VALIDATION_ERROR'; END IF;
 INSERT INTO profiles(id,prenom,nom) VALUES(p_user,btrim(p_prenom),btrim(p_nom))
 ON CONFLICT(id) DO UPDATE SET
 prenom=CASE WHEN nullif(btrim(profiles.prenom),'') IS NULL THEN excluded.prenom ELSE profiles.prenom END,
 nom=CASE WHEN nullif(btrim(profiles.nom),'') IS NULL THEN excluded.nom ELSE profiles.nom END
 WHERE nullif(btrim(profiles.prenom),'') IS NULL OR nullif(btrim(profiles.nom),'') IS NULL;
 GET DIAGNOSTICS changed = ROW_COUNT;
 INSERT INTO profile_details(user_id,sex,classement) VALUES(p_user,p_sex,p_classement)
 ON CONFLICT(user_id) DO UPDATE SET
 sex=coalesce(profile_details.sex,excluded.sex),
 classement=coalesce(profile_details.classement,excluded.classement),
 revision=profile_details.revision+1,updated_at=clock_timestamp()
 WHERE changed>0 OR profile_details.sex IS NULL
 OR (profile_details.classement IS NULL AND excluded.classement IS NOT NULL);
END $$;

-- Compo : reprise de 2026101105, seule la liste des classements change.
CREATE OR REPLACE FUNCTION public.team_compo_command(p_club uuid,p_rencontre uuid,p_data jsonb,p_request_id uuid) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE s jsonb; created jsonb; ids jsonb:='[]'; rank text; member uuid; updated integer:=0;
BEGIN
 IF NOT team_can_score(p_club) THEN RAISE EXCEPTION 'Accès membre requis.' USING ERRCODE='42501'; END IF;
 IF p_request_id IS NULL OR p_data IS NULL OR jsonb_typeof(p_data->'simples') IS DISTINCT FROM 'array'
  OR jsonb_array_length(p_data->'simples') NOT BETWEEN 1 AND 12 THEN RAISE EXCEPTION 'Composition invalide.'; END IF;
 FOR s IN SELECT value FROM jsonb_array_elements(p_data->'simples') ORDER BY (value->>'slot')::integer LOOP
  created:=team_match_command(p_club,p_rencontre,'create',jsonb_build_object('match_type','simple','slot',(s->>'slot')::integer,
   'joueurs_club',jsonb_build_array(s->'joueur_club'),'joueurs_adverse',jsonb_build_array(s->'joueur_adverse')),
   md5(p_request_id::text||':simple:'||(s->>'slot')::integer)::uuid);
  ids:=ids||jsonb_build_array(created->'id');
  -- team_match_command a déjà vérifié que member_id est un membre du club.
  member:=(s->'joueur_club'->>'member_id')::uuid; rank:=s->'joueur_club'->>'classement';
  IF member IS NOT NULL AND coalesce((s->>'update_classement')::boolean,false) AND is_tennis_ranking(rank) THEN
   INSERT INTO profile_details(user_id,classement) VALUES(member,rank)
   ON CONFLICT(user_id) DO UPDATE SET classement=excluded.classement,revision=profile_details.revision+1,updated_at=now()
   WHERE profile_details.classement IS DISTINCT FROM excluded.classement;
   IF FOUND THEN updated:=updated+1; END IF;
  END IF;
 END LOOP;
 RETURN jsonb_build_object('ids',ids,'classements_mis_a_jour',updated);
END $$;

-- Mon compte : reprise de 2026112102 ; un classement hors barème lève VALIDATION_ERROR.
CREATE OR REPLACE FUNCTION public.account_save_profile(
  p_prenom text, p_nom text, p_sex text, p_revision integer, p_classement text DEFAULT '__keep__')
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  me uuid := auth.uid();
  current_revision integer;
BEGIN
  IF me IS NULL THEN RAISE EXCEPTION 'FORBIDDEN'; END IF;
  IF coalesce(length(btrim(p_prenom)), 0) NOT BETWEEN 1 AND 100
     OR coalesce(length(btrim(p_nom)), 0) NOT BETWEEN 1 AND 100
     OR coalesce(p_sex, '') NOT IN ('female', 'male')
     OR (p_classement NOT IN ('__keep__', '') AND NOT is_tennis_ranking(p_classement)) THEN
    RAISE EXCEPTION 'VALIDATION_ERROR';
  END IF;
  INSERT INTO profile_details(user_id) VALUES (me) ON CONFLICT DO NOTHING;
  SELECT revision INTO current_revision FROM profile_details WHERE user_id = me FOR UPDATE;
  IF p_revision IS DISTINCT FROM current_revision THEN RAISE EXCEPTION 'VERSION_CONFLICT'; END IF;
  INSERT INTO profiles(id, prenom, nom) VALUES (me, btrim(p_prenom), btrim(p_nom))
    ON CONFLICT (id) DO UPDATE SET prenom = excluded.prenom, nom = excluded.nom;
  UPDATE profile_details
     SET sex = p_sex,
         classement = CASE WHEN p_classement = '__keep__' THEN classement ELSE nullif(p_classement, '') END,
         revision = revision + 1,
         updated_at = clock_timestamp()
   WHERE user_id = me;
  RETURN jsonb_build_object('revision', current_revision + 1);
END $$;

COMMIT;
