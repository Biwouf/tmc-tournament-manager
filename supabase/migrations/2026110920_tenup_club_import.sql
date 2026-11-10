-- SaaS S6b — toutes les équipes d'un club depuis la page Ten'Up de ses rencontres
-- (brief SAAS_07b_import_club, décisions du 09/11/2026).
--
-- 1. `team_tenup_club_begin(club, url)` : contrôle avant la lecture (facturée) de la page
--    `https://tenup.fft.fr/club/<id>/competitions/rencontres` par le worker. La lecture compte
--    comme les autres et ouvre une « fenêtre d'import » de 10 minutes pour ce compte et ce club.
-- 2. Pendant cette fenêtre, le quota par minute passe de 3 à 15 lectures : l'import enchaîne les
--    fiches de championnat et les poules (CAC : 1 + 3 + 8 = 12 lectures) sans attendre.
-- 3. Plafond d'essai relevé de 20 à 40 lectures par 24 h et par club (`plan = 'trial'`) ;
--    `internal` et `saison` toujours sans plafond.
-- Le comptage est factorisé dans `team_tenup_read_begin`, interne (aucun GRANT).
-- Idempotente. Jamais de SQLSTATE 40001.
BEGIN;

CREATE TABLE IF NOT EXISTS public.team_tenup_club_imports (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  actor_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  club_id uuid NOT NULL REFERENCES public.clubs(id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS team_tenup_club_imports_actor ON public.team_tenup_club_imports(actor_id, club_id, created_at);
ALTER TABLE public.team_tenup_club_imports ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.team_tenup_club_imports FROM PUBLIC, anon, authenticated;

-- Une lecture Ten'Up de plus pour ce compte et ce club : quota par minute, plafond d'essai.
-- Appelée uniquement par les fonctions SECURITY DEFINER ci-dessous, après leurs contrôles d'accès.
CREATE OR REPLACE FUNCTION public.team_tenup_read_begin(p_club uuid) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE per_minute integer := 3;
BEGIN
  PERFORM pg_advisory_xact_lock(hashtextextended('tenup-competition:' || auth.uid()::text, 0));
  DELETE FROM team_tenup_competition_requests WHERE actor_id = auth.uid() AND created_at < now() - interval '1 day';
  IF EXISTS (SELECT 1 FROM team_tenup_club_imports WHERE actor_id = auth.uid() AND club_id = p_club AND created_at > now() - interval '10 minutes') THEN
    per_minute := 15;
  END IF;
  IF (SELECT count(*) FROM team_tenup_competition_requests WHERE actor_id = auth.uid() AND created_at > now() - interval '1 minute') >= per_minute THEN
    RAISE EXCEPTION 'Trop de demandes Ten’Up. Réessayez dans une minute.';
  END IF;
  -- Plafond d'essai, par club (plusieurs admins partagent le même plafond).
  IF EXISTS (SELECT 1 FROM clubs WHERE id = p_club AND plan = 'trial') THEN
    PERFORM pg_advisory_xact_lock(hashtextextended('tenup-club:' || p_club::text, 0));
    IF (SELECT count(*) FROM team_tenup_competition_requests WHERE club_id = p_club AND created_at > now() - interval '1 day') >= 40 THEN
      RAISE EXCEPTION 'Limite de l’essai atteinte : 40 lectures Ten’Up par 24 heures. Réessayez demain, ou ajoutez vos autres équipes plus tard depuis Matches par équipe.';
    END IF;
  END IF;
  INSERT INTO team_tenup_competition_requests(actor_id, club_id) VALUES(auth.uid(), p_club);
END $$;
REVOKE ALL ON FUNCTION public.team_tenup_read_begin(uuid) FROM PUBLIC, anon, authenticated;

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
  PERFORM team_tenup_read_begin(p_club);
  RETURN true;
END $$;
REVOKE ALL ON FUNCTION public.team_tenup_competition_begin(uuid, uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.team_tenup_competition_begin(uuid, uuid, text) TO authenticated;

CREATE OR REPLACE FUNCTION public.team_tenup_club_begin(p_club uuid, p_url text) RETURNS boolean
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF auth.uid() IS NULL OR NOT public.can_manage_club_content(p_club) THEN
    RAISE EXCEPTION 'Administration du club requise.' USING ERRCODE = '42501';
  END IF;
  IF p_url IS NULL OR length(p_url) > 200 OR p_url !~ '^https://tenup[.]fft[.]fr/club/[0-9]+/competitions/rencontres$' THEN
    RAISE EXCEPTION 'Lien du club Ten’Up invalide.';
  END IF;
  PERFORM team_tenup_read_begin(p_club);
  -- Cinq imports par jour et par compte : la fenêtre à 15 lectures/minute ne se renouvelle pas sans fin.
  DELETE FROM team_tenup_club_imports WHERE actor_id = auth.uid() AND created_at < now() - interval '1 day';
  IF (SELECT count(*) FROM team_tenup_club_imports WHERE actor_id = auth.uid()) >= 5 THEN
    RAISE EXCEPTION 'Trop d’imports de club aujourd’hui. Réessayez demain, ou ajoutez une équipe avec le lien de sa poule.';
  END IF;
  INSERT INTO team_tenup_club_imports(actor_id, club_id) VALUES(auth.uid(), p_club);
  RETURN true;
END $$;
REVOKE ALL ON FUNCTION public.team_tenup_club_begin(uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.team_tenup_club_begin(uuid, text) TO authenticated;

COMMIT;
