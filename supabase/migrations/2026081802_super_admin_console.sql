-- Multi-tenant — PR5 : console super-admin (provisioning des clubs).
-- Voir docs/briefs/PR5_console_super_admin.md §4 et §5, docs/specs/MULTI_TENANT.md §5 (D4, D9).
--
-- Pré-requis : 2026081801_profiles_column_grants.sql (§0 du brief) appliquée AVANT.
-- Sans elle, ouvrir l'écriture de `clubs` au super-admin revient à l'ouvrir à tout le monde,
-- puisque le flag `profiles.is_super_admin` était auto-attribuable.
--
-- DÉCISION (brief §4) : créer / suspendre un club ne manipule aucun secret → pas d'Edge
-- Function, pas de service role. On reste sur le patron maison : policies RLS + client
-- Supabase standard, adossées au helper `public.is_super_admin()` posé par PR3.
--
-- Idempotente.
--
-- ROLLBACK
--   DROP TRIGGER  IF EXISTS clubs_create_settings ON public.clubs;
--   DROP FUNCTION IF EXISTS public.create_club_settings();
--   ALTER TABLE public.clubs DROP CONSTRAINT IF EXISTS clubs_slug_format;
--   DROP POLICY IF EXISTS "clubs_insert_super_admin"          ON public.clubs;
--   DROP POLICY IF EXISTS "clubs_update_super_admin"          ON public.clubs;
--   DROP POLICY IF EXISTS "club_settings_insert_super_admin"  ON public.club_settings;
--   DROP POLICY IF EXISTS "club_settings_update_super_admin"  ON public.club_settings;
--   DROP POLICY IF EXISTS "club_members_select_super_admin"   ON public.club_members;
--   REVOKE INSERT, UPDATE ON TABLE public.clubs         FROM authenticated;
--   REVOKE INSERT, UPDATE ON TABLE public.club_settings FROM authenticated;
--   (les policies SELECT de PR1 et club_members_select_own ne sont pas touchées)

-- ============================================================
-- 1. Garde-fou : les slugs existants doivent passer la contrainte du §2
--    (un ALTER TABLE … ADD CONSTRAINT échouerait sinon, avec un message peu parlant)
-- ============================================================
DO $$
DECLARE offenders text;
BEGIN
  SELECT string_agg(slug, ', ') INTO offenders
    FROM public.clubs
   WHERE slug !~ '^[a-z0-9]([a-z0-9-]*[a-z0-9])?$'
      OR length(slug) < 2 OR length(slug) > 32
      OR slug LIKE 'app-%'
      OR slug IN ('admin','app','www','api','mail','static','assets','feelike');
  IF offenders IS NOT NULL THEN
    RAISE EXCEPTION 'Slug(s) incompatible(s) avec la contrainte clubs_slug_format : %. Les renommer avant d''appliquer cette migration.', offenders;
  END IF;
END $$;

-- ============================================================
-- 2. Contraintes sur clubs.slug — le slug est devenu une adresse DNS (D9)
-- ============================================================
--   * format sous-domaine : minuscules, chiffres, tirets internes uniquement ;
--   * 2 à 32 caractères ;
--   * préfixe `app-` interdit : `app-<slug>.feelike.app` est réservé à la PWA, un club
--     nommé `app-tennis` collisionnerait avec la PWA du club `tennis` ;
--   * slugs réservés par la plateforme (`admin.feelike.app` = le BO).
-- Les mêmes règles sont appliquées côté front (src/pages/SuperAdminPage.tsx) : ce CHECK
-- est le filet, pas le message d'erreur utilisateur.
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'clubs_slug_format'
      AND conrelid = 'public.clubs'::regclass
  ) THEN
    ALTER TABLE public.clubs ADD CONSTRAINT clubs_slug_format CHECK (
      slug ~ '^[a-z0-9]([a-z0-9-]*[a-z0-9])?$'
      AND length(slug) BETWEEN 2 AND 32
      AND slug NOT LIKE 'app-%'
      AND slug NOT IN ('admin','app','www','api','mail','static','assets','feelike')
    );
  END IF;
END $$;

-- ============================================================
-- 3. Policies super-admin sur clubs (provisioning)
-- ============================================================
-- Les policies SELECT de PR1 (`clubs_select_anon` / `clubs_select_authenticated`,
-- USING true) restent intactes : c'est la condition de la résolution du tenant par
-- sous-domaine avant authentification (MULTI_TENANT §3).
-- PAS de policy DELETE : on suspend un club, on ne le supprime pas (la cascade
-- toucherait les 10 tables métier).
DROP POLICY IF EXISTS "clubs_insert_super_admin" ON public.clubs;
CREATE POLICY "clubs_insert_super_admin"
  ON public.clubs FOR INSERT TO authenticated
  WITH CHECK (public.is_super_admin());

DROP POLICY IF EXISTS "clubs_update_super_admin" ON public.clubs;
CREATE POLICY "clubs_update_super_admin"
  ON public.clubs FOR UPDATE TO authenticated
  USING (public.is_super_admin())
  WITH CHECK (public.is_super_admin());

-- Sans GRANT, PostgREST refuse l'écriture quelle que soit la RLS (PR1 n'avait posé que
-- GRANT SELECT). Pas de DELETE, en miroir de l'absence de policy.
GRANT INSERT, UPDATE ON TABLE public.clubs TO authenticated;

-- ============================================================
-- 4. Policies super-admin sur club_settings
-- ============================================================
-- Le trigger du §6 crée la ligne à l'insertion d'un club ; ces policies servent à la
-- console pour réparer un club dont la ligne manquerait (club créé avant ce trigger).
-- Le cloisonnement par club de la lecture `club_settings` reste la dette §2.4, traitée
-- en PR6 — ne pas l'anticiper ici.
DROP POLICY IF EXISTS "club_settings_insert_super_admin" ON public.club_settings;
CREATE POLICY "club_settings_insert_super_admin"
  ON public.club_settings FOR INSERT TO authenticated
  WITH CHECK (public.is_super_admin());

DROP POLICY IF EXISTS "club_settings_update_super_admin" ON public.club_settings;
CREATE POLICY "club_settings_update_super_admin"
  ON public.club_settings FOR UPDATE TO authenticated
  USING (public.is_super_admin())
  WITH CHECK (public.is_super_admin());

GRANT INSERT, UPDATE ON TABLE public.club_settings TO authenticated;

-- ============================================================
-- 5. Lecture de club_members par le super-admin
-- ============================================================
-- `club_members_select_own` (PR1) ne montre que ses propres appartenances : la console
-- ne pourrait ni compter les membres d'un club ni signaler « ce club n'a pas encore
-- d'admin », qui est justement l'état d'un club fraîchement créé.
-- Lecture seule : les écritures sur club_members restent l'exclusivité de l'Edge
-- Function `invite-user` (service role, PR4).
DROP POLICY IF EXISTS "club_members_select_super_admin" ON public.club_members;
CREATE POLICY "club_members_select_super_admin"
  ON public.club_members FOR SELECT TO authenticated
  USING (public.is_super_admin());

-- GRANT SELECT déjà posé par PR1 (20260629). Aucun grant d'écriture : volontaire.

-- ============================================================
-- 6. Trigger — un club a TOUJOURS sa ligne club_settings
-- ============================================================
-- Invariant porté par la base plutôt que par deux inserts successifs côté front : un
-- échec entre les deux laisserait un club à moitié provisionné (brief §4).
-- SECURITY DEFINER : la ligne est créée même si l'appelant n'a pas de droit d'écriture
-- sur club_settings.
CREATE OR REPLACE FUNCTION public.create_club_settings()
  RETURNS TRIGGER
  LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  INSERT INTO public.club_settings (club_id) VALUES (NEW.id)
  ON CONFLICT (club_id) DO NOTHING;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS clubs_create_settings ON public.clubs;
CREATE TRIGGER clubs_create_settings
  AFTER INSERT ON public.clubs
  FOR EACH ROW EXECUTE FUNCTION public.create_club_settings();

-- Rattrapage : les clubs déjà en base sans ligne club_settings (aucun aujourd'hui, mais
-- la migration doit pouvoir être rejouée sur une base réparée à la main).
INSERT INTO public.club_settings (club_id)
SELECT c.id FROM public.clubs c
 WHERE NOT EXISTS (SELECT 1 FROM public.club_settings s WHERE s.club_id = c.id);
