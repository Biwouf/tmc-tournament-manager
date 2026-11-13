-- Une lecture Ten'Up en échec ne compte plus comme une lecture (incident du 13/11/2026).
--
-- Le worker Ten'Up était resté verrouillé : chaque lecture revenait en 502, et l'import du club
-- (S6b) relançait deux fois chaque lecture « indisponible ». `team_tenup_read_begin` comptait
-- chaque tentative dès son début : un club neuf a épuisé ses 40 lectures d'essai sans rien lire.
--
-- 1. `team_tenup_competition_requests.failed` : la lecture a échoué côté worker ou dans l'Edge
--    `tenup-sync`. Seule l'Edge la marque, via `team_tenup_read_failed` (service_role uniquement).
--    Une lecture non marquée compte, comme avant (Edge interrompue, ancienne Edge encore déployée).
-- 2. Le quota par minute (3, ou 15 pendant une fenêtre d'import) et le plafond d'essai (40 / 24 h
--    par club `trial`) ne comptent plus que les lectures non marquées.
-- 3. Garde-fou : les échecs ont leur propre compteur, aux mêmes valeurs (par compte et par minute ;
--    40 par 24 h et par club en essai). Des échecs provoqués en boucle restent bornés à deux fois
--    le plafond. `internal` et `saison` : toujours sans plafond journalier.
-- 4. Un échec de la page club rend aussi l'import de club (5 par compte et par jour) qu'il avait ouvert.
-- Les lectures de feuilles de rencontre (`team_tenup_begin`, compteur `team_tenup_previews`) ne
-- passent pas par ce compteur : inchangées.
-- Idempotente. Jamais de SQLSTATE 40001.
BEGIN;

ALTER TABLE public.team_tenup_competition_requests
  ADD COLUMN IF NOT EXISTS failed boolean NOT NULL DEFAULT false;

CREATE OR REPLACE FUNCTION public.team_tenup_read_begin(p_club uuid) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE per_minute integer := 3;
BEGIN
  PERFORM pg_advisory_xact_lock(hashtextextended('tenup-competition:' || auth.uid()::text, 0));
  DELETE FROM team_tenup_competition_requests WHERE actor_id = auth.uid() AND created_at < now() - interval '1 day';
  IF EXISTS (SELECT 1 FROM team_tenup_club_imports WHERE actor_id = auth.uid() AND club_id = p_club AND created_at > now() - interval '10 minutes') THEN
    per_minute := 15;
  END IF;
  IF (SELECT count(*) FROM team_tenup_competition_requests WHERE actor_id = auth.uid() AND NOT failed AND created_at > now() - interval '1 minute') >= per_minute THEN
    RAISE EXCEPTION 'Trop de demandes Ten’Up. Réessayez dans une minute.';
  END IF;
  IF (SELECT count(*) FROM team_tenup_competition_requests WHERE actor_id = auth.uid() AND failed AND created_at > now() - interval '1 minute') >= per_minute THEN
    RAISE EXCEPTION 'Ten’Up ne répond pas : trop de lectures en échec. Réessayez dans une minute.';
  END IF;
  -- Plafond d'essai, par club (plusieurs admins partagent le même plafond).
  IF EXISTS (SELECT 1 FROM clubs WHERE id = p_club AND plan = 'trial') THEN
    PERFORM pg_advisory_xact_lock(hashtextextended('tenup-club:' || p_club::text, 0));
    IF (SELECT count(*) FROM team_tenup_competition_requests WHERE club_id = p_club AND NOT failed AND created_at > now() - interval '1 day') >= 40 THEN
      RAISE EXCEPTION 'Limite de l’essai atteinte : 40 lectures Ten’Up par 24 heures. Réessayez demain, ou ajoutez vos autres équipes plus tard depuis Matches par équipe.';
    END IF;
    IF (SELECT count(*) FROM team_tenup_competition_requests WHERE club_id = p_club AND failed AND created_at > now() - interval '1 day') >= 40 THEN
      RAISE EXCEPTION 'Limite de l’essai atteinte : 40 lectures Ten’Up en échec par 24 heures. Réessayez demain, ou ajoutez vos autres équipes plus tard depuis Matches par équipe.';
    END IF;
  END IF;
  INSERT INTO team_tenup_competition_requests(actor_id, club_id) VALUES(auth.uid(), p_club);
END $$;
REVOKE ALL ON FUNCTION public.team_tenup_read_begin(uuid) FROM PUBLIC, anon, authenticated;

-- Appelée par `tenup-sync` (clé service) quand le worker ou l'Edge échoue après le contrôle SQL :
-- marque la dernière lecture encore comptée de ce compte pour ce club (2 minutes : le délai du
-- worker est de 50 s). Deux lectures simultanées du même compte et du même club se valent.
CREATE OR REPLACE FUNCTION public.team_tenup_read_failed(p_actor uuid, p_club uuid, p_club_import boolean DEFAULT false) RETURNS boolean
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE target uuid;
BEGIN
  SELECT id INTO target FROM team_tenup_competition_requests
   WHERE actor_id = p_actor AND club_id = p_club AND NOT failed AND created_at > now() - interval '2 minutes'
   ORDER BY created_at DESC LIMIT 1;
  IF target IS NULL THEN RETURN false; END IF;
  UPDATE team_tenup_competition_requests SET failed = true WHERE id = target AND NOT failed;
  IF p_club_import THEN
    DELETE FROM team_tenup_club_imports WHERE id = (
      SELECT id FROM team_tenup_club_imports
       WHERE actor_id = p_actor AND club_id = p_club AND created_at > now() - interval '2 minutes'
       ORDER BY created_at DESC LIMIT 1);
  END IF;
  RETURN true;
END $$;
REVOKE ALL ON FUNCTION public.team_tenup_read_failed(uuid, uuid, boolean) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.team_tenup_read_failed(uuid, uuid, boolean) TO service_role;

COMMIT;
