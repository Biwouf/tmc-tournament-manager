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

## État de livraison

Lot 1 implémenté. Migration à appliquer avant le déploiement du back-office.
Les anciens matchs sans règle connue restent NULL ; leur reprise dans le nouveau
parcours devra demander une règle explicite, sans réinterpréter leur score.
Les lots 2 à 4 ne sont pas encore implémentés.
