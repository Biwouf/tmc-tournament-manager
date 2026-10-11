-- Un live d'équipe terminé avec un vainqueur vaut résultat validé du match : la ligne
-- reçoit gagnant, sets et score, et le total de la rencontre suit (refresh_team_result).
-- La vérification humaine se fait à la confirmation de la rencontre. Toute autre
-- modification du live (reprise, correction de score) invalide le résultat, comme avant.
BEGIN;

CREATE OR REPLACE FUNCTION public.guard_team_live() RETURNS trigger LANGUAGE plpgsql SET search_path=public AS $$
BEGIN
 IF TG_OP='DELETE' THEN
  IF OLD.team_match_line_id IS NOT NULL AND pg_trigger_depth()=1 AND current_user NOT IN ('postgres','service_role','supabase_admin') THEN RAISE EXCEPTION 'Ce live est lié à une rencontre ; conservez-le avec son résultat.'; END IF;
  RETURN OLD;
 END IF;
 IF TG_OP='UPDATE' AND pg_trigger_depth()>1 AND
  ((OLD.team_match_line_id IS NOT NULL AND NEW.team_match_line_id IS NULL) OR (OLD.team_rencontre_id IS NOT NULL AND NEW.team_rencontre_id IS NULL)) AND
  (to_jsonb(NEW)-ARRAY['team_match_line_id','team_rencontre_id','revision','updated_at']) =
  (to_jsonb(OLD)-ARRAY['team_match_line_id','team_rencontre_id','revision','updated_at']) THEN
  IF NEW.team_match_line_id IS NULL THEN NEW.team_rencontre_id:=NULL; NEW.team_result_confirmed:=false; END IF;
  RETURN NEW;
 END IF;
 IF current_user NOT IN ('postgres','service_role','supabase_admin') THEN
  IF TG_OP='INSERT' AND (NEW.team_match_line_id IS NOT NULL OR NEW.team_rencontre_id IS NOT NULL OR NEW.team_result_confirmed) THEN
   RAISE EXCEPTION 'Créez ce live depuis la rencontre.';
  END IF;
  IF TG_OP='UPDATE' THEN
   IF NEW.team_match_line_id IS DISTINCT FROM OLD.team_match_line_id OR NEW.team_rencontre_id IS DISTINCT FROM OLD.team_rencontre_id
      OR NEW.team_result_confirmed IS DISTINCT FROM OLD.team_result_confirmed THEN RAISE EXCEPTION 'Le lien à la rencontre est géré automatiquement.'; END IF;
   IF OLD.team_match_line_id IS NOT NULL AND (NEW.set3_format IS DISTINCT FROM OLD.set3_format OR NEW.match_type IS DISTINCT FROM OLD.match_type) THEN
    RAISE EXCEPTION 'Le format est fixé par la rencontre.'; END IF;
  END IF;
 END IF;
 IF TG_OP='UPDATE' AND NEW.team_match_line_id IS NOT NULL AND
  (to_jsonb(NEW)-ARRAY['revision','updated_at','scored_by','court','team_result_confirmed']) IS DISTINCT FROM
  (to_jsonb(OLD)-ARRAY['revision','updated_at','scored_by','court','team_result_confirmed']) THEN
  NEW.team_result_confirmed:=NEW.status='finished' AND NEW.winner IS NOT NULL;
 END IF;
 RETURN NEW;
END $$;

CREATE OR REPLACE FUNCTION public.invalidate_team_live_result() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE scores jsonb; score_value text; kind text;
BEGIN
 IF NEW.team_match_line_id IS NULL OR NOT (
  (to_jsonb(NEW)-ARRAY['revision','updated_at','scored_by','court','team_result_confirmed']) IS DISTINCT FROM
  (to_jsonb(OLD)-ARRAY['revision','updated_at','scored_by','court','team_result_confirmed'])
  OR (NEW.team_result_confirmed AND NOT OLD.team_result_confirmed)) THEN RETURN NULL; END IF;
 IF NOT NEW.team_result_confirmed THEN
  UPDATE team_match_lines SET confirmed_at=NULL,gagnant=NULL,score=NULL,result_kind=NULL
  WHERE id=NEW.team_match_line_id
   AND (confirmed_at IS NOT NULL OR gagnant IS NOT NULL OR score IS NOT NULL OR result_kind IS NOT NULL);
  RETURN NULL;
 END IF;
 -- j1 = joueurs du club, j2 = adversaires (cf. start_live).
 SELECT coalesce(jsonb_agg(jsonb_strip_nulls(jsonb_build_object('club',coalesce(s.a,0),'adverse',coalesce(s.b,0),'tb_club',s.ta,'tb_adverse',s.tb)) ORDER BY s.n),'[]'),
  string_agg(coalesce(s.a,0)||'-'||coalesce(s.b,0),' ' ORDER BY s.n)
 INTO scores,score_value
 FROM (VALUES (1,NEW.set1_j1,NEW.set1_j2,NEW.set1_tb_j1,NEW.set1_tb_j2),(2,NEW.set2_j1,NEW.set2_j2,NEW.set2_tb_j1,NEW.set2_tb_j2),
  (3,NEW.set3_j1,NEW.set3_j2,NEW.set3_tb_j1,NEW.set3_tb_j2)) s(n,a,b,ta,tb)
 WHERE s.a IS NOT NULL OR s.b IS NOT NULL;
 kind:=CASE WHEN NEW.retired_player IS NOT NULL THEN 'retired' ELSE 'normal' END;
 IF kind='retired' THEN score_value:=btrim(coalesce(score_value,'')||' AB.'); END IF;
 UPDATE team_match_lines SET gagnant=CASE NEW.winner WHEN 'j1' THEN 'club' ELSE 'adverse' END,
  score=score_value,sets=scores,result_kind=kind,confirmed_at=now()
 WHERE id=NEW.team_match_line_id;
 RETURN NULL;
END $$;

-- Rattrapage : lives d'équipe terminés en attente de validation.
UPDATE live_matches m SET team_result_confirmed=true
WHERE m.team_match_line_id IS NOT NULL AND m.status='finished' AND m.winner IS NOT NULL AND NOT m.team_result_confirmed
 AND EXISTS(SELECT 1 FROM team_match_lines l WHERE l.id=m.team_match_line_id AND l.confirmed_at IS NULL);

REVOKE ALL ON FUNCTION public.guard_team_live(),public.invalidate_team_live_result() FROM PUBLIC,anon,authenticated;
COMMIT;
