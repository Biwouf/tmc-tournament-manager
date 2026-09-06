-- Version 20260907 : conserver l’ordre après 20260906 (PR8), sans mélanger les longueurs de version le même jour.
-- Déployer avant les nouveaux clients BO et PWA. La version est maintenue en base.
BEGIN;
ALTER TABLE public.live_matches ADD COLUMN IF NOT EXISTS revision integer NOT NULL DEFAULT 0;

CREATE OR REPLACE FUNCTION public.guard_live_match_write()
RETURNS trigger LANGUAGE plpgsql SET search_path = public AS $$
DECLARE caller uuid := auth.uid();
BEGIN
  IF TG_OP = 'UPDATE' THEN NEW.revision := OLD.revision + 1; END IF;
  IF TG_OP = 'INSERT' THEN NEW.revision := 0; END IF;
  -- Maintenance serveur : RLS et droits de service restent inchangés.
  IF current_user IN ('postgres', 'service_role', 'supabase_admin') THEN
    IF TG_OP = 'DELETE' THEN RETURN OLD; ELSE RETURN NEW; END IF;
  END IF;
  IF caller IS NULL THEN RAISE EXCEPTION 'Connexion requise.' USING ERRCODE = '42501'; END IF;
  IF TG_OP = 'INSERT' THEN
    IF NEW.status <> 'pending' OR NEW.scored_by IS NOT NULL THEN
      RAISE EXCEPTION 'Créer un match en attente avant de le démarrer.' USING ERRCODE = '42501';
    END IF;
    RETURN NEW;
  END IF;
  IF TG_OP = 'DELETE' THEN
    IF OLD.status = 'pending' OR OLD.scored_by = caller OR public.can_manage_club_content(OLD.club_id) THEN RETURN OLD; END IF;
    RAISE EXCEPTION 'Seul le gestionnaire ou un responsable du club peut supprimer ce match.' USING ERRCODE = '42501';
  END IF;
  IF NEW.club_id IS DISTINCT FROM OLD.club_id OR NEW.id IS DISTINCT FROM OLD.id THEN
    RAISE EXCEPTION 'Le club et l’identifiant du match ne peuvent pas être modifiés.' USING ERRCODE = '42501';
  END IF;
  -- Préserver ON DELETE SET NULL de la FK events sans autoriser une édition du score.
  IF pg_trigger_depth() > 1 AND OLD.event_id IS NOT NULL AND NEW.event_id IS NULL AND
    (to_jsonb(NEW) - ARRAY['event_id','revision','updated_at']) =
    (to_jsonb(OLD) - ARRAY['event_id','revision','updated_at']) THEN RETURN NEW; END IF;
  IF OLD.scored_by = caller AND
    (NEW.scored_by = caller OR (NEW.scored_by IS NULL AND NEW.status = 'pending')) THEN RETURN NEW; END IF;

  -- Reprise explicite : aucun changement de score dans la même écriture.
  IF OLD.status IN ('live', 'finished') AND NEW.scored_by = caller AND
    (to_jsonb(NEW) - ARRAY['scored_by','revision','updated_at']) =
    (to_jsonb(OLD) - ARRAY['scored_by','revision','updated_at']) THEN RETURN NEW; END IF;
  -- Démarrage : terrain/horodatage autorisés, scores et joueurs conservés.
  IF OLD.status = 'pending' AND NEW.status = 'live' AND NEW.scored_by = caller AND
    (to_jsonb(NEW) - ARRAY['status','scored_by','court','started_at','revision','updated_at']) =
    (to_jsonb(OLD) - ARRAY['status','scored_by','court','started_at','revision','updated_at']) THEN RETURN NEW; END IF;
  RAISE EXCEPTION 'Ce match est géré par un autre utilisateur. Reprenez le contrôle avant de le modifier.' USING ERRCODE = '42501';
END
$$;
REVOKE ALL ON FUNCTION public.guard_live_match_write() FROM PUBLIC;
DROP TRIGGER IF EXISTS live_matches_guard ON public.live_matches;
CREATE TRIGGER live_matches_guard BEFORE INSERT OR UPDATE OR DELETE ON public.live_matches
FOR EACH ROW EXECUTE FUNCTION public.guard_live_match_write();
COMMIT;
