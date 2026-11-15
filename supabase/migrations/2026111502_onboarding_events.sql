-- Onboarding « Ten'Up d'abord », PR P0 — événements internes après activation.
-- Brief `SAAS_11_onboarding_tenup` §7 et DECISIONS.md n° 1 : pas de Plausible dans le tunnel
-- pendant le POC ; seulement ces événements, socle du funnel super-admin prévu en S10.
--
-- Une table plutôt que la clé `onboarding` de `club_settings.config` :
--   - le funnel se requête en SQL (comptes, délais entre deux événements, tous clubs) ;
--   - `club_settings.config` est lu par la PWA et la vitrine, et chaque écriture de clé y est
--     une lecture-modification-écriture : un journal qui grossit n'a rien à y faire ;
--   - un événement est un ajout, jamais une mise à jour : aucune course entre deux onglets.
--
-- Écritures :
--   - `club_activated` et `site_published` par un déclencheur sur `clubs` (le serveur sait,
--     le navigateur pourrait ne jamais revenir) ;
--   - les cinq autres par `onboarding_event_log`, RPC SECURITY DEFINER réservée aux admins du
--     club (pas au support : un super-admin non membre ne fausse pas le funnel).
-- Seuls les clubs self-serve sont concernés : rien n'est écrit pour un club `console` (le CAC).
-- Aucune lecture pour `anon` ni `authenticated` (la console S10 ajoutera la sienne).
-- Jamais SQLSTATE 40001 (PostgREST le rejoue à l'infini).

CREATE TABLE IF NOT EXISTS public.onboarding_events (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  club_id uuid NOT NULL REFERENCES public.clubs(id) ON DELETE CASCADE,
  name text NOT NULL CONSTRAINT onboarding_events_name_check CHECK (name IN (
    'club_activated', 'teams_import_started', 'teams_imported', 'poster_generated',
    'app_shared', 'site_published', 'first_steps_finished')),
  at timestamptz NOT NULL DEFAULT now(),
  props jsonb NOT NULL DEFAULT '{}'::jsonb
    CONSTRAINT onboarding_events_props_check CHECK (jsonb_typeof(props) = 'object' AND octet_length(props::text) <= 1024)
);

CREATE INDEX IF NOT EXISTS onboarding_events_club_at_idx ON public.onboarding_events (club_id, at);

ALTER TABLE public.onboarding_events ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.onboarding_events FROM PUBLIC, anon, authenticated;

-- Événements du navigateur. Propriétés : seulement `count` (entier ≥ 0) pour `teams_imported`,
-- rien pour les autres — jamais d'e-mail, de nom de club ni d'identifiant Ten'Up.
-- Renvoie true si l'événement est écrit, false pour un club qui n'est pas self-serve.
-- Erreurs : 42501 (droits), 22023 (nom ou propriétés invalides).
CREATE OR REPLACE FUNCTION public.onboarding_event_log(p_club uuid, p_name text, p_props jsonb DEFAULT '{}'::jsonb)
RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_self_serve boolean;
  v_props jsonb := coalesce(p_props, '{}'::jsonb);
BEGIN
  IF auth.uid() IS NULL OR NOT EXISTS (
    SELECT 1 FROM public.club_members m JOIN public.clubs c ON c.id = m.club_id
     WHERE m.club_id = p_club AND m.user_id = auth.uid() AND m.role = 'admin' AND c.status = 'active')
  THEN
    RAISE EXCEPTION 'Réservé aux administrateurs du club.' USING ERRCODE = '42501';
  END IF;
  IF p_name IS NULL OR p_name NOT IN ('teams_import_started', 'teams_imported', 'poster_generated', 'app_shared', 'first_steps_finished') THEN
    RAISE EXCEPTION 'Événement inconnu.' USING ERRCODE = '22023';
  END IF;
  IF p_name = 'teams_imported' THEN
    IF jsonb_typeof(v_props) <> 'object' OR (SELECT array_agg(k) FROM jsonb_object_keys(v_props) k) IS DISTINCT FROM ARRAY['count']
       OR jsonb_typeof(v_props -> 'count') <> 'number' OR (v_props ->> 'count') !~ '^[0-9]{1,4}$' THEN
      RAISE EXCEPTION 'Propriétés invalides.' USING ERRCODE = '22023';
    END IF;
  ELSIF v_props <> '{}'::jsonb THEN
    RAISE EXCEPTION 'Propriétés invalides.' USING ERRCODE = '22023';
  END IF;
  SELECT c.created_via = 'self_serve' INTO v_self_serve FROM public.clubs c WHERE c.id = p_club;
  IF NOT v_self_serve THEN RETURN false; END IF;
  INSERT INTO public.onboarding_events (club_id, name, props) VALUES (p_club, p_name, v_props);
  RETURN true;
END $$;

REVOKE ALL ON FUNCTION public.onboarding_event_log(uuid, text, jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.onboarding_event_log(uuid, text, jsonb) TO authenticated;

-- Événements du serveur : activation par le lien magique (`pending` → `active`) et première
-- ouverture du site aux moteurs (`club_set_site_published(true)`), clubs self-serve seulement.
CREATE OR REPLACE FUNCTION public.onboarding_events_from_club()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF OLD.status = 'pending' AND NEW.status = 'active' THEN
    INSERT INTO public.onboarding_events (club_id, name) VALUES (NEW.id, 'club_activated');
  END IF;
  IF NOT OLD.site_published AND NEW.site_published AND NEW.status = 'active' THEN
    INSERT INTO public.onboarding_events (club_id, name) VALUES (NEW.id, 'site_published');
  END IF;
  RETURN NULL;
END $$;

REVOKE ALL ON FUNCTION public.onboarding_events_from_club() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS clubs_onboarding_events ON public.clubs;
CREATE TRIGGER clubs_onboarding_events
  AFTER UPDATE OF status, site_published ON public.clubs
  FOR EACH ROW WHEN (NEW.created_via = 'self_serve')
  EXECUTE FUNCTION public.onboarding_events_from_club();
