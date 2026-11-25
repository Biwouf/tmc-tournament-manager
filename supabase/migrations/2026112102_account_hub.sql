-- Hub « Mon compte » (P0-b du brief compte/profil, 21/11/2026).
-- 1. account_save_profile : enregistrer son propre profil (prénom, nom, sexe, classement) sans
--    être membre du club. Un compte en attente de validation peut ainsi compléter son profil.
--    course_save_my_profile reste en place pour le parcours des cours (membres).
-- 2. course_my_context ajoute la date de la demande d'inscription et les équipes de la saison
--    active dont on est capitaine (pastilles du hub).
BEGIN;

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
     OR coalesce(p_sex, '') NOT IN ('female', 'male') THEN
    RAISE EXCEPTION 'VALIDATION_ERROR';
  END IF;
  INSERT INTO profile_details(user_id) VALUES (me) ON CONFLICT DO NOTHING;
  SELECT revision INTO current_revision FROM profile_details WHERE user_id = me FOR UPDATE;
  IF p_revision IS DISTINCT FROM current_revision THEN RAISE EXCEPTION 'VERSION_CONFLICT'; END IF;
  INSERT INTO profiles(id, prenom, nom) VALUES (me, btrim(p_prenom), btrim(p_nom))
    ON CONFLICT (id) DO UPDATE SET prenom = excluded.prenom, nom = excluded.nom;
  -- La contrainte CHECK de profile_details.classement refuse toute valeur hors barème.
  UPDATE profile_details
     SET sex = p_sex,
         classement = CASE WHEN p_classement = '__keep__' THEN classement ELSE nullif(p_classement, '') END,
         revision = revision + 1,
         updated_at = clock_timestamp()
   WHERE user_id = me;
  RETURN jsonb_build_object('revision', current_revision + 1);
END $$;
REVOKE ALL ON FUNCTION public.account_save_profile(text, text, text, integer, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.account_save_profile(text, text, text, integer, text) TO authenticated;

-- Reprise de 2026091602_pwa_signup.sql, avec signup_requested_at et captain_teams en plus.
CREATE OR REPLACE FUNCTION public.course_my_context(p_club uuid) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=public AS $$
BEGIN
 IF auth.uid() IS NULL OR NOT EXISTS(SELECT 1 FROM clubs WHERE id=p_club AND status='active') THEN RAISE EXCEPTION 'FORBIDDEN'; END IF;
 RETURN jsonb_build_object('server_now',now(),'is_member',course_is_member(p_club),'signup_status',(SELECT status FROM club_signup_requests WHERE club_id=p_club AND user_id=auth.uid()),
  'signup_requested_at',(SELECT created_at FROM club_signup_requests WHERE club_id=p_club AND user_id=auth.uid()),
  'can_manage',course_is_admin(p_club) OR EXISTS(SELECT 1 FROM courses WHERE club_id=p_club AND owner_id=auth.uid() AND course_is_member(p_club)),
  'profile',(SELECT jsonb_build_object('prenom',p.prenom,'nom',p.nom,'sex',d.sex,'classement',d.classement,'revision',coalesce(d.revision,0)) FROM profiles p LEFT JOIN profile_details d ON d.user_id=p.id WHERE p.id=auth.uid()),
  'captain_teams',coalesce((SELECT jsonb_agg(jsonb_build_object('genre',c.genre,'categorie',c.categorie,'numero',e.numero) ORDER BY c.genre,c.categorie,e.numero)
     FROM team_equipe_captains k JOIN team_equipes e ON e.id=k.equipe_id JOIN team_competitions c ON c.id=e.competition_id JOIN team_saisons s ON s.id=c.saison_id
     WHERE k.club_id=p_club AND k.user_id=auth.uid() AND s.actif),'[]'::jsonb),
  'mine_count',(SELECT count(*) FROM courses c JOIN course_registrations r ON r.course_id=c.id WHERE c.club_id=p_club AND r.user_id=auth.uid() AND r.status IN ('pending','approved') AND c.cancelled_at IS NULL AND c.starts_at+make_interval(mins=>c.duration_minutes)>now()),
  'attention_count',(SELECT count(*) FROM course_registrations r JOIN courses c ON c.id=r.course_id WHERE c.club_id=p_club AND course_can_manage(p_club,c.id) AND c.cancelled_at IS NULL AND c.starts_at>now() AND r.status='pending'));
END $$;

COMMIT;
