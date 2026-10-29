-- SaaS S2 — socle self-serve : un inconnu crée son club en essai de 30 jours.
-- Voir docs/specs/SAAS_ONBOARDING.md et docs/briefs/SAAS_03_S2_signup_backend.md.
--
-- Cycle de vie : l'Edge Function `club-signup` (service role) appelle
-- `club_self_serve_create` → club `pending`, réglages, appartenance admin, en une
-- transaction. Le premier passage authentifié par le lien magique appelle
-- `club_self_serve_activate` → `active` + fin d'essai à 30 jours. Un club resté `pending`
-- 7 jours est purgé par `club-signup-purge` (fichiers par l'API Storage, puis
-- `club_self_serve_purge`).
--
-- Non bloquante pour l'existant : les clubs en base deviennent `internal` / `console` /
-- `site_published = true`, et toutes les résolutions de club filtraient déjà
-- `status = 'active'`. À appliquer AVANT de déployer la vitrine et le BO de cette PR
-- (ils lisent `site_published` et appellent `club_self_serve_activate`).
--
-- Idempotente.
--
-- ROLLBACK
--   DROP FUNCTION IF EXISTS public.slug_available(text), public.club_slug_problem(text),
--     public.club_self_serve_throttle(text,text),
--     public.club_self_serve_create(uuid,text,text,text,text,text,text,text,text),
--     public.club_self_serve_activate(), public.club_self_serve_purge_begin(integer),
--     public.club_self_serve_purge(uuid);
--   DROP TABLE IF EXISTS public.club_self_serve_attempts;
--   (supprimer d'abord les clubs `pending`, puis) policies SELECT de clubs et
--   club_settings_select_anon remises à USING (true) ; GRANT INSERT, UPDATE ON clubs TO
--   authenticated ; colonnes plan, trial_ends_at, created_via, site_published et
--   contraintes clubs_status_check / clubs_self_serve_lifecycle retirées.

-- ============================================================
-- 1. Colonnes et cycle de vie
-- ============================================================
ALTER TABLE public.clubs DROP CONSTRAINT IF EXISTS clubs_status_check;
ALTER TABLE public.clubs ADD CONSTRAINT clubs_status_check
  CHECK (status IN ('active', 'suspended', 'pending'));

ALTER TABLE public.clubs
  ADD COLUMN IF NOT EXISTS plan text NOT NULL DEFAULT 'internal'
    CONSTRAINT clubs_plan_check CHECK (plan IN ('internal', 'trial', 'saison')),
  ADD COLUMN IF NOT EXISTS trial_ends_at timestamptz,
  ADD COLUMN IF NOT EXISTS created_via text NOT NULL DEFAULT 'console'
    CONSTRAINT clubs_created_via_check CHECK (created_via IN ('console', 'self_serve')),
  ADD COLUMN IF NOT EXISTS site_published boolean NOT NULL DEFAULT true;

-- `pending` n'existe qu'en self-serve, jamais activé ; un essai activé a toujours sa fin.
-- Ce sont ces contraintes, et non l'UI, qui empêchent la console de réactiver un club
-- `pending` (fin d'essai absente) ou de remettre un club existant en `pending` (la purge
-- le supprimerait).
ALTER TABLE public.clubs DROP CONSTRAINT IF EXISTS clubs_self_serve_lifecycle;
ALTER TABLE public.clubs ADD CONSTRAINT clubs_self_serve_lifecycle CHECK (
  CASE WHEN status = 'pending'
    THEN created_via = 'self_serve' AND plan = 'trial' AND trial_ends_at IS NULL
    ELSE plan <> 'trial' OR trial_ends_at IS NOT NULL
  END
);

CREATE INDEX IF NOT EXISTS clubs_pending_created_at_idx
  ON public.clubs (created_at) WHERE status = 'pending';

-- ============================================================
-- 2. Écritures de la console : grants par colonne (même leçon que PR5 §0)
-- ============================================================
-- La RLS ne sait pas restreindre une colonne : sans ce REVOKE, le `GRANT INSERT, UPDATE`
-- de 2026081802 laisserait un super-admin (ou une faille de sa policy) écrire `plan`,
-- `trial_ends_at`, `created_via` ou `site_published`. Ces colonnes ne s'écrivent plus que
-- par le service role et les fonctions SECURITY DEFINER ci-dessous. La console n'insère
-- que `name, slug, sport` et ne met à jour que `status` (SuperAdminPage).
REVOKE INSERT, UPDATE ON TABLE public.clubs FROM authenticated;
GRANT INSERT (name, slug, sport) ON TABLE public.clubs TO authenticated;
GRANT UPDATE (status) ON TABLE public.clubs TO authenticated;

-- ============================================================
-- 3. Un club `pending` n'existe pour personne d'autre que ses admins
-- ============================================================
-- La résolution publique filtrait déjà `status = 'active'` ; cacher la ligne évite en plus
-- d'exposer le nom ou la config qu'un inconnu vient de saisir.
DROP POLICY IF EXISTS "clubs_select_anon" ON public.clubs;
CREATE POLICY "clubs_select_anon" ON public.clubs FOR SELECT TO anon
  USING (status <> 'pending');

DROP POLICY IF EXISTS "clubs_select_authenticated" ON public.clubs;
CREATE POLICY "clubs_select_authenticated" ON public.clubs FOR SELECT TO authenticated
  USING (status <> 'pending' OR id IN (SELECT public.auth_club_ids()) OR public.is_super_admin());

DROP POLICY IF EXISTS "club_settings_select_anon" ON public.club_settings;
CREATE POLICY "club_settings_select_anon" ON public.club_settings FOR SELECT TO anon
  USING (EXISTS (SELECT 1 FROM public.clubs c
                  WHERE c.id = club_settings.club_id AND c.status <> 'pending'));

-- ============================================================
-- 4. Règles du slug — copie SQL de shared/clubSlug.mjs (parité testée)
-- ============================================================
CREATE OR REPLACE FUNCTION public.club_slug_problem(p_slug text)
  RETURNS text LANGUAGE sql IMMUTABLE SET search_path = public AS $$
  SELECT CASE
    WHEN p_slug IS NULL OR p_slug !~ '^[a-z0-9]([a-z0-9-]{1,30}[a-z0-9])$' THEN 'format'
    WHEN p_slug LIKE 'app-%'
      OR p_slug IN ('admin','app','www','api','mail','static','assets','feelike') THEN 'reserved'
  END
$$;

-- Vérification en direct du tunnel. SECURITY DEFINER : un slug pris par un club `pending`
-- (invisible pour anon) est bien pris.
CREATE OR REPLACE FUNCTION public.slug_available(slug text)
  RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE problem text := public.club_slug_problem(slug_available.slug);
BEGIN
  IF problem IS NULL AND EXISTS (SELECT 1 FROM public.clubs c WHERE c.slug = slug_available.slug) THEN
    problem := 'taken';
  END IF;
  RETURN jsonb_build_object('available', problem IS NULL, 'reason', problem);
END $$;

REVOKE ALL ON FUNCTION public.club_slug_problem(text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.slug_available(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.slug_available(text) TO anon, authenticated;

-- ============================================================
-- 5. Limite de débit de l'inscription (fenêtre glissante)
-- ============================================================
-- Empreintes SHA-256 calculées par l'Edge Function : ni IP ni adresse en clair.
CREATE TABLE IF NOT EXISTS public.club_self_serve_attempts (
  id         bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  bucket     text        NOT NULL CHECK (bucket ~ '^(ip|email):[0-9a-f]{64}$'),
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS club_self_serve_attempts_bucket_idx
  ON public.club_self_serve_attempts (bucket, created_at);
ALTER TABLE public.club_self_serve_attempts ENABLE ROW LEVEL SECURITY;
-- Aucune policy, aucun droit : service role et fonctions ci-dessous uniquement.
REVOKE ALL ON TABLE public.club_self_serve_attempts FROM anon, authenticated;

-- 5 tentatives par heure et par IP, 3 par 24 h et par adresse. Une tentative refusée
-- n'est pas comptée. Renvoie false au-delà, sans rien écrire.
CREATE OR REPLACE FUNCTION public.club_self_serve_throttle(p_ip text, p_email text)
  RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE ip_bucket text := 'ip:' || p_ip; email_bucket text := 'email:' || p_email;
BEGIN
  IF p_ip !~ '^[0-9a-f]{64}$' OR p_email !~ '^[0-9a-f]{64}$' THEN
    RAISE EXCEPTION 'VALIDATION_ERROR' USING ERRCODE = 'PT400';
  END IF;
  -- Verrous dans un ordre fixe : deux demandes concurrentes ne passent pas toutes deux.
  PERFORM pg_advisory_xact_lock(hashtextextended('club_self_serve:' || b, 0))
     FROM unnest(ARRAY[email_bucket, ip_bucket]) b ORDER BY b;
  IF (SELECT count(*) FROM public.club_self_serve_attempts
       WHERE bucket = ip_bucket AND created_at > now() - interval '1 hour') >= 5
  OR (SELECT count(*) FROM public.club_self_serve_attempts
       WHERE bucket = email_bucket AND created_at > now() - interval '24 hours') >= 3 THEN
    RETURN false;
  END IF;
  INSERT INTO public.club_self_serve_attempts (bucket) VALUES (ip_bucket), (email_bucket);
  RETURN true;
END $$;

-- ============================================================
-- 6. Création atomique (appelée par l'Edge Function `club-signup`)
-- ============================================================
-- Le compte doit déjà exister (l'Edge le crée ou le retrouve avant) : la base ne crée pas
-- de compte Auth. Club, réglages (trigger `clubs_create_settings` de PR5, comme pour la
-- console), identité et appartenance admin réussissent ou échouent ensemble.
-- Rejouer avec la même adresse et le même slug sur un club encore `pending` ne recrée
-- rien : `created = false`, l'Edge renvoie seulement le lien.
CREATE OR REPLACE FUNCTION public.club_self_serve_create(
  p_club uuid, p_email text, p_name text, p_city text, p_sport text, p_slug text,
  p_color text, p_logo text, p_hero_image text)
  RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  account uuid;
  existing uuid;
  v_email text := lower(btrim(p_email));
  v_name text := btrim(p_name);
  v_city text := btrim(p_city);
  v_color text := lower(btrim(p_color));
  images text := '/storage/v1/object/public/content-images/' || p_club || '/config/';
BEGIN
  IF p_club IS NULL OR v_email IS NULL OR v_email !~ '^[^@\s]+@[^@\s]+\.[^@\s]+$' OR length(v_email) > 254
     OR v_name IS NULL OR length(v_name) NOT BETWEEN 2 AND 80
     OR v_city IS NULL OR length(v_city) NOT BETWEEN 1 AND 80
     OR p_sport IS DISTINCT FROM 'tennis'
     OR v_color IS NULL OR v_color !~ '^#[0-9a-f]{6}$'
     OR (p_logo IS NOT NULL AND (p_logo NOT LIKE 'https://%' OR position(images IN p_logo) = 0))
     OR (p_hero_image IS NOT NULL AND (p_hero_image NOT LIKE 'https://%' OR position(images IN p_hero_image) = 0)) THEN
    RAISE EXCEPTION 'VALIDATION_ERROR' USING ERRCODE = 'PT400';
  END IF;
  IF public.club_slug_problem(p_slug) IS NOT NULL THEN
    RAISE EXCEPTION 'SLUG_UNAVAILABLE' USING ERRCODE = 'PT409';
  END IF;

  SELECT u.id INTO account FROM auth.users u WHERE lower(u.email) = v_email LIMIT 1;
  IF account IS NULL THEN RAISE EXCEPTION 'ACCOUNT_MISSING' USING ERRCODE = 'PT400'; END IF;

  -- Sérialise les demandes sur un même slug (le UNIQUE reste le filet).
  PERFORM pg_advisory_xact_lock(hashtextextended('club_self_serve_slug:' || p_slug, 0));
  SELECT c.id INTO existing FROM public.clubs c
   WHERE c.slug = p_slug AND c.status = 'pending'
     AND EXISTS (SELECT 1 FROM public.club_members m
                  WHERE m.club_id = c.id AND m.user_id = account AND m.role = 'admin');
  IF existing IS NOT NULL THEN
    RETURN jsonb_build_object('club_id', existing, 'created', false);
  END IF;
  IF EXISTS (SELECT 1 FROM public.clubs c WHERE c.slug = p_slug) THEN
    RAISE EXCEPTION 'SLUG_UNAVAILABLE' USING ERRCODE = 'PT409';
  END IF;

  INSERT INTO public.clubs (id, slug, name, sport, status, plan, created_via, site_published)
  VALUES (p_club, p_slug, v_name, p_sport, 'pending', 'trial', 'self_serve', false);

  UPDATE public.club_settings
     SET config = coalesce(config, '{}'::jsonb)
       || jsonb_build_object('brand', jsonb_strip_nulls(jsonb_build_object(
            'name', v_name, 'city', v_city, 'sport', 'Tennis', 'color', v_color, 'logo', p_logo)))
       || CASE WHEN p_hero_image IS NULL THEN '{}'::jsonb
               ELSE jsonb_build_object('home', jsonb_build_object('hero_image', p_hero_image)) END
   WHERE club_id = p_club;
  IF NOT FOUND THEN RAISE EXCEPTION 'SETTINGS_MISSING'; END IF;

  INSERT INTO public.club_members (club_id, user_id, role) VALUES (p_club, account, 'admin');
  RETURN jsonb_build_object('club_id', p_club, 'created', true);
END $$;

-- ============================================================
-- 7. Activation au premier passage par le lien magique
-- ============================================================
-- Appelée par le BO central (AdminEntry) avant de lister les clubs du compte. Ne touche
-- que les clubs `pending` dont l'appelant est admin, et seulement si la session vient d'un
-- lien magique cliqué APRÈS la création du club (claim `amr` du JWT) : un club rattaché
-- à un compte existant par un tiers ne s'active pas quand ce compte se connecte par mot
-- de passe. Idempotente : un second appel ne trouve plus rien en `pending`.
CREATE OR REPLACE FUNCTION public.club_self_serve_activate()
  RETURNS SETOF uuid LANGUAGE sql VOLATILE SECURITY DEFINER SET search_path = public AS $$
  UPDATE public.clubs c
     SET status = 'active', trial_ends_at = now() + interval '30 days'
   WHERE c.status = 'pending'
     AND EXISTS (SELECT 1 FROM public.club_members m
                  WHERE m.club_id = c.id AND m.user_id = auth.uid() AND m.role = 'admin')
     AND EXISTS (SELECT 1 FROM jsonb_array_elements(
                   CASE WHEN jsonb_typeof(auth.jwt() -> 'amr') = 'array' THEN auth.jwt() -> 'amr'
                        ELSE '[]'::jsonb END) a
                  WHERE a ->> 'method' IN ('otp', 'magiclink')
                    AND (a ->> 'timestamp') ~ '^[0-9]+$'
                    AND (a ->> 'timestamp')::bigint >= floor(extract(epoch FROM c.created_at)))
  RETURNING c.id
$$;

-- ============================================================
-- 8. Purge des clubs jamais activés (7 jours)
-- ============================================================
-- Appelée par l'Edge Function `club-signup-purge` (cron quotidien) : elle supprime d'abord
-- les fichiers par l'API Storage, puis appelle `club_self_serve_purge`, puis supprime les
-- comptes renvoyés par l'API Auth.
CREATE OR REPLACE FUNCTION public.club_self_serve_purge_begin(p_limit integer DEFAULT 50)
  RETURNS SETOF uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  DELETE FROM public.club_self_serve_attempts WHERE created_at < now() - interval '2 days';
  RETURN QUERY SELECT c.id FROM public.clubs c
   WHERE c.status = 'pending' AND c.created_at < now() - interval '7 days'
   ORDER BY c.created_at LIMIT least(greatest(coalesce(p_limit, 50), 1), 200);
END $$;

-- Supprime le club s'il est toujours `pending` depuis 7 jours (cascade : réglages,
-- appartenances), et renvoie les comptes à supprimer : créés par l'inscription
-- self-serve, sans autre appartenance ni demande d'adhésion, et pas super-admin. Un
-- compte qui existait avant n'est jamais supprimé.
CREATE OR REPLACE FUNCTION public.club_self_serve_purge(p_club uuid)
  RETURNS SETOF uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE admins uuid[];
BEGIN
  PERFORM 1 FROM public.clubs c
   WHERE c.id = p_club AND c.status = 'pending' AND c.created_at < now() - interval '7 days'
   FOR UPDATE;
  IF NOT FOUND THEN RETURN; END IF;
  SELECT coalesce(array_agg(m.user_id), '{}') INTO admins
    FROM public.club_members m WHERE m.club_id = p_club;
  DELETE FROM public.clubs WHERE id = p_club;
  RETURN QUERY SELECT u.id FROM auth.users u
   WHERE u.id = ANY (admins)
     AND u.raw_app_meta_data ->> 'created_via' = 'club_signup'
     AND NOT EXISTS (SELECT 1 FROM public.club_members m WHERE m.user_id = u.id)
     AND NOT EXISTS (SELECT 1 FROM public.club_signup_requests r WHERE r.user_id = u.id)
     AND NOT EXISTS (SELECT 1 FROM public.profiles p WHERE p.id = u.id AND p.is_super_admin);
END $$;

REVOKE ALL ON FUNCTION public.club_self_serve_throttle(text, text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.club_self_serve_create(uuid, text, text, text, text, text, text, text, text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.club_self_serve_activate() FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.club_self_serve_purge_begin(integer) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.club_self_serve_purge(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.club_self_serve_throttle(text, text) TO service_role;
GRANT EXECUTE ON FUNCTION public.club_self_serve_create(uuid, text, text, text, text, text, text, text, text) TO service_role;
GRANT EXECUTE ON FUNCTION public.club_self_serve_activate() TO authenticated;
GRANT EXECUTE ON FUNCTION public.club_self_serve_purge_begin(integer) TO service_role;
GRANT EXECUTE ON FUNCTION public.club_self_serve_purge(uuid) TO service_role;
