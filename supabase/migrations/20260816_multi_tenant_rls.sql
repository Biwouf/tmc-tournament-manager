-- Multi-tenant — PR3 : verrouillage (NOT NULL + FK + RLS tenant_isolation).
-- Voir docs/specs/MULTI_TENANT.md (D1, D11, §2.3) et docs/briefs/PR3_multi_tenant_rls.md.
--
-- Pré-requis :
--   * club_id backfillé partout (PR1 20260629 + PR2 20260718) — garde-fou §2 ci-dessous ;
--   * producteurs BO + PWA envoient club_id (PR2) — vérifié sur les 10 tables ;
--   * PR2 déployée en prod AVANT d'appliquer ce fichier en prod (sinon une session en
--     ancien code écrirait sans club_id et serait rejetée par le WITH CHECK).
--
-- ⚠️ REQUÊTE DE PRÉ-VOL — à passer sur dev PUIS sur prod avant application.
-- `events` et `live_matches` n'ont aucune policy `anon` dans les migrations alors que la
-- PWA les lit publiquement : ces policies ont été créées à la main dans le dashboard, sous
-- des noms inconnus de ce dépôt. Vérifier qu'aucune ne porte l'un des noms droppés en §5 :
--
--   SELECT tablename, policyname, roles, cmd
--     FROM pg_policies
--    WHERE schemaname = 'public'
--      AND tablename IN ('events','live_matches','actus','tournaments','team_saisons',
--                        'team_competitions','team_equipes','team_etapes',
--                        'team_rencontres','team_match_lines')
--    ORDER BY tablename, policyname;
--
-- Toute policy listée avec roles = {anon} doit survivre à cette migration.

-- ============================================================
-- 1. Helpers (SECURITY DEFINER pour éviter la récursion RLS sur club_members)
-- ============================================================
CREATE OR REPLACE FUNCTION public.auth_club_ids()
  RETURNS SETOF uuid
  LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
    SELECT club_id FROM public.club_members WHERE user_id = auth.uid()
  $$;

CREATE OR REPLACE FUNCTION public.is_super_admin()
  RETURNS boolean
  LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
    SELECT COALESCE((SELECT is_super_admin FROM public.profiles WHERE id = auth.uid()), false)
  $$;

GRANT EXECUTE ON FUNCTION public.auth_club_ids()  TO authenticated;
GRANT EXECUTE ON FUNCTION public.is_super_admin() TO authenticated;

-- ============================================================
-- 2. Garde-fou : refuser la migration si un club_id est NULL
-- ============================================================
DO $$
DECLARE t text; n bigint; total bigint := 0; detail text := '';
  tables text[] := ARRAY['events','live_matches','actus','tournaments',
    'team_saisons','team_competitions','team_equipes','team_etapes',
    'team_rencontres','team_match_lines'];
BEGIN
  FOREACH t IN ARRAY tables LOOP
    EXECUTE format('SELECT count(*) FROM public.%I WHERE club_id IS NULL', t) INTO n;
    IF n > 0 THEN
      detail := detail || format('%s (%s), ', t, n);
      total  := total + n;
    END IF;
  END LOOP;
  IF total > 0 THEN
    RAISE EXCEPTION 'club_id NULL restant : % ligne(s) dans %. Backfill incomplet — corriger avant PR3.',
      total, rtrim(detail, ', ');
  END IF;
END $$;

-- ============================================================
-- 3. Seeding club_members — reporté de PR1 à PR3 (cf. en-tête de 20260629).
--    SANS CETTE ÉTAPE, auth_club_ids() renvoie l'ensemble vide et la policy
--    tenant_isolation (§6) verrouille TOUS les comptes dehors, BO comme PWA.
--    L'app étant mono-club à ce jour, tout compte auth.users est un compte CAC.
--    Rôle 'admin' pour tous : préserve le comportement actuel à l'identique. Le rôle
--    n'est pas lu par tenant_isolation — il ne comptera qu'en PR4 (masquage UI), où
--    une rétrogradation se fait par un simple UPDATE sur club_members.
-- ============================================================
DO $$
DECLARE cac_id uuid;
BEGIN
  SELECT id INTO cac_id FROM public.clubs WHERE slug = 'cac-tennis';
  IF cac_id IS NULL THEN
    RAISE EXCEPTION 'Club cac-tennis introuvable — PR1 (20260629_multi_tenant_socle.sql) non appliquée ?';
  END IF;

  INSERT INTO public.club_members (club_id, user_id, role)
  SELECT cac_id, u.id, 'admin'::club_role FROM auth.users u
  ON CONFLICT (club_id, user_id) DO NOTHING;
END $$;

-- ============================================================
-- 4. NOT NULL + FK -> clubs(id) + index sur club_id (idempotent)
-- ============================================================
DO $$
DECLARE t text;
  tables text[] := ARRAY['events','live_matches','actus','tournaments',
    'team_saisons','team_competitions','team_equipes','team_etapes',
    'team_rencontres','team_match_lines'];
BEGIN
  FOREACH t IN ARRAY tables LOOP
    EXECUTE format('ALTER TABLE public.%I ALTER COLUMN club_id SET NOT NULL', t);

    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = t || '_club_id_fkey') THEN
      EXECUTE format(
        'ALTER TABLE public.%I ADD CONSTRAINT %I FOREIGN KEY (club_id) REFERENCES public.clubs(id)',
        t, t || '_club_id_fkey');
    END IF;

    EXECUTE format('CREATE INDEX IF NOT EXISTS %I ON public.%I (club_id)', 'idx_'||t||'_club_id', t);
  END LOOP;
END $$;

-- ============================================================
-- 5. DROP des policies larges (les policies anon sont conservées !)
--    Noms vérifiés dans 20260418_events.sql, 20260423_live_matches.sql,
--    2026042601_actus.sql, 20260718_tournaments_club_id.sql, 20260606_team_matches.sql.
--    Conservées : actus_anon_select, team_*_anon_select (20260611), policies profiles,
--    policies Storage (scoping Storage = Phase 3 / D12).
-- ============================================================
DROP POLICY IF EXISTS "events_select"        ON public.events;
DROP POLICY IF EXISTS "events_insert"        ON public.events;
DROP POLICY IF EXISTS "events_update"        ON public.events;
DROP POLICY IF EXISTS "events_delete"        ON public.events;
DROP POLICY IF EXISTS "live_matches_select"  ON public.live_matches;
DROP POLICY IF EXISTS "live_matches_insert"  ON public.live_matches;
DROP POLICY IF EXISTS "live_matches_update"  ON public.live_matches;
DROP POLICY IF EXISTS "live_matches_delete"  ON public.live_matches;
DROP POLICY IF EXISTS "actus_authenticated_select" ON public.actus;
DROP POLICY IF EXISTS "actus_insert"         ON public.actus;
DROP POLICY IF EXISTS "actus_update"         ON public.actus;
DROP POLICY IF EXISTS "actus_delete"         ON public.actus;
DROP POLICY IF EXISTS "authenticated users see all" ON public.tournaments;
DROP POLICY IF EXISTS "team_saisons_all"      ON public.team_saisons;
DROP POLICY IF EXISTS "team_competitions_all" ON public.team_competitions;
DROP POLICY IF EXISTS "team_equipes_all"      ON public.team_equipes;
DROP POLICY IF EXISTS "team_etapes_all"       ON public.team_etapes;
DROP POLICY IF EXISTS "team_rencontres_all"   ON public.team_rencontres;
DROP POLICY IF EXISTS "team_match_lines_all"  ON public.team_match_lines;

-- tournaments : nettoyer le GRANT anon posé par 20260718 (moindre privilège — jamais public)
REVOKE ALL ON TABLE public.tournaments FROM anon;

-- ============================================================
-- 6. Policy tenant_isolation (FOR ALL, authenticated) sur les 10 tables
--    Les GRANTs authenticated posés par 20260603 / 20260606 / 20260718 restent valides ;
--    la RLS fait désormais le cloisonnement.
-- ============================================================
DO $$
DECLARE t text;
  tables text[] := ARRAY['events','live_matches','actus','tournaments',
    'team_saisons','team_competitions','team_equipes','team_etapes',
    'team_rencontres','team_match_lines'];
BEGIN
  FOREACH t IN ARRAY tables LOOP
    EXECUTE format('DROP POLICY IF EXISTS tenant_isolation ON public.%I', t);
    EXECUTE format(
      'CREATE POLICY tenant_isolation ON public.%I FOR ALL TO authenticated '
      || 'USING (club_id IN (SELECT public.auth_club_ids()) OR public.is_super_admin()) '
      || 'WITH CHECK (club_id IN (SELECT public.auth_club_ids()) OR public.is_super_admin())', t);
  END LOOP;
END $$;

-- ============================================================
-- 7. Garde-fou final : aucune policy non cloisonnée ne doit subsister.
--    Rattrape les policies créées à la main dans le dashboard (hors migrations) qui
--    ouvriraient encore les 10 tables à `authenticated` ou `public` et videraient
--    l'isolation de sa substance. Les policies `anon` (roles = {anon}) passent.
-- ============================================================
DO $$
DECLARE leftovers text;
BEGIN
  SELECT string_agg(format('%s.%s', tablename, policyname), ', ')
    INTO leftovers
    FROM pg_policies
   WHERE schemaname = 'public'
     AND tablename = ANY(ARRAY['events','live_matches','actus','tournaments',
           'team_saisons','team_competitions','team_equipes','team_etapes',
           'team_rencontres','team_match_lines'])
     AND policyname <> 'tenant_isolation'
     AND roles && ARRAY['authenticated','public']::name[];
  IF leftovers IS NOT NULL THEN
    RAISE EXCEPTION 'Policy(ies) non cloisonnée(s) restante(s) : %. Isolation incomplète — dropper ou re-scoper avant de rejouer PR3.', leftovers;
  END IF;
END $$;
