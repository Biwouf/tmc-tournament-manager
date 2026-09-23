# Suivi des rencontres par équipe — décisions du 21 septembre 2026

## Périmètre validé

Une rencontre est déjà planifiée. Tout membre du club peut ajouter les matchs,
saisir les résultats, confirmer la rencontre et corriger les résultats.
La consultation ne dépend pas de la confirmation. Les frontières entre clubs
et les permissions d'écriture restent applicables.

Les places dépendent du format de compétition, doubles inclus. Création guidée :
place, joueur(s) du club, adversaire(s). Membres recherchables et texte libre,
classement du jour conservé, NC par défaut. Grille : 3e, 2e puis 4e série.

Deux actions : suivre en live ou saisir le résultat. Un match créé sans résultat
reste en attente ; aucune action « Ne pas suivre ». Les modes peuvent changer,
y compris lancement en cours de match, sans perdre les scores.

Live jeu par jeu existant, points uniquement pour les tie-breaks ; pas de
0/15/30/40. Plusieurs marqueurs sur une rencontre, un seul marqueur actif par
match, avec reprise explicite. Un live terminé reste visible et préremplit le
résultat à confirmer ou corriger sans ressaisie obligatoire.

Le troisième set des simples dépend de la compétition (classique ou super
tie-break). Le double utilise un super tie-break. Règle conservée à la création
du match ; aucune déduction pour les compétitions historiques non configurées.

WO pour un match non joué ; abandon possible en live et en saisie directe.
Confirmation lorsque toutes les places attendues possèdent un résultat validé,
WO compris. Total pondéré par le format, double valant parfois deux points.
Une correction de résultat remet la rencontre à confirmer. Conserver une trace.

## Hors connexion : règle transversale convenue

Conserver localement les saisies, rendre visible leur attente de synchronisation,
synchroniser au retour du réseau, signaler les conflits sans écrasement silencieux.
Isoler les données par utilisateur et club, avec opérations rejouables sans doublon.
Cette règle doit être intégrée aux mutations de la PWA, pas uniquement au module
équipes. Une PWA installable n'implique pas que ce comportement existe déjà.

## Séquence de livraison

1. Paramétrage des règles de compétition et conservation par match, tests SQL.
2. Commandes serveur pour membres, places uniques, résultats et confirmation,
   lien atomique au Live, protection des écritures concurrentes, tests.
3. Écran rencontre PWA, création guidée et résultats ; intégration au Live.
4. Infrastructure hors connexion partagée et intégration des mutations,
   résolution des conflits et validation des parcours sur mobile.

## État de livraison — 23 septembre 2026

Lots 1 à 3 implémentés dans `codex/pwa-equipes-live` :

- Compétition : règle des simples, conservée par match ; doubles en super tie-break.
- Commandes serveur réservées aux membres du club actif : création, liaison au live,
  résolution explicite des anciennes règles inconnues, résultat et confirmation.
- Places uniques et bornées au format. Résultats structurés, vainqueur calculé,
  WO et abandon, pondération des doubles. Historique des changements conservé côté serveur.
- Révision du match et du live vérifiée à la saisie, révision de la rencontre au
  récapitulatif. Identifiant de commande stable lors d'une nouvelle tentative réseau.
- PWA : fiche accessible depuis une rencontre, assistant de création en trois étapes,
  recherche de membres, grille de classement, résultats numériques et récapitulatif.
- Live lié : règle fixée automatiquement, retour vers la rencontre, résultat terminé
  conservé dans la liste au-delà de sept jours tant qu'il n'est pas validé.
- BO : création du live via la même commande atomique ; suppression de l'ancienne
  validation automatique du vainqueur au simple chargement de la fiche.

La consultation des scores est publique pour les clubs actifs. Les écritures directes
sur les autres données de compétition restent réservées aux responsables ; les membres
utilisent les commandes dédiées sans obtenir de droits d'administration supplémentaires.

Le lot 4 (hors connexion transversal) reste à développer. Les nouvelles commandes sont
rejouables, mais aucune file locale durable ni synchronisation automatique n'est encore
livrée. Une erreur réseau ne doit pas être présentée comme une sauvegarde réussie.

## Déploiement et recette

Appliquer sur la base de développement, dans cet ordre, avant de déployer les clients :

1. `2026092101_team_scoring_rules.sql` (si pas déjà appliquée).
2. `2026092301_team_match_commands.sql`.

La seconde migration ajoute des colonnes requises par les filtres Live du BO et de la
PWA. Déployer le BO et la PWA ensemble après la migration. Aucun SQL distant n'a été
appliqué automatiquement pendant le développement.

Recette avec deux membres du même club :

1. Configurer les simples en STB dans une compétition puis ouvrir une rencontre PWA.
2. Ajouter un simple ; le lancer en live. Après deux sets partagés, vérifier que le
   super tie-break s'affiche directement, sans sélecteur. Refaire avec un set classique.
3. Ajouter un double : deux joueurs de chaque côté et super tie-break automatique.
4. Depuis le second compte, reprendre explicitement le live ; le premier marqueur
   passe en lecture seule. Ouvrir un formulaire avant une modification de score :
   sa validation doit signaler le conflit, pas écraser le nouvel état.
5. Terminer un live puis confirmer son résultat prérempli depuis la rencontre.
6. Compléter les autres places en saisie directe, WO et abandon ; vérifier le poids
   du double et que toutes les places attendues sont nécessaires pour confirmer.
7. Confirmer la rencontre ; corriger un résultat avec l'autre membre. La rencontre
   revient à confirmer. Reprendre un live terminé doit aussi invalider son résultat.
8. Tester un ancien match sans règle : choix explicite demandé. Un ancien score libre
   doit être vérifié dans la saisie structurée avant de le transférer au live.

Tests automatisés :

```sh
node --test tests/team-scoring-rules.test.mjs tests/team-match-commands.test.mjs tests/team-match-client.test.mjs tests/live-score-sql.test.mjs tests/live-score-client.test.mjs
npm run build
npm --prefix pwa run build
```

Tests SQL sur PGlite isolé et tests de composants sur JSDOM. La recette mobile et la
concurrence sur deux connexions PostgreSQL réelles restent à réaliser sur l'environnement
de développement avant la mise en production.
