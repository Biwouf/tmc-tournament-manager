-- PR4 — Attribution des rôles réels sur CAC Tennis
--
-- ⚠️ CE N'EST PAS UNE MIGRATION. À exécuter À LA MAIN dans le SQL Editor Supabase
--    (dev d'abord, prod ensuite). Ne pas déplacer dans supabase/migrations/ :
--    les emails ci-dessous sont spécifiques à l'environnement.
--
-- Contexte : PR3 (20260816_multi_tenant_rls.sql §3) a seedé TOUS les comptes
-- auth.users en club_members(CAC, 'admin') pour ne rien casser. Tant que les rôles
-- réels ne sont pas attribués, le masquage UI de PR4 ne masque rien — tout le monde
-- est admin.
--
-- Matrice des rôles (docs/specs/MULTI_TENANT.md §4) :
--   admin   → tout, y compris inviter des utilisateurs        → gestionnaire(s) du club
--   manager → contenus + outils, pas d'invitation             → gestionnaires de contenu
--   member  → Live Score uniquement                           → adhérents PWA
--
-- ⚠️ Garder AU MOINS UN admin sur CAC, et vérifier que c'est bien ton compte avant de
--    rétrograder quoi que ce soit : se retirer soi-même l'accès à /admin/invite est un
--    aller sans retour côté UI (rattrapage possible en SQL uniquement).

-- ============================================================
-- 1. Lister les comptes du club et leur rôle actuel
-- ============================================================
SELECT
  cm.user_id,
  u.email,
  p.prenom,
  p.nom,
  cm.role,
  p.is_super_admin,
  u.last_sign_in_at
FROM public.club_members cm
JOIN auth.users     u ON u.id  = cm.user_id
LEFT JOIN public.profiles p ON p.id = cm.user_id
JOIN public.clubs   c ON c.id  = cm.club_id
WHERE c.slug = 'cac-tennis'
ORDER BY cm.role, u.email;

-- ============================================================
-- 2. Attribuer les rôles — compléter les listes d'emails puis exécuter
-- ============================================================
-- Adhérents PWA (Live Score uniquement) :
UPDATE public.club_members cm
   SET role = 'member'
 WHERE cm.club_id = (SELECT id FROM public.clubs WHERE slug = 'cac-tennis')
   AND cm.user_id IN (
     SELECT id FROM auth.users WHERE email IN (
       -- 'adherent1@example.com',
       -- 'adherent2@example.com'
       NULL
     )
   );

-- Gestionnaires de contenu (actus, events, équipes, outils) :
UPDATE public.club_members cm
   SET role = 'manager'
 WHERE cm.club_id = (SELECT id FROM public.clubs WHERE slug = 'cac-tennis')
   AND cm.user_id IN (
     SELECT id FROM auth.users WHERE email IN (
       -- 'gestionnaire@example.com'
       NULL
     )
   );

-- Administrateur(s) du club (déjà 'admin' après le seeding PR3 — à n'utiliser que
-- pour promouvoir quelqu'un, ou rattraper une rétrogradation malheureuse) :
-- UPDATE public.club_members cm
--    SET role = 'admin'
--  WHERE cm.club_id = (SELECT id FROM public.clubs WHERE slug = 'cac-tennis')
--    AND cm.user_id = (SELECT id FROM auth.users WHERE email = 'admin@example.com');

-- ============================================================
-- 3. Garde-fou : au moins un admin doit rester sur le club
-- ============================================================
DO $$
DECLARE n int;
BEGIN
  SELECT count(*) INTO n
    FROM public.club_members cm
    JOIN public.clubs c ON c.id = cm.club_id
   WHERE c.slug = 'cac-tennis' AND cm.role = 'admin';
  IF n = 0 THEN
    RAISE EXCEPTION 'Plus aucun admin sur cac-tennis — annuler (ROLLBACK) et repromouvoir un compte.';
  END IF;
  RAISE NOTICE 'OK : % admin(s) sur cac-tennis.', n;
END $$;

-- Puis revérifier avec la requête §1.
