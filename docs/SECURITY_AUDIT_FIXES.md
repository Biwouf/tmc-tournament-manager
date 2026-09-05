# Corrections audit PWA — premier lot sécurité

Branche : `codex/audit-pwa-fixes`. Base : `50a3a92`.
Les modifications non commitées de `hybrid/color-management` ne sont pas incluses.

## Livré dans ce lot

| Constat d'audit | Correction |
|---|---|
| S1 — droits métier trop larges | Policies restrictives pour INSERT/UPDATE/DELETE : admin/manager sur les neuf tables métier hors live ; Storage admin/manager aussi. Live Score conservé pour member. |
| S2 — publication Facebook | Authentification et autorisation sur le club, actualité publiée, club actif, credentials liés explicitement à FACEBOOK_CLUB_ID. Aucun mode debug ne contourne ces règles. |
| S3 — injection HTML/CSS | Assainissement après parsing HTML dans la PWA et l'aperçu BO ; conservation de la mise en forme utile. |
| S5 — suspension | Club actif exigé par les policies sur les dix tables métier et club_settings ; helper d'appartenance et Edge Functions alignés. Super-admin autorisé pour support. Aucun repli vers CAC Tennis en cas d'échec de résolution. |
| S6 — dernier administrateur | Invitation idempotente sur l'appartenance ; trigger PostgreSQL avec verrou sur le club avant retrait/rétrogradation du dernier admin. |

La migration est additive et transactionnelle. Elle conserve les policies de lecture
existantes, qu'elle restreint par le statut du club. Elle n'ouvre aucun droit de
lecture anonyme nouveau. Les anciennes migrations ne doivent pas être rejouées
après celle-ci : elles rétabliraient d'anciens helpers/policies.

## Validation

- `npm run test:security` : 18 tests, dont la migration exécutée deux fois sur une base PostgreSQL PGlite isolée.
- Matrice SQL : écritures autorisées admin/manager, refus member et autre club, impossibilité de déplacer une ligne vers un club non autorisé, suspension, lecture anonyme d'un club suspendu, support super-admin, accès Live du membre, chemins Storage modernes et legacy.
- Trigger : refus de suppression/rétrogradation du dernier admin, retrait permis lorsqu'un autre admin existe. Le verrou est présent ; les transactions concurrentes sur plusieurs connexions restent à tester en staging (PGlite utilise ici une connexion).
- Fonctions Deno : exécution des handlers réels via transpilation TypeScript et doubles d'API. Cas autorisés/refusés Facebook, zéro publication en cas de refus, réinvitation sans changement de rôle, suspension des fonctions de gestion.
- Rendu : contenu hostile neutralisé, liens/images/listes/gras/italique/soulignement conservés dans les deux applications.
- Lint ciblé : cinq erreurs préexistantes, confirmées sur les mêmes fichiers à HEAD avant correction (quatre `react-refresh/only-export-components` dans les contextes, une `react-hooks/set-state-in-effect` dans MembersPage). Aucune erreur sur les nouveaux contrats Markdown ni les rendus assainis.
- Builds TypeScript/Vite BO et PWA réussis. Les avertissements de taille de bundle persistent et appartiennent au lot performances.

La base de test recrée les tables et permissions nécessaires aux scénarios, pas toute
la plateforme Supabase. Ce n'est pas une preuve de concordance avec les policies
réelles de production, ni un test des Edge Functions dans le runtime hébergé Deno.

## Déploiement proposé — non exécuté

1. En staging, inventorier les policies réelles et vérifier les rôles attribués aux comptes. Les comptes utilisés pour l'édition doivent être admin ou manager.
2. Configurer **FACEBOOK_CLUB_ID** avec l'UUID du club propriétaire des credentials Facebook existants. Une valeur absente entraîne un refus, jamais un fallback vers une page globale.
3. Déployer `post-to-facebook`, `invite-user` et `club-members` corrigées. La réinvitation n'écrase déjà plus les droits, même avant la migration.
4. Appliquer `supabase/migrations/20260905_audit_content_permissions.sql` en staging. Tester avec les trois rôles et deux clubs, notamment une rétrogradation simultanée de deux admins.
5. Déployer BO/PWA et contrôler les contenus éditoriaux réels ainsi que la suspension. Garder une session super-admin pour support.
6. Après validation, appliquer la même séquence en production. Aucun déploiement, secret serveur ou migration distante n'a été changé dans cette tâche.

Les permissions SQL changent même pour les anciens clients ouverts. Ne pas rétrograder
un utilisateur d'édition en member en supposant qu'il pourra continuer à utiliser les
modules BO. Le service role conserve son bypass RLS mais reste soumis au trigger du
dernier admin. Les fichiers d'images déjà publics/cachés restent publics après suspension.

## À traiter dans les lots suivants

- S4 : restreindre la lecture des profils et exposer séparément les noms des gestionnaires utiles au Live.
- U2 : contrôle serveur du gestionnaire, concurrence, détection des écritures vides et resynchronisation des scores.
- P1–P5 / U1, U3, U4 : cache, configuration partagée, Realtime/polling, volume des réponses, pagination, lazy loading, états de chargement et dates.
- U5/U6 : configuration publique restreinte, identité d'installation, contrat hors ligne et tests mobiles des gestes/safe areas.
- Credentials Facebook distincts par club et protection contre les publications répétées.
- Qualification/mises à jour des dépendances, dont le chemin d'extraction PDF.

Ces points ne sont pas présentés comme corrigés par ce premier lot.
