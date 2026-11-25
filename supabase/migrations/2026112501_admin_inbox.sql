-- PR-BO2 — accueil « À traiter » du back office et compteurs de la barre latérale.
--
-- Une seule lecture, réservée à l'admin du club (ou au super-admin) par `course_is_admin` :
-- club actif obligatoire, un `manager` (rôle retiré de l'interface) est refusé.
-- Refus en 42501, jamais en 40001 (PostgREST rejouerait la requête à l'infini).
-- `unread_messages` viendra avec `contact_messages.read_at` (PR-BO6).
--
-- ROLLBACK : DROP FUNCTION public.admin_inbox(uuid);

CREATE OR REPLACE FUNCTION public.admin_inbox(p_club uuid) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_saison uuid;
  v_result jsonb;
BEGIN
  -- `IS NOT TRUE` et non `NOT` : un résultat NULL refuse aussi.
  IF course_is_admin(p_club) IS NOT TRUE THEN
    RAISE EXCEPTION 'FORBIDDEN' USING ERRCODE = '42501';
  END IF;

  -- Saison par défaut de la grille (`useTeamSaisons`) : l'active, sinon la plus récente.
  SELECT id INTO v_saison FROM team_saisons WHERE club_id = p_club
  ORDER BY actif DESC, created_at DESC LIMIT 1;

  WITH todo AS (
    -- Cascade d'état de la grille (`stateOfRencontre`) : ni WO, ni à venir, score incomplet,
    -- compétition non terminée.
    SELECT r.id, r.date_heure, r.club_adverse, q.numero, c.nom, c.genre, c.categorie
    FROM team_rencontres r
    JOIN team_etapes e ON e.id = r.etape_id
    JOIN team_equipes q ON q.id = e.equipe_id
    JOIN team_competitions c ON c.id = q.competition_id
    WHERE c.club_id = p_club AND c.saison_id = v_saison AND NOT c.terminee
      AND NOT r.wo AND r.date_heure <= now()
      AND (r.score_club IS NULL OR r.score_adverse IS NULL)
  ), demandes AS (
    SELECT created_at FROM club_signup_requests WHERE club_id = p_club AND status = 'pending'
  ), inscriptions AS (
    SELECT c.id, c.name, c.starts_at, r.requested_at
    FROM course_registrations r JOIN courses c ON c.club_id = r.club_id AND c.id = r.course_id
    WHERE r.club_id = p_club AND r.status = 'pending'
      AND c.cancelled_at IS NULL AND c.starts_at > now()
  ), lives AS (
    SELECT started_at FROM live_matches WHERE club_id = p_club AND status = 'live'
  )
  SELECT jsonb_build_object(
    'signup_pending', (SELECT count(*) FROM demandes),
    'signup_oldest_at', (SELECT min(created_at) FROM demandes),
    'scores_to_enter', (SELECT count(*) FROM todo),
    'scores_oldest_at', (SELECT min(date_heure) FROM todo),
    'scores_preview', (SELECT coalesce(jsonb_agg(to_jsonb(p) ORDER BY p.date_heure, p.id), '[]'::jsonb)
                       FROM (SELECT * FROM todo ORDER BY date_heure, id LIMIT 2) p),
    'course_pending', (SELECT count(*) FROM inscriptions),
    'course_oldest_at', (SELECT min(requested_at) FROM inscriptions),
    'course_next', (SELECT jsonb_build_object('id', id, 'name', name, 'starts_at', starts_at)
                    FROM inscriptions ORDER BY starts_at, id LIMIT 1),
    'live_count', (SELECT count(*) FROM lives),
    'stale_lives', (SELECT count(*) FROM lives WHERE started_at < now() - interval '6 days'),
    'stale_lives_oldest_at', (SELECT min(started_at) FROM lives WHERE started_at < now() - interval '6 days')
  ) INTO v_result;
  RETURN v_result;
END $$;

REVOKE ALL ON FUNCTION public.admin_inbox(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_inbox(uuid) TO authenticated;
