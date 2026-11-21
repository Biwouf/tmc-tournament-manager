-- Onboarding « effet wahou », W3 — le logo Ten'Up « pimpé », dit et réversible.
-- Brief `SAAS_11_onboarding_tenup` §13.4 ; spec SAAS_ONBOARDING.md §14.7.
--
-- 1. `club_self_serve_create` gagne trois paramètres facultatifs, passés par `club-signup` quand le
--    club vient de Ten'Up et que le worker a nettoyé son logo :
--      - `p_logo_original` : l'original Ten'Up copié (`brand.logo_original`), restaurable dans
--        Configuration › Identité ;
--      - `p_logo_variants` : les 7 variantes PNG copiées dans `<club>/config/logo/`
--        (`brand.logo_variants`, `{ "clean-1024": url, … }`) ;
--      - `p_logo_choice` : `{ verdict, choice }` → événement `logo_choice` (combien gardent
--        l'original). `brand.logo` reste `p_logo`, le choix fait sur l'écran 02.
--    Sans eux, l'appel est exactement celui de 2026111520.
-- 2. `onboarding_events` accepte `logo_choice`, écrit par le serveur seulement (le club est encore
--    `pending` ; `onboarding_event_log` n'est pas modifiée). La contrainte est ÉTENDUE, pas
--    réécrite : W1 (`2026111903_onboarding_video_events.sql`) ajoute ses `video_*` en parallèle.
-- 3. `club_public_brand` renvoie aussi `logo_variants` : la PWA en tire ses icônes
--    d'installation quand `brand.logo` est le logo retouché (`appIcons.ts`).
-- Le CAC (`internal`, `console`) n'est pas concerné : aucune de ces clés ne lui est écrite.
-- Idempotente. Jamais de SQLSTATE 40001.
BEGIN;

-- ============================================================
-- 1. Création self-serve avec le logo retouché
-- ============================================================
DROP FUNCTION IF EXISTS public.club_self_serve_create(uuid, text, text, text, text, text, text, text, text, text, text);

-- Corps de 2026111520, plus les trois paramètres du logo.
CREATE OR REPLACE FUNCTION public.club_self_serve_create(
  p_club uuid, p_email text, p_name text, p_city text, p_sport text, p_slug text,
  p_color text, p_logo text, p_hero_image text,
  p_tenup_club_id text DEFAULT NULL, p_short_name text DEFAULT NULL,
  p_logo_original text DEFAULT NULL, p_logo_variants jsonb DEFAULT NULL, p_logo_choice jsonb DEFAULT NULL)
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
  variant_names text[] := ARRAY['any-512', 'apple-180', 'avatar-256', 'clean-1024', 'email-128', 'maskable-192', 'maskable-512'];
BEGIN
  IF p_club IS NULL OR v_email IS NULL OR v_email !~ '^[^@\s]+@[^@\s]+\.[^@\s]+$' OR length(v_email) > 254
     OR v_name IS NULL OR length(v_name) NOT BETWEEN 2 AND 80
     OR v_city IS NULL OR length(v_city) NOT BETWEEN 1 AND 80
     OR p_sport IS DISTINCT FROM 'tennis'
     OR v_color IS NULL OR v_color !~ '^#[0-9a-f]{6}$'
     OR (p_logo IS NOT NULL AND (p_logo NOT LIKE 'https://%' OR position(images IN p_logo) = 0))
     OR (p_hero_image IS NOT NULL AND (p_hero_image NOT LIKE 'https://%' OR position(images IN p_hero_image) = 0))
     OR (v_short IS NOT NULL AND length(v_short) > 12)
     OR (v_tenup IS NOT NULL AND v_tenup !~ '^[0-9]{1,12}$')
     -- W3 : original Ten'Up, variantes du logo retouché (`<club>/config/logo/`) et choix du tunnel.
     OR (p_logo_original IS NOT NULL AND (p_logo_original NOT LIKE 'https://%' OR position(images IN p_logo_original) = 0))
     OR (p_logo_variants IS NOT NULL AND (jsonb_typeof(p_logo_variants) <> 'object'
         OR (SELECT array_agg(k ORDER BY k) FROM jsonb_object_keys(p_logo_variants) k) IS DISTINCT FROM variant_names
         OR EXISTS (SELECT 1 FROM jsonb_each(p_logo_variants) e WHERE jsonb_typeof(e.value) <> 'string'
                     OR (e.value #>> '{}') NOT LIKE 'https://%' OR position(images || 'logo/' IN (e.value #>> '{}')) = 0)))
     OR (p_logo_choice IS NOT NULL AND (jsonb_typeof(p_logo_choice) <> 'object'
         OR (SELECT array_agg(k ORDER BY k) FROM jsonb_object_keys(p_logo_choice) k) IS DISTINCT FROM ARRAY['choice', 'verdict']
         OR (p_logo_choice -> 'verdict') NOT IN ('"cleaned"'::jsonb, '"unchanged"'::jsonb, '"monogram"'::jsonb)
         OR (p_logo_choice -> 'choice') NOT IN ('"clean"'::jsonb, '"original"'::jsonb, '"monogram"'::jsonb))) THEN
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
            'short_name', v_short, 'logo_original', p_logo_original, 'logo_variants', p_logo_variants)))
       || CASE WHEN p_hero_image IS NULL THEN '{}'::jsonb
               ELSE jsonb_build_object('home', jsonb_build_object('hero_image', p_hero_image)) END
   WHERE club_id = p_club;
  IF NOT FOUND THEN RAISE EXCEPTION 'SETTINGS_MISSING'; END IF;

  INSERT INTO public.club_members (club_id, user_id, role) VALUES (p_club, account, 'admin');
  -- W3 : retouché gardé ou original préféré, une fois par club (le rejeu n'arrive pas ici).
  IF p_logo_choice IS NOT NULL THEN
    INSERT INTO public.onboarding_events (club_id, name, props) VALUES (p_club, 'logo_choice', p_logo_choice);
  END IF;
  RETURN jsonb_build_object('club_id', p_club, 'created', true);
END $$;


REVOKE ALL ON FUNCTION public.club_self_serve_create(uuid, text, text, text, text, text, text, text, text, text, text, text, jsonb, jsonb) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.club_self_serve_create(uuid, text, text, text, text, text, text, text, text, text, text, text, jsonb, jsonb) TO service_role;

-- ============================================================
-- 2. Événement `logo_choice`
-- ============================================================
-- La liste en place est reprise telle quelle (avec les `video_*` de W1 si elle est déjà
-- appliquée) et `logo_choice` y est ajouté.
DO $$
DECLARE def text;
BEGIN
  SELECT pg_get_constraintdef(oid) INTO def FROM pg_constraint
   WHERE conrelid = 'public.onboarding_events'::regclass AND conname = 'onboarding_events_name_check';
  IF def IS NULL OR position('logo_choice' IN def) > 0 THEN RETURN; END IF;
  IF position('ARRAY[' IN def) = 0 THEN RAISE EXCEPTION 'onboarding_events_name_check inattendue : %', def; END IF;
  ALTER TABLE public.onboarding_events DROP CONSTRAINT onboarding_events_name_check;
  EXECUTE 'ALTER TABLE public.onboarding_events ADD CONSTRAINT onboarding_events_name_check '
    || replace(def, 'ARRAY[', 'ARRAY[''logo_choice''::text, ');
END $$;

-- ============================================================
-- 3. Marque publique : les variantes du logo
-- ============================================================
CREATE OR REPLACE FUNCTION public.club_public_brand(p_club uuid) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=public AS $$
DECLARE brand jsonb;
BEGIN
 IF NOT EXISTS(SELECT 1 FROM clubs WHERE id=p_club AND status='active') THEN RAISE EXCEPTION 'CLUB_UNAVAILABLE'; END IF;
 SELECT s.config->'brand' INTO brand FROM club_settings s WHERE s.club_id=p_club;
 RETURN jsonb_build_object('brand',jsonb_build_object(
  'logo',brand->>'logo','color',brand->>'color',
  'color_secondary',brand->>'color_secondary','color_accent',brand->>'color_accent',
  'short_name',brand->>'short_name',
  'logo_variants',CASE WHEN jsonb_typeof(brand->'logo_variants')='object' THEN brand->'logo_variants' END));
END $$;
REVOKE ALL ON FUNCTION public.club_public_brand(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.club_public_brand(uuid) TO anon,authenticated;

COMMIT;
