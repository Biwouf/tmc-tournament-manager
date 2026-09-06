-- Multi-tenant — PR8 : comptes sociaux par club (décision D10).
-- Voir docs/specs/MULTI_TENANT.md §6.3 et docs/specs/ACTUS.md.
--
-- ⚠️ DATÉE DU 06 ET NON DU 05, alors qu'elle a été écrite le 05 : l'audit sécurité a posé
-- `20260905_audit_content_permissions.sql` entre-temps. La CLI Supabase dérive la `version`
-- des chiffres de tête du nom de fichier — deux `20260905_*` donneraient
-- `duplicate key value violates unique constraint "schema_migrations_pkey"` au `db push`.
--
-- PROBLÈME CORRIGÉ
-- La publication Facebook s'appuie sur DEUX secrets GLOBAUX (`FACEBOOK_PAGE_ID`,
-- `FACEBOOK_PAGE_ACCESS_TOKEN`) posés en variables d'environnement de l'Edge Function
-- `post-to-facebook`. En multi-tenant, ça veut dire qu'il n'existe qu'une page Facebook
-- pour toute la plateforme : le 2ᵉ club publierait sur la page de CAC. Les identifiants
-- doivent être PAR CLUB, donc en base.
--
-- POURQUOI UNE TABLE DÉDIÉE, ET PAS `club_settings.config`
-- `club_settings` sert au RENDU PUBLIC (site vitrine, PR9) : sa vocation est d'être
-- lisible, et PR9 y ouvrira une lecture `anon` restreinte. Un token de Page n'a rien à
-- faire dans un JSONB dont la trajectoire est l'exposition publique. Table séparée,
-- règles séparées.
--
-- LE TOKEN N'EST JAMAIS LISIBLE PAR UN NAVIGATEUR
-- La RLS ne sait pas restreindre une COLONNE — seulement une ligne. Le GRANT par colonne
-- du §3 est donc la vraie barrière, comme dans 2026081801_profiles_column_grants.sql :
-- `authenticated` reçoit SELECT sur tout SAUF `token`. Un admin de club voit à quelle page
-- son club est connecté et quand le token expire ; le secret lui-même ne redescend jamais
-- dans un bundle. Seule l'Edge Function, en service role, le lit.
--
-- AUCUNE POLICY D'ÉCRITURE — et c'est volontaire (même choix qu'en PR5-bis pour
-- `club_members`) : écrire ici suppose d'avoir d'abord VALIDÉ le token auprès de Facebook,
-- ce qu'un client ne peut pas faire de façon fiable. Tout passe par l'Edge Function
-- `social-credentials`, qui vérifie le token, en déduit la page, et écrit en service role.
--
-- Durcissement ultérieur possible (§6.3) : chiffrer la seule colonne `token` via le Vault
-- Supabase. Le reste du schéma et les policies ci-dessous ne bougeraient pas.
--
-- ROLLBACK
--   DROP TABLE public.club_social_credentials;
--   (+ redéployer la version précédente de `post-to-facebook`, qui lit les env vars)

-- ============================================================
-- 1. Table
-- ============================================================
-- Clé primaire composite (club_id, platform) : un club a AU PLUS un compte par plateforme,
-- et c'est la cible naturelle de l'upsert « connecter / reconnecter ».
--
-- `platform` est un TEXT contraint plutôt qu'un enum : Instagram et consorts sont hors
-- périmètre de PR8 (§6.3), et étendre un CHECK est moins cérémonieux qu'un ALTER TYPE.
--
-- `page_id` / `page_name` sont DÉRIVÉS du token par la function, jamais saisis : demander
-- l'ID de page à l'admin, c'est inviter la faute de frappe qui publie ailleurs. `page_name`
-- n'a aucun rôle fonctionnel — il sert à ce que l'écran BO puisse afficher « connecté à
-- *Cercle Athlétique de Castelnau* » plutôt qu'un nombre à 15 chiffres.
--
-- `token_expires_at` est NULLABLE : un Page Access Token dérivé d'un token utilisateur
-- longue durée n'expire pas, et `debug_token` peut échouer sans que le token soit mauvais
-- (cf. function). NULL = « expiration inconnue », pas « expiré ».
CREATE TABLE IF NOT EXISTS public.club_social_credentials (
  club_id          UUID        NOT NULL REFERENCES public.clubs(id) ON DELETE CASCADE,
  platform         TEXT        NOT NULL CHECK (platform IN ('facebook')),
  page_id          TEXT        NOT NULL,
  page_name        TEXT,
  token            TEXT        NOT NULL,
  token_expires_at TIMESTAMPTZ,
  -- Qui a connecté le compte, pour l'écran BO. ON DELETE SET NULL : retirer un membre du
  -- club ne doit pas déconnecter la page Facebook.
  connected_by     UUID        REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at       TIMESTAMPTZ DEFAULT now() NOT NULL,
  updated_at       TIMESTAMPTZ DEFAULT now() NOT NULL,
  PRIMARY KEY (club_id, platform)
);

-- Réutilise set_updated_at() défini dans 20260418_events.sql.
DROP TRIGGER IF EXISTS club_social_credentials_updated_at ON public.club_social_credentials;
CREATE TRIGGER club_social_credentials_updated_at
  BEFORE UPDATE ON public.club_social_credentials
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

ALTER TABLE public.club_social_credentials ENABLE ROW LEVEL SECURITY;

-- ============================================================
-- 2. RLS — admin du club uniquement (D10)
-- ============================================================
-- Jamais `anon`, jamais `manager`, jamais `member` : la PWA et la vitrine n'ont rien à
-- faire ici, et un gestionnaire qui publie une actu sur Facebook n'a pas besoin de voir
-- les identifiants pour le faire — c'est l'Edge Function qui les lit.
--
-- EXISTS explicite, et NON le helper `can_manage_club_content()` posé par l'audit du
-- 05/09/2026 : celui-ci rend vrai pour `admin` **et** `manager`, ce qui est le bon périmètre
-- pour les contenus éditoriaux et le mauvais ici — un gestionnaire publie des actus sur la
-- page, il n'a pas à voir à quel compte elle est reliée. Il n'existe toujours pas de helper
-- « admin de CE club » (`auth_club_ids()` ne dit pas le rôle, `is_super_admin()` ne dit pas
-- le club) ; la PR dédiée à `auth_club_role()` reste à faire.
--
-- `c.status = 'active'` : même règle que les policies `active_club_access` de l'audit et que
-- le contrôle ajouté dans `invite-user` / `club-members` — un club suspendu ne se gère plus.
--
-- Le super-admin est inclus SANS condition de statut : sans wildcard *.feelike.app (PR13),
-- l'accès support est le seul moyen d'atteindre un 2ᵉ club, et diagnostiquer un club
-- suspendu est précisément son usage.
DROP POLICY IF EXISTS "club_social_credentials_select_club_admin" ON public.club_social_credentials;
CREATE POLICY "club_social_credentials_select_club_admin"
  ON public.club_social_credentials FOR SELECT TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.club_members m
       JOIN public.clubs c ON c.id = m.club_id
       WHERE m.club_id = club_social_credentials.club_id
         AND m.user_id = auth.uid()
         AND m.role = 'admin'
         AND c.status = 'active'
    )
    OR public.is_super_admin()
  );

-- Pas de policy INSERT / UPDATE / DELETE : voir l'en-tête. Le service role bypasse la RLS.

-- ============================================================
-- 3. GRANT par colonne — la barrière qui protège le token
-- ============================================================
-- `token` est volontairement ABSENT de la liste. Sans grant sur cette colonne, PostgREST
-- refuse `select=token` et refuse aussi `select=*` élargi à la colonne interdite : un
-- `.select('*')` écrit par distraction dans le BO lèvera une 401 explicite au lieu de
-- diffuser le secret en silence.
GRANT SELECT (club_id, platform, page_id, page_name, token_expires_at,
              connected_by, created_at, updated_at)
  ON TABLE public.club_social_credentials TO authenticated;

-- Aucun GRANT à `anon`. Aucun GRANT INSERT / UPDATE / DELETE à qui que ce soit.
