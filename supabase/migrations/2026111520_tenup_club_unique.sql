-- Onboarding « Ten'Up d'abord », P1-back (brief SAAS_11 §4.3–§5.1, décisions du 14/11/2026).
--
-- 1. `clubs.tenup_club_id` devient unique : un club Ten'Up n'a qu'un espace feelike. Un club
--    `pending` tient l'identifiant comme il tient son slug (7 jours au plus, puis purge).
--    ⚠ Les doublons existants font échouer l'index : les lister et les résoudre AVANT :
--      SELECT tenup_club_id, array_agg(id) FROM public.clubs
--       WHERE tenup_club_id IS NOT NULL GROUP BY 1 HAVING count(*) > 1;
--    Libérer à la main un identifiant tenu par un club `pending` squatté (super-admin) :
--      UPDATE public.clubs SET tenup_club_id = NULL WHERE id = '<club>' AND status = 'pending';
-- 2. `club_self_serve_create` gagne `p_tenup_club_id` et `p_short_name` (facultatifs) : écrit
--    `clubs.tenup_club_id` et `brand.short_name`. Identifiant déjà pris → `PT410` (l'Edge
--    `club-signup` répond 409 `already_on_feelike`). L'ancienne signature est supprimée.
-- 3. `tenup_lookup_cache` : lecture anonyme d'un club Ten'Up (Edge `tenup-lookup`), gardée 24 h,
--    purgée après 48 h avec ses images `content-images/_lookup/<id>/` (Edge `club-signup-purge`).
-- 4. `tenup_lookup_throttle(p_ip)` : 20 lectures non servies par le cache par heure et par IP,
--    buckets `lookup-ip:<sha256>` dans `club_self_serve_attempts` (purgés après 2 jours).
-- Service role seulement pour tout ce qui est nouveau. Le CAC (`internal`) n'est pas touché.
-- Idempotente. Jamais de SQLSTATE 40001.
BEGIN;

-- ============================================================
-- 1. Unicité de l'identifiant Ten'Up
-- ============================================================
CREATE UNIQUE INDEX IF NOT EXISTS clubs_tenup_club_id_key
  ON public.clubs (tenup_club_id) WHERE tenup_club_id IS NOT NULL;

-- ============================================================
-- 2. Création self-serve avec l'identifiant Ten'Up et le nom court
-- ============================================================
DROP FUNCTION IF EXISTS public.club_self_serve_create(uuid, text, text, text, text, text, text, text, text);

-- Corps de 2026102601, plus : identifiant Ten'Up (format, unicité → PT410, sérialisé par un
-- verrou consultatif pris APRÈS celui du slug — même ordre partout, pas d'interblocage) et nom
-- court (1 à 12 caractères). Le rejeu (même adresse, même slug, club encore `pending`) reste
-- prioritaire : il ne recrée rien et renvoie `created = false`.
CREATE OR REPLACE FUNCTION public.club_self_serve_create(
  p_club uuid, p_email text, p_name text, p_city text, p_sport text, p_slug text,
  p_color text, p_logo text, p_hero_image text,
  p_tenup_club_id text DEFAULT NULL, p_short_name text DEFAULT NULL)
  RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  account uuid;
  existing uuid;
  v_email text := lower(btrim(p_email));
  v_name text := btrim(p_name);
  v_city text := btrim(p_city);
  v_color text := lower(btrim(p_color));
  v_short text := nullif(btrim(p_short_name), '');
  v_tenup text := nullif(btrim(p_tenup_club_id), '');
  images text := '/storage/v1/object/public/content-images/' || p_club || '/config/';
  violated text;
BEGIN
  IF p_club IS NULL OR v_email IS NULL OR v_email !~ '^[^@\s]+@[^@\s]+\.[^@\s]+$' OR length(v_email) > 254
     OR v_name IS NULL OR length(v_name) NOT BETWEEN 2 AND 80
     OR v_city IS NULL OR length(v_city) NOT BETWEEN 1 AND 80
     OR p_sport IS DISTINCT FROM 'tennis'
     OR v_color IS NULL OR v_color !~ '^#[0-9a-f]{6}$'
     OR (p_logo IS NOT NULL AND (p_logo NOT LIKE 'https://%' OR position(images IN p_logo) = 0))
     OR (p_hero_image IS NOT NULL AND (p_hero_image NOT LIKE 'https://%' OR position(images IN p_hero_image) = 0))
     OR (v_short IS NOT NULL AND length(v_short) > 12)
     OR (v_tenup IS NOT NULL AND v_tenup !~ '^[0-9]{1,12}$') THEN
    RAISE EXCEPTION 'VALIDATION_ERROR' USING ERRCODE = 'PT400';
  END IF;
  IF public.club_slug_problem(p_slug) IS NOT NULL THEN
    RAISE EXCEPTION 'SLUG_UNAVAILABLE' USING ERRCODE = 'PT409';
  END IF;

  SELECT u.id INTO account FROM auth.users u WHERE lower(u.email) = v_email LIMIT 1;
  IF account IS NULL THEN RAISE EXCEPTION 'ACCOUNT_MISSING' USING ERRCODE = 'PT400'; END IF;

  -- Sérialise les demandes sur un même slug, puis sur un même club Ten'Up (les UNIQUE restent le filet).
  PERFORM pg_advisory_xact_lock(hashtextextended('club_self_serve_slug:' || p_slug, 0));
  SELECT c.id INTO existing FROM public.clubs c
   WHERE c.slug = p_slug AND c.status = 'pending'
     AND EXISTS (SELECT 1 FROM public.club_members m
                  WHERE m.club_id = c.id AND m.user_id = account AND m.role = 'admin');
  IF existing IS NOT NULL THEN
    RETURN jsonb_build_object('club_id', existing, 'created', false);
  END IF;
  IF v_tenup IS NOT NULL THEN
    PERFORM pg_advisory_xact_lock(hashtextextended('club_self_serve_tenup:' || v_tenup, 0));
    IF EXISTS (SELECT 1 FROM public.clubs c WHERE c.tenup_club_id = v_tenup) THEN
      RAISE EXCEPTION 'ALREADY_ON_FEELIKE' USING ERRCODE = 'PT410';
    END IF;
  END IF;
  IF EXISTS (SELECT 1 FROM public.clubs c WHERE c.slug = p_slug) THEN
    RAISE EXCEPTION 'SLUG_UNAVAILABLE' USING ERRCODE = 'PT409';
  END IF;

  BEGIN
    INSERT INTO public.clubs (id, slug, name, sport, status, plan, created_via, site_published, tenup_club_id)
    VALUES (p_club, p_slug, v_name, p_sport, 'pending', 'trial', 'self_serve', false, v_tenup);
  EXCEPTION WHEN unique_violation THEN
    GET STACKED DIAGNOSTICS violated = CONSTRAINT_NAME;
    IF violated = 'clubs_tenup_club_id_key' THEN
      RAISE EXCEPTION 'ALREADY_ON_FEELIKE' USING ERRCODE = 'PT410';
    END IF;
    RAISE EXCEPTION 'SLUG_UNAVAILABLE' USING ERRCODE = 'PT409';
  END;

  UPDATE public.club_settings
     SET config = coalesce(config, '{}'::jsonb)
       || jsonb_build_object('brand', jsonb_strip_nulls(jsonb_build_object(
            'name', v_name, 'city', v_city, 'sport', 'Tennis', 'color', v_color, 'logo', p_logo,
            'short_name', v_short)))
       || CASE WHEN p_hero_image IS NULL THEN '{}'::jsonb
               ELSE jsonb_build_object('home', jsonb_build_object('hero_image', p_hero_image)) END
   WHERE club_id = p_club;
  IF NOT FOUND THEN RAISE EXCEPTION 'SETTINGS_MISSING'; END IF;

  INSERT INTO public.club_members (club_id, user_id, role) VALUES (p_club, account, 'admin');
  RETURN jsonb_build_object('club_id', p_club, 'created', true);
END $$;

REVOKE ALL ON FUNCTION public.club_self_serve_create(uuid, text, text, text, text, text, text, text, text, text, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.club_self_serve_create(uuid, text, text, text, text, text, text, text, text, text, text) TO service_role;

-- ============================================================
-- 3. Cache des lectures anonymes (Edge `tenup-lookup`)
-- ============================================================
-- `payload` : ce que le tunnel affiche (nom, adresse, sports, terrains) et les chemins des images
-- copiées dans `content-images/_lookup/<id>/` ; `images` : ces chemins, pour la purge. Aucune
-- donnée personnelle (ni téléphone, ni e-mail, ni bureau).
CREATE TABLE IF NOT EXISTS public.tenup_lookup_cache (
  tenup_club_id text PRIMARY KEY CHECK (tenup_club_id ~ '^[0-9]{1,12}$'),
  payload jsonb NOT NULL,
  images text[] NOT NULL DEFAULT '{}',
  read_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS tenup_lookup_cache_read_at ON public.tenup_lookup_cache (read_at);
ALTER TABLE public.tenup_lookup_cache ENABLE ROW LEVEL SECURITY;
-- Aucune policy : service role seulement.
REVOKE ALL ON TABLE public.tenup_lookup_cache FROM PUBLIC, anon, authenticated;
GRANT ALL ON TABLE public.tenup_lookup_cache TO service_role;

-- ============================================================
-- 4. Limite de débit des lectures anonymes
-- ============================================================
ALTER TABLE public.club_self_serve_attempts DROP CONSTRAINT IF EXISTS club_self_serve_attempts_bucket_check;
ALTER TABLE public.club_self_serve_attempts ADD CONSTRAINT club_self_serve_attempts_bucket_check
  CHECK (bucket ~ '^(ip|email|lookup-ip):[0-9a-f]{64}$');

-- 20 lectures par heure et par IP (empreinte SHA-256 calculée par l'Edge). Appelée seulement
-- quand la lecture part vers le worker : une réponse du cache ou « déjà sur feelike » ne compte
-- pas. Une demande refusée n'est pas comptée. Renvoie false au-delà, sans rien écrire.
CREATE OR REPLACE FUNCTION public.tenup_lookup_throttle(p_ip text)
  RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE ip_bucket text := 'lookup-ip:' || p_ip;
BEGIN
  IF p_ip IS NULL OR p_ip !~ '^[0-9a-f]{64}$' THEN
    RAISE EXCEPTION 'VALIDATION_ERROR' USING ERRCODE = 'PT400';
  END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended('club_self_serve:' || ip_bucket, 0));
  IF (SELECT count(*) FROM public.club_self_serve_attempts
       WHERE bucket = ip_bucket AND created_at > now() - interval '1 hour') >= 20 THEN
    RETURN false;
  END IF;
  INSERT INTO public.club_self_serve_attempts (bucket) VALUES (ip_bucket);
  RETURN true;
END $$;

REVOKE ALL ON FUNCTION public.tenup_lookup_throttle(text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.tenup_lookup_throttle(text) TO service_role;

COMMIT;
