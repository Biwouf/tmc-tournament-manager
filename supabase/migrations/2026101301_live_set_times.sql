-- Fin des sets 1 et 2 d'un live, horodatée par le serveur pour afficher la durée des sets dans la PWA.
-- Le set 3 se termine avec le match (finished_at). Idempotente, non bloquante : aucun client n'écrit ces colonnes.
BEGIN;
ALTER TABLE public.live_matches ADD COLUMN IF NOT EXISTS set1_ended_at timestamptz;
ALTER TABLE public.live_matches ADD COLUMN IF NOT EXISTS set2_ended_at timestamptz;

-- Miroir de getNormalSetWinner (pwa/src/liveScoreRules.ts).
CREATE OR REPLACE FUNCTION public.live_set_won(a smallint, b smallint, tb_a smallint, tb_b smallint)
RETURNS boolean LANGUAGE sql IMMUTABLE AS $$
  SELECT coalesce(
    (a = 6 AND b <= 4) OR (b = 6 AND a <= 4)
    OR (a = 7 AND b = 5) OR (b = 7 AND a = 5)
    OR (a = 7 AND b = 6 AND (tb_a IS NULL AND tb_b IS NULL OR tb_a >= 7 AND tb_a - tb_b >= 2))
    OR (b = 7 AND a = 6 AND (tb_a IS NULL AND tb_b IS NULL OR tb_b >= 7 AND tb_b - tb_a >= 2)),
  false)
$$;

-- Horodatage au moment où le set est gagné pendant le live ; effacé si une correction l'annule.
-- Un score historique (import, Ten'Up, match pas en live) ne reçoit pas d'heure inventée.
CREATE OR REPLACE FUNCTION public.stamp_live_set_times()
RETURNS trigger LANGUAGE plpgsql SET search_path = public AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    NEW.set1_ended_at := NULL; NEW.set2_ended_at := NULL; RETURN NEW;
  END IF;
  NEW.set1_ended_at := CASE
    WHEN NOT live_set_won(NEW.set1_j1, NEW.set1_j2, NEW.set1_tb_j1, NEW.set1_tb_j2) THEN NULL
    WHEN live_set_won(OLD.set1_j1, OLD.set1_j2, OLD.set1_tb_j1, OLD.set1_tb_j2) THEN OLD.set1_ended_at
    WHEN OLD.status = 'live' THEN now() END;
  NEW.set2_ended_at := CASE
    WHEN NOT live_set_won(NEW.set2_j1, NEW.set2_j2, NEW.set2_tb_j1, NEW.set2_tb_j2) THEN NULL
    WHEN live_set_won(OLD.set2_j1, OLD.set2_j2, OLD.set2_tb_j1, OLD.set2_tb_j2) THEN OLD.set2_ended_at
    WHEN OLD.status = 'live' THEN now() END;
  RETURN NEW;
END
$$;
REVOKE ALL ON FUNCTION public.stamp_live_set_times() FROM PUBLIC;
-- Nom postérieur à live_matches_guard : le garde compare l'écriture du client avant cet horodatage.
DROP TRIGGER IF EXISTS live_matches_set_times ON public.live_matches;
CREATE TRIGGER live_matches_set_times BEFORE INSERT OR UPDATE ON public.live_matches
FOR EACH ROW EXECUTE FUNCTION public.stamp_live_set_times();
COMMIT;
