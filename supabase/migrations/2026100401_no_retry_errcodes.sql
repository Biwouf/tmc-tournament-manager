-- PostgREST rejoue indéfiniment une transaction en SQLSTATE 40001 (serialization_failure).
-- Les conflits de révision métier passent en PT409 : HTTP 409, même message, sans rejeu.
-- Déployer avant ou avec le client. Aucun service distant modifié par la PR.
BEGIN;
DO $$
DECLARE f regprocedure;
BEGIN
 FOR f IN SELECT p.oid::regprocedure FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
  WHERE n.nspname='public' AND p.prosrc ~* 'ERRCODE\s*=\s*''40001''' LOOP
  -- CREATE OR REPLACE conserve propriétaire, droits, SECURITY DEFINER et search_path.
  EXECUTE regexp_replace(pg_get_functiondef(f),'ERRCODE\s*=\s*''40001''','ERRCODE=''PT409''','gi');
 END LOOP;
 IF EXISTS(SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
  WHERE n.nspname='public' AND p.prosrc ~ '''40001''') THEN
  RAISE EXCEPTION 'Une fonction public utilise encore SQLSTATE 40001.';
 END IF;
END $$;

-- Un point marqué ne modifie plus la ligne (ni sa révision) s'il n'y a rien à invalider.
CREATE OR REPLACE FUNCTION public.invalidate_team_live_result() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
BEGIN
 IF NEW.team_match_line_id IS NOT NULL AND NOT NEW.team_result_confirmed AND
  (to_jsonb(NEW)-ARRAY['revision','updated_at','scored_by','court','team_result_confirmed']) IS DISTINCT FROM
  (to_jsonb(OLD)-ARRAY['revision','updated_at','scored_by','court','team_result_confirmed']) THEN
  UPDATE team_match_lines SET confirmed_at=NULL,gagnant=NULL,score=NULL,result_kind=NULL
  WHERE id=NEW.team_match_line_id
   AND (confirmed_at IS NOT NULL OR gagnant IS NOT NULL OR score IS NOT NULL OR result_kind IS NOT NULL);
 END IF;
 RETURN NULL;
END $$;
COMMIT;
