-- Multi-tenant — PR2 : tournaments rejoint le socle multi-tenant.
--
-- ⚠️ La table `tournaments` (persistance du TMC Planner) a été créée à la main via
-- le dashboard Supabase (PROD) et n'a jamais été posée en migration : elle est donc
-- ABSENTE du projet dev et de toute base reconstruite depuis les migrations.
-- Cette migration la met sous gestion des migrations en la (re)créant à l'identique
-- de PROD, puis lui ajoute `club_id` (angle mort de PR1). Tout est idempotent :
--   * PROD (table déjà présente) -> CREATE ignoré, ALTER ajoute club_id + backfill CAC ;
--   * dev / base vierge          -> CREATE crée la table, ALTER ajoute club_id (0 ligne).
--
-- Schéma répliqué depuis PROD (information_schema + pg_constraint + pg_policies) :
--   PK id, FK user_id -> auth.users(id) ON DELETE CASCADE, RLS + policy auth-based.
-- Même patron que PR1 pour club_id : NULLABLE, sans FK -> clubs(id) (verrou en PR3).

-- ============================================================
-- TABLE tournaments (réplique du schéma PROD)
-- ============================================================
CREATE TABLE IF NOT EXISTS public.tournaments (
  id         UUID        DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id    UUID        NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  config     JSONB       NOT NULL,
  schedule   JSONB,
  created_at TIMESTAMPTZ DEFAULT now()
);

ALTER TABLE public.tournaments ENABLE ROW LEVEL SECURITY;

-- Policy socle (pré-multi-tenant) répliquée de PROD : tout utilisateur authentifié
-- a accès. Le cloisonnement par club_id (RLS tenant_isolation) arrive en PR3.
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public' AND tablename = 'tournaments'
      AND policyname = 'authenticated users see all'
  ) THEN
    CREATE POLICY "authenticated users see all"
      ON public.tournaments FOR ALL TO public
      USING (auth.uid() IS NOT NULL);
  END IF;
END $$;

-- Grants répliqués de PROD (la RLS fait le gating ; anon est de fait bloqué par la
-- policy auth.uid() IS NOT NULL).
GRANT ALL ON TABLE public.tournaments TO anon, authenticated, service_role;

-- ============================================================
-- PR2 — colonne club_id (NULLABLE, sans FK — verrou en PR3) + backfill CAC
-- ============================================================
ALTER TABLE public.tournaments ADD COLUMN IF NOT EXISTS club_id UUID;

UPDATE public.tournaments
   SET club_id = (SELECT id FROM clubs WHERE slug = 'cac-tennis')
 WHERE club_id IS NULL;
