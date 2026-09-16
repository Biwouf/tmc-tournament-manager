# Inscription PWA et validation des adhérents

Décision produit : pas de confirmation email ; seul un administrateur accorde l’accès membre.

## Parcours

- `/inscription` : carte unique 1a, prénom, nom, email, sexe, mot de passe/confirmation et classement facultatif. Le lien est disponible depuis la connexion ; un retour `/cours?…` est conservé.
- La création Auth enregistre atomiquement le profil et une demande `pending`, via des métadonnées strictement validées. Aucune ligne `club_members` n’est créée à ce stade. Le RPC authentifié confirme la demande avec une clé idempotente ; une erreur réseau peut être réessayée sans recréer le compte.
- L’utilisateur est redirigé vers les cours ou les actualités avec un statut d’attente. Les contenus publics restent accessibles. Les écritures cours et Live restent protégées côté serveur ; le formulaire Live est également fermé côté interface avant validation.
- `/admin/members` présente les demandes avec identité, email, sexe, classement et date. Accepter crée exclusivement un rôle `member`. Refuser conserve la demande sans droits. Les décisions sont réservées à l’admin du club ou au super-admin, club actif uniquement.
- Le bouton existant « Retirer » supprime le rattachement, révoque la demande et annule les inscriptions futures aux cours grâce au trigger existant. Un ancien appel d’inscription ou d’acceptation ne restaure pas l’accès. Pour rétablir volontairement un accès refusé/retiré, utiliser l’invitation existante.
- Le statut PWA se recharge au retour dans l’application, chaque minute, ou avec « Actualiser mon statut ». Les autorisations serveur prennent effet immédiatement.

Le classement utilise `shared/tennisRankings.ts`, de NC à -15. Les sélecteurs TMC utilisent cette même liste ; les générateurs de rencontres/planning n’effectuent pas de comparaison de classement. La saisie libre du classement dans NewMatchPage reste inchangée, sa convergence pourra réutiliser ce module.

## Mise en service

1. Appliquer `supabase/migrations/2026091602_pwa_signup.sql` après les migrations cours et identité du responsable. Déployer la migration avant les interfaces.
2. Dans le projet Supabase hébergé, autoriser les nouvelles inscriptions email/mot de passe et désactiver « Confirm email » (Authentication → Providers → Email). Le réglage local figure dans `supabase/config.toml` ; ce fichier ne change pas la configuration du projet hébergé. Ce réglage Auth est commun à tous les clubs de ce projet.
3. Ajouter aux Redirect URLs les origines PWA dev/prod avec `/inscription/confirmee**`, en limitant les origines aux domaines de confiance. Un état de secours est prévu si la confirmation email est restée activée : le profil et la demande existent déjà, le membre suit le lien puis attend la validation admin.
4. Déployer PWA et back-office. Aucune nouvelle Edge Function et aucune clé service dans le navigateur.

La migration, la configuration hébergée et le déploiement ne sont pas appliqués automatiquement par ce lot. Le parcours d’invitation existant reste disponible.

## Vérification

`npm run test:signup`, tests cours PWA et sécurité, `npm --prefix pwa run build`, `npm run build`.

Les tests SQL exécutent les migrations dans PGlite : création atomique, données invalides, club suspendu, absence d’élévation de privilèges, isolation des clubs, acceptation/refus/retrait, rejeu, modification du classement et compatibilité de l’ancien RPC profil. Les tests React simulent les réponses Auth et vérifient validation locale, double soumission, ordre des appels, reprise après erreur et états d’erreur/confirmation email.
