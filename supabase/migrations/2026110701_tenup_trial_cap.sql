-- SaaS S6 — plafond de lectures Ten'Up pour un club en essai (décision 5 du brief S6).
--
-- Chaque lecture Ten'Up (fiche de championnat ou poule, puisque `team_tenup_pool_begin` appelle
-- `team_tenup_competition_begin`) coûte un appel facturé au worker. Le quota existant est par
-- compte (3 / minute) ; on ajoute un plafond PAR CLUB, pour les seuls clubs `plan = 'trial'` :
-- 20 lectures par 24 heures glissantes. Les clubs `internal` (le CAC) et `saison` ne sont pas
-- concernés : rien ne change pour eux, pas même un verrou de plus.
--
-- Idempotente : colonne et index en IF NOT EXISTS, fonction en CREATE OR REPLACE (même signature,
-- les GRANT existants sont conservés et reposés à l'identique).
BEGIN;

-- Le club de la lecture. NULL pour les lignes antérieures : elles ne comptent pour aucun club et
-- disparaissent sous 24 h (purge par compte déjà en place).
ALTER TABLE public.team_tenup_competition_requests
  ADD COLUMN IF NOT EXISTS club_id uuid REFERENCES public.clubs(id) ON DELETE CASCADE;
CREATE INDEX IF NOT EXISTS team_tenup_competition_request_club
  ON public.team_tenup_competition_requests(club_id, created_at);

CREATE OR REPLACE FUNCTION public.team_tenup_competition_begin(p_club uuid, p_saison uuid, p_url text) RETURNS boolean
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF auth.uid() IS NULL OR NOT public.can_manage_club_content(p_club) THEN
    RAISE EXCEPTION 'Administration du club requise.' USING ERRCODE = '42501';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM team_saisons WHERE id = p_saison AND club_id = p_club) THEN
    RAISE EXCEPTION 'Saison introuvable pour ce club.';
  END IF;
  IF p_url IS NULL OR length(p_url) > 500 OR p_url !~ '^https://tenup[.]fft[.]fr/championnat/[0-9]+([?]division=[0-9]+&phase=[0-9]+&poule=[0-9]+)?$' THEN
    RAISE EXCEPTION 'Lien de championnat Ten’Up invalide.';
  END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended('tenup-competition:' || auth.uid()::text, 0));
  DELETE FROM team_tenup_competition_requests WHERE actor_id = auth.uid() AND created_at < now() - interval '1 day';
  IF (SELECT count(*) FROM team_tenup_competition_requests WHERE actor_id = auth.uid() AND created_at > now() - interval '1 minute') >= 3 THEN
    RAISE EXCEPTION 'Trop de demandes Ten’Up. Réessayez dans une minute.';
  END IF;
  -- Plafond d'essai, par club (plusieurs admins partagent le même plafond).
  IF EXISTS (SELECT 1 FROM clubs WHERE id = p_club AND plan = 'trial') THEN
    PERFORM pg_advisory_xact_lock(hashtextextended('tenup-club:' || p_club::text, 0));
    IF (SELECT count(*) FROM team_tenup_competition_requests WHERE club_id = p_club AND created_at > now() - interval '1 day') >= 20 THEN
      RAISE EXCEPTION 'Limite de l’essai atteinte : 20 lectures Ten’Up par 24 heures. Réessayez demain, ou ajoutez vos autres équipes plus tard depuis Matches par équipe.';
    END IF;
  END IF;
  INSERT INTO team_tenup_competition_requests(actor_id, club_id) VALUES(auth.uid(), p_club);
  RETURN true;
END $$;
REVOKE ALL ON FUNCTION public.team_tenup_competition_begin(uuid, uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.team_tenup_competition_begin(uuid, uuid, text) TO authenticated;

COMMIT;
