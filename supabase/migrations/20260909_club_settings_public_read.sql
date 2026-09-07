-- Multi-tenant — PR9 : exposition de `club_settings` en LECTURE au rôle `anon` (site vitrine).
--
-- Pourquoi maintenant : `20260629_multi_tenant_socle.sql` annonçait « l'exposition anon
-- (vitrine) arrive avec la Phase 4 », et `20260822_config_storage_tenant.sql` a cloisonné la
-- lecture `authenticated` sans y toucher. Sans cette migration, l'app `web/` (rôle `anon`)
-- ne lit RIEN et rend une coquille vide — le symptôme ressemble à un bug React, il est ici.
--
-- Nommage : `20260909` et non la date de la PR — le numéro doit se classer APRÈS
-- `20260908_live_matches_public_read.sql` (live-score, déjà appliquée sur dev). La CLI dérive
-- la `version` des chiffres de tête et refuse d'insérer une migration antérieure au dernier
-- cran déjà appliqué.
--
-- Non bloquante : elle n'AJOUTE qu'un droit de lecture. Ni la lecture `authenticated`
-- (`club_settings_select_tenant`), ni les écritures (admin de club, super-admin) ne bougent.
-- Idempotente : rejouable sans effet de bord.
--
-- ⚠️ `USING (true)` n'est PAS une fuite ici — trois raisons, dans cet ordre :
--
--   1. La policy RESTRICTIVE `active_club_access` (`20260905_audit_content_permissions.sql`)
--      couvre déjà `club_settings` pour `anon` et exige `clubs.status = 'active'`. Permissive
--      et restrictive se composent en ET : un club suspendu reste invisible depuis la vitrine,
--      sans que cette policy-ci ait à refaire — ni à contredire — ce contrôle.
--
--   2. Le cloisonnement PAR CLUB n'est pas assuré par la RLS pour `anon`, ici comme sur
--      `actus` / `events` : c'est l'app qui filtre (`.eq('club_id', clubId)`). La config d'un
--      autre club actif est donc lisible par qui connaît son `club_id`. C'est le patron
--      existant de la PWA, et c'est ACCEPTABLE : ce sont les données d'un site public.
--
--   3. Le groupe `posters` (PR7) devient public par ricochet — `config` est une colonne unique
--      et la RLS ne sait pas restreindre une clé de JSONB. Ce sont des fonds d'affiche dont
--      les images vivent déjà dans le bucket public `content-images` : rien de sensible n'y
--      transite. On expose la colonne entière plutôt que d'inventer une vue filtrée —
--      décision assumée, pas un oubli. Les vrais secrets (token de Page Facebook) vivent dans
--      `club_social_credentials` (PR8), précisément parce que D10 anticipait cette ouverture.
--
-- ⚠️ Note pour un futur replay de PR6a : le garde-fou de `20260822_config_storage_tenant.sql`
-- (§2) lève si une policy hors liste blanche existe sur `club_settings`. `active_club_access`
-- l'y met déjà en défaut depuis l'audit du 05/09 ; `club_settings_select_anon` est le second
-- nom dans ce cas. Les migrations ne se rejouent pas — c'est la liste blanche qui est périmée,
-- pas ces deux policies.
BEGIN;

DROP POLICY IF EXISTS "club_settings_select_anon" ON public.club_settings;
CREATE POLICY "club_settings_select_anon"
  ON public.club_settings FOR SELECT TO anon USING (true);

-- GRANT obligatoire (`docs/CODEBASE.md` § « Convention GRANTs ») : une policy sans GRANT ne
-- donne rien. Lecture seule — la vitrine ne publie rien.
GRANT SELECT ON TABLE public.club_settings TO anon;

COMMIT;
