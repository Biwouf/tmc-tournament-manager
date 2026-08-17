-- Multi-tenant — PR5 (§0) : le flag super-admin n'est plus auto-attribuable.
-- Voir docs/briefs/PR5_console_super_admin.md §0 et docs/specs/MULTI_TENANT.md §4.
--
-- PROBLÈME CORRIGÉ
-- PR1 (20260629) a ajouté `profiles.is_super_admin` sur une table dont :
--   * la policy d'écriture n'a pas de WITH CHECK          (20260521_profiles.sql)
--   * les GRANT INSERT/UPDATE ne listent aucune colonne   (20260603_grant_public_tables.sql)
-- N'importe quel compte authentifié (la clé anon est publique dans les bundles BO et PWA)
-- pouvait donc s'auto-promouvoir :
--   PATCH /rest/v1/profiles?id=eq.<son_id>   { "is_super_admin": true }
-- et court-circuiter `tenant_isolation` (PR3) sur les 10 tables métier de TOUS les clubs,
-- en lecture comme en écriture.
--
-- Le grant PAR COLONNE est la vraie barrière : la RLS ne sait pas restreindre une colonne.
-- Après cette migration, `is_super_admin` ne se pose plus que via le SQL Editor / le
-- service role (bootstrap documenté dans le README).
--
-- ⚠️ La branche INSERT est verrouillée elle aussi, alors que le brief ne visait que UPDATE :
-- la policy `profiles_insert_own` + un GRANT INSERT sans liste de colonnes laissaient un
-- compte SANS ligne `profiles` s'insérer directement avec `is_super_admin = true`. Ce n'est
-- pas théorique : les profils antérieurs au trigger `on_auth_user_created` (20260521) sont
-- à insérer à la main (cf. docs/CODEBASE.md), donc certains comptes n'ont pas de ligne.
--
-- Colonne `id` incluse dans les deux grants : `AcceptInvitePage` fait un
-- `profiles.upsert({ id, prenom, nom })`, que PostgREST traduit en
-- `INSERT … ON CONFLICT DO UPDATE SET id = excluded.id, prenom = …, nom = …` — la branche
-- UPDATE touche donc `id`. C'est inoffensif : les policies ci-dessous (USING + WITH CHECK
-- sur `auth.uid() = id`) interdisent de le poser sur autre chose que soi-même.
--
-- Idempotente. Isolable : ce fichier ne touche QUE `profiles`, il peut être appliqué seul
-- en prod sans la migration 2026081802 (console super-admin).
--
-- ROLLBACK
--   REVOKE INSERT (id, prenom, nom), UPDATE (id, prenom, nom) ON TABLE public.profiles FROM authenticated;
--   GRANT  INSERT, UPDATE ON TABLE public.profiles TO authenticated;
--   DROP POLICY "profiles_update_own" ON public.profiles;
--   CREATE POLICY "profiles_update_own" ON public.profiles
--     FOR UPDATE TO authenticated USING (auth.uid() = id);

-- ============================================================
-- 1. GRANTs par colonne (la barrière)
-- ============================================================
REVOKE INSERT, UPDATE ON TABLE public.profiles FROM authenticated;

GRANT INSERT (id, prenom, nom) ON TABLE public.profiles TO authenticated;
GRANT UPDATE (id, prenom, nom) ON TABLE public.profiles TO authenticated;

-- SELECT (authenticated + anon) inchangé : lecture des prénoms/noms des gestionnaires de
-- live (BO + PWA). Le cloisonnement de cette lecture est une dette connue (MULTI_TENANT §2.4).
-- DELETE toujours absent : la suppression passe par le CASCADE depuis auth.users.

-- ============================================================
-- 2. WITH CHECK explicite sur la policy d'écriture
-- ============================================================
-- Sans WITH CHECK, une UPDATE pouvait réécrire la ligne vers un autre `id` (la clause
-- USING ne contrôle que la ligne AVANT modification). Ceinture et bretelles avec le grant
-- par colonne ci-dessus.
DROP POLICY IF EXISTS "profiles_update_own" ON public.profiles;
CREATE POLICY "profiles_update_own"
  ON public.profiles FOR UPDATE TO authenticated
  USING (auth.uid() = id)
  WITH CHECK (auth.uid() = id);

-- `profiles_insert_own` (WITH CHECK auth.uid() = id) est conservée telle quelle :
-- c'est le grant par colonne du §1 qui ferme l'escalade côté INSERT.
