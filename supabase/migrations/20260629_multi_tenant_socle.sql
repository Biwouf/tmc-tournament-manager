-- Multi-tenant — PR1 : migration SQL socle (expand, non-bloquante).
-- Voir docs/specs/MULTI_TENANT.md (Phase 1, PR1).
--
-- Périmètre PR1 (expand → migrate, sans contract) :
--   * tables socle : clubs, club_members, club_settings + enum club_role
--   * flag super-admin : profiles.is_super_admin
--   * colonne club_id NULLABLE (sans FK) sur toutes les tables métier
--   * ligne CAC Tennis (club #1) + club_settings vide + backfill club_id
--
-- Hors PR1 (reportés à PR3, le verrouillage) :
--   * club_id NOT NULL + FK -> clubs(id)
--   * RLS multi-tenant (tenant_isolation) + GRANTs alignés
--   * helpers SQL auth_club_ids() / auth.is_super_admin()
--   * seeding des club_members des comptes BO existants + attribution des rôles
--
-- Réutilise set_updated_at() défini dans 20260418_events.sql.

-- ============================================================
-- ENUM club_role
-- ============================================================
DO $$ BEGIN
  CREATE TYPE club_role AS ENUM ('admin', 'manager', 'member');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- ============================================================
-- TABLE clubs
-- ============================================================
CREATE TABLE IF NOT EXISTS clubs (
  id            UUID        DEFAULT gen_random_uuid() PRIMARY KEY,
  slug          TEXT        NOT NULL UNIQUE,          -- sous-domaine : "cac-tennis"
  name          TEXT        NOT NULL,                 -- "CAC Tennis Club"
  sport         TEXT        NOT NULL DEFAULT 'tennis',-- préparé multi-sport (vision long terme)
  status        TEXT        NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'suspended')),
  custom_domain TEXT        UNIQUE,                   -- réservé à une phase ultérieure
  created_at    TIMESTAMPTZ DEFAULT now() NOT NULL,
  updated_at    TIMESTAMPTZ DEFAULT now() NOT NULL
);

DROP TRIGGER IF EXISTS clubs_updated_at ON clubs;
CREATE TRIGGER clubs_updated_at
  BEFORE UPDATE ON clubs
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

ALTER TABLE clubs ENABLE ROW LEVEL SECURITY;

-- Lecture publique nécessaire à la résolution du tenant par sous-domaine
-- (id, slug, name, sport, status) AVANT authentification (cf. MULTI_TENANT §3).
-- Les écritures (provisioning) passent par le service role / la console
-- super-admin (PR2+) : aucune policy d'écriture pour anon/authenticated en PR1.
CREATE POLICY "clubs_select_anon"          ON clubs FOR SELECT TO anon          USING (true);
CREATE POLICY "clubs_select_authenticated" ON clubs FOR SELECT TO authenticated USING (true);

GRANT SELECT ON TABLE public.clubs TO anon, authenticated;

-- ============================================================
-- TABLE club_members (appartenance compte ↔ club + rôle)
-- ============================================================
CREATE TABLE IF NOT EXISTS club_members (
  id         UUID        DEFAULT gen_random_uuid() PRIMARY KEY,
  club_id    UUID        NOT NULL REFERENCES clubs(id) ON DELETE CASCADE,
  user_id    UUID        NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  role       club_role   NOT NULL,
  created_at TIMESTAMPTZ DEFAULT now() NOT NULL,
  UNIQUE (club_id, user_id)
);

ALTER TABLE club_members ENABLE ROW LEVEL SECURITY;

-- L'utilisateur lit ses propres appartenances (ClubContext / useClubRole, PR2/PR4).
-- Pas d'accès anon (membership privé). Écritures (invitation / console) : PR4/PR5.
CREATE POLICY "club_members_select_own"
  ON club_members FOR SELECT TO authenticated USING (user_id = auth.uid());

GRANT SELECT ON TABLE public.club_members TO authenticated;

-- ============================================================
-- TABLE club_settings (config vitrine + réglages tenant)
-- ============================================================
CREATE TABLE IF NOT EXISTS club_settings (
  club_id    UUID        PRIMARY KEY REFERENCES clubs(id) ON DELETE CASCADE,
  config     JSONB       NOT NULL DEFAULT '{}'::jsonb,
  updated_at TIMESTAMPTZ DEFAULT now() NOT NULL
);

DROP TRIGGER IF EXISTS club_settings_updated_at ON club_settings;
CREATE TRIGGER club_settings_updated_at
  BEFORE UPDATE ON club_settings
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

ALTER TABLE club_settings ENABLE ROW LEVEL SECURITY;

-- Lecture authenticated (membres). L'exposition anon (vitrine) et l'écriture
-- admin-scopée arrivent avec la config administrable (Phase 3 / Phase 4).
CREATE POLICY "club_settings_select_authenticated"
  ON club_settings FOR SELECT TO authenticated USING (true);

GRANT SELECT ON TABLE public.club_settings TO authenticated;

-- ============================================================
-- SUPER-ADMIN — flag global porté par le profil
-- ============================================================
-- Court-circuite la RLS par club via le futur helper auth.is_super_admin() (PR3).
ALTER TABLE profiles ADD COLUMN IF NOT EXISTS is_super_admin BOOLEAN NOT NULL DEFAULT false;

-- ============================================================
-- club_id NULLABLE sur les tables métier (sans FK — verrou en PR3)
-- profiles EXCLU : appartenance via club_members (D5, compte multi-clubs).
-- ============================================================
ALTER TABLE events            ADD COLUMN IF NOT EXISTS club_id UUID;
ALTER TABLE live_matches      ADD COLUMN IF NOT EXISTS club_id UUID;
ALTER TABLE actus             ADD COLUMN IF NOT EXISTS club_id UUID;
ALTER TABLE team_saisons      ADD COLUMN IF NOT EXISTS club_id UUID;
ALTER TABLE team_competitions ADD COLUMN IF NOT EXISTS club_id UUID;
ALTER TABLE team_equipes      ADD COLUMN IF NOT EXISTS club_id UUID;
ALTER TABLE team_etapes       ADD COLUMN IF NOT EXISTS club_id UUID;
ALTER TABLE team_rencontres   ADD COLUMN IF NOT EXISTS club_id UUID;
ALTER TABLE team_match_lines  ADD COLUMN IF NOT EXISTS club_id UUID;

-- ============================================================
-- CLUB #1 — CAC Tennis (migration en place, D8)
-- ============================================================
INSERT INTO clubs (slug, name, sport, status)
VALUES ('cac-tennis', 'CAC Tennis Club', 'tennis', 'active')
ON CONFLICT (slug) DO NOTHING;

INSERT INTO club_settings (club_id)
SELECT id FROM clubs WHERE slug = 'cac-tennis'
ON CONFLICT (club_id) DO NOTHING;

-- ============================================================
-- BACKFILL — toutes les lignes existantes appartiennent à CAC
-- ============================================================
DO $$
DECLARE
  cac_id UUID;
BEGIN
  SELECT id INTO cac_id FROM clubs WHERE slug = 'cac-tennis';

  UPDATE events            SET club_id = cac_id WHERE club_id IS NULL;
  UPDATE live_matches      SET club_id = cac_id WHERE club_id IS NULL;
  UPDATE actus             SET club_id = cac_id WHERE club_id IS NULL;
  UPDATE team_saisons      SET club_id = cac_id WHERE club_id IS NULL;
  UPDATE team_competitions SET club_id = cac_id WHERE club_id IS NULL;
  UPDATE team_equipes      SET club_id = cac_id WHERE club_id IS NULL;
  UPDATE team_etapes       SET club_id = cac_id WHERE club_id IS NULL;
  UPDATE team_rencontres   SET club_id = cac_id WHERE club_id IS NULL;
  UPDATE team_match_lines  SET club_id = cac_id WHERE club_id IS NULL;
END $$;
