-- Résumés publics des rencontres liées à la liste Live, en une lecture groupée.
BEGIN;

CREATE FUNCTION public.live_encounter_scores(p_club uuid, p_ids uuid[])
RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE result jsonb;
BEGIN
  IF coalesce(cardinality(p_ids), 0) > 100 THEN
    RAISE EXCEPTION 'Trop de rencontres demandées.';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM clubs WHERE id = p_club AND status = 'active') THEN
    RETURN '[]'::jsonb;
  END IF;

  SELECT coalesce(jsonb_agg(jsonb_build_object(
    'id', r.id,
    'club_adverse', r.club_adverse,
    'wo', r.wo,
    'confirmed', r.confirmed_at IS NOT NULL,
    'score_club', CASE WHEN score.n > 0 THEN score.club ELSE r.score_club END,
    'score_adverse', CASE WHEN score.n > 0 THEN score.adverse ELSE r.score_adverse END
  ) ORDER BY r.id), '[]'::jsonb) INTO result
  FROM team_rencontres r
  JOIN team_etapes e ON e.id = r.etape_id AND e.club_id = r.club_id
  JOIN team_equipes q ON q.id = e.equipe_id AND q.club_id = r.club_id
  JOIN team_competitions c ON c.id = q.competition_id AND c.club_id = r.club_id
  CROSS JOIN LATERAL (
    SELECT count(*) n,
      coalesce(sum(CASE WHEN points.winner = 'club' THEN points.value ELSE 0 END), 0) club,
      coalesce(sum(CASE WHEN points.winner = 'adverse' THEN points.value ELSE 0 END), 0) adverse
    FROM (
      -- Un résultat confirmé prime ; sinon, un live terminé contribue déjà au total.
      SELECT coalesce(l.gagnant, CASE WHEN m.status = 'finished' THEN
        CASE m.winner WHEN 'j1' THEN 'club' WHEN 'j2' THEN 'adverse' END
      END) winner,
        CASE WHEN l.match_type = 'double' THEN (public.team_format_spec(c.format))[3]
          ELSE 1 END value
      FROM team_match_lines l
      LEFT JOIN live_matches m ON m.id = l.live_match_id AND m.club_id = r.club_id
      WHERE l.rencontre_id = r.id AND l.club_id = r.club_id
    ) points
  ) score
  WHERE r.club_id = p_club AND r.id = ANY(p_ids);
  RETURN result;
END $$;

REVOKE ALL ON FUNCTION public.live_encounter_scores(uuid, uuid[]) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.live_encounter_scores(uuid, uuid[]) TO anon, authenticated;
COMMIT;
