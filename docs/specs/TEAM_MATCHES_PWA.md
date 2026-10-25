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
match, avec reprise explicite. Un live terminé avec un vainqueur **valide
automatiquement** le résultat du match (décision du 11/10/2026, cf. plus bas) ; il reste
corrigeable via « Modifier le résultat ».

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

## Validation automatique des lives et score de la liste — 11 octobre 2026

Décision : la vérification humaine se fait une seule fois, à la confirmation de la
rencontre, et plus match par match.

- `2026101107_team_live_auto_result.sql` : un live lié qui passe `finished` avec un
  `winner` (fin normale ou abandon) remplit la ligne (`gagnant`, `sets`, `score`,
  `result_kind` `normal`/`retired`, `confirmed_at`) et passe `team_result_confirmed` à vrai.
  `refresh_team_result` recalcule alors `score_club`/`score_adverse` de la rencontre, comme
  pour une saisie directe (`result`). Toute autre modification du live (reprise, retour en
  cours) invalide le résultat comme avant ; une correction de score sur un live terminé
  met la ligne à jour. Rattrapage des lives terminés non validés au déploiement.
- Conséquence : `team_rencontres.score_club/score_adverse` est le score provisoire à jour,
  identique à celui de la page rencontre et de l'onglet Live.
- Liste « Matchs par équipe » : une rencontre commencée et non confirmée affiche ce score
  avec « Provisoire » (au lieu de « En attente », réservé à l'absence de résultat). Un
  0–0 hors WO n'est plus présenté comme un nul dans « Passés ».
- Rencontre : quand toutes les places ont un résultat, un message invite à vérifier et le
  bouton « Vérifier et confirmer la rencontre » passe en bouton principal.

- Saisie directe du résultat (`TeamResultSheet`) : le focus passe au champ suivant dès
  qu'un score est complet (set 1 club → adversaire → set 2 → 3e set s'il apparaît, sinon
  fermeture du clavier). Un set tient en un chiffre ; au super tie-break, un « 1 » seul
  attend le chiffre suivant (10, 11…) — perdre 1–10 demande de toucher le champ suivant.
  Le contenu d'un champ est sélectionné au focus pour être remplacé à la frappe.

Tests : `tests/team-live-auto-result.test.mjs` (inclus dans `npm run test:team-matches`).

## État de livraison — 24 septembre 2026

Lots 1 à 3 implémentés dans `codex/pwa-equipes-live` :

- Compétition : règle des simples, conservée par match ; doubles en super tie-break.
- Commandes serveur réservées aux membres du club actif : création, liaison au live,
  résolution explicite des anciennes règles inconnues, résultat et confirmation.
- Places uniques et bornées au format. Résultats structurés, vainqueur calculé,
  WO et abandon, pondération des doubles. Historique des changements conservé côté serveur.
- Révision du match et du live vérifiée à la saisie, révision de la rencontre au
  récapitulatif. Identifiant de commande stable lors d'une nouvelle tentative réseau.
  Un conflit de révision répond en SQLSTATE `PT409` (HTTP 409) : **jamais `40001`**, que
  PostgREST rejoue indéfiniment (saturation de la base lors du test du 04/10/2026). Un point
  marqué sur le live ne modifie la ligne que s'il invalide un résultat, et la PWA relit la
  rencontre avant « Ouvrir le live » / choix de règle pour envoyer des révisions à jour.
- PWA : fiche accessible depuis une rencontre, assistant de création en trois étapes,
  recherche de membres, grille de classement, résultats numériques et récapitulatif.
- Live lié : règle fixée automatiquement, retour vers la rencontre, résultat terminé
  conservé dans la liste au-delà de sept jours tant qu'il n'est pas validé.
- Liste : rencontres en live mises en avant dans « À venir / En cours », avec
  rafraîchissement toutes les 15 secondes et score provisoire.
- Détail : classements visibles pour chaque joueur, simples et doubles. Badge « Perf »
  pour une victoire du club en simple contre un classement strictement supérieur,
  hors WO. Animation unique discrète, désactivée si les animations sont réduites.
- BO : création du live via la même commande atomique ; suppression de l'ancienne
  validation automatique du vainqueur au simple chargement de la fiche.

La consultation des scores est publique pour les clubs actifs. Les écritures directes
sur les autres données de compétition restent réservées aux responsables ; les membres
utilisent les commandes dédiées sans obtenir de droits d'administration supplémentaires.

Depuis le 25/10/2026, la synchronisation Ten'Up n'est plus proposée dans la PWA (BO uniquement).
Les admins et gestionnaires du club (`can_manage_club_content`) peuvent changer la date et l'heure
d'une rencontre depuis sa fiche ; comme au BO, la rencontre repasse alors à confirmer si elle l'était.

Le lot 4 (hors connexion transversal) reste à développer. Les nouvelles commandes sont
rejouables, mais aucune file locale durable ni synchronisation automatique n'est encore
livrée. Une erreur réseau ne doit pas être présentée comme une sauvegarde réussie.

## Saisie de la compo des simples — 11 octobre 2026

Sur place, chaque capitaine écrit la compo de ses simples dans l'ordre (simple 1, 2…) avec
les classements ; le double est décidé plus tard. Sur la fiche rencontre, **« Prendre en photo la
compo »** ouvre un assistant qui crée **tous les simples encore libres d'un coup**, pour les deux
équipes. Le parcours est dédié à la photo (aucune saisie de texte) ; un indicateur à trois étapes
et un texte d'explication annoncent d'emblée les deux photos à prendre, dans l'ordre :
1. photo de notre feuille (« Photographier notre compo »), lue aussitôt ;
2. photo de la feuille adverse ;
3. vérification : un bloc par simple (notre joueur avec le membre proposé, l'adversaire), champs
   corrigeables, reprise possible de l'une ou l'autre photo sans quitter la vérification, puis
   **« Valider la compo »** (désactivé tant qu'un joueur manque).
En cas d'échec de lecture : message et « Reprendre la photo ». La saisie hors photo passe par
**« Ajouter match manuellement »** (assistant match par match, inchangé).

- **Photo de la feuille lue par Claude** (Edge Function `compo-scan`). La PWA réduit la photo
  (1568 px max, JPEG, `pwa/src/lib/compoScan.ts` ; une photo HEIC d'iPhone, que seul Safari décode, est convertie par `heic-to` chargé à la demande, ~4 s) puis l'envoie avec le club. La fonction
  vérifie la session, l'appartenance et le quota (`team_compo_scan_begin`) **avant** l'appel
  payant, demande au modèle `claude-opus-5-5` (effort `low`, sortie JSON contrainte par schéma,
  repli serveur `fallbacks: "default"` en cas de refus) les simples numérotés, puis revalide la
  réponse (numéro 1–9, nom non vide, classement de la liste sinon `null`). La photo n'est ni
  stockée ni journalisée. Secret requis : `ANTHROPIC_API_KEY` ; sans lui, réponse 503 et saisie
  manuelle. Quota : 6 lectures / 10 min par membre, 60 / jour par club (journal
  `team_compo_scans`, non exposé).
- **Lecture native du téléphone abandonnée** (« Scanner du texte » iOS / Gboard) : trop peu
  fiable sur les feuilles réelles ; le découpage de texte qui l'accompagnait a été retiré.
- **Rapprochement des membres** (`matchMember`) : sans accents ni casse, prénom/nom dans les
  deux ordres, distance d'édition (seuil 0,75), classement identique en départage. Deux
  candidats trop proches (homonymes) ⇒ aucun choix automatique. La proposition reste
  modifiable (liste des membres, ou « non membre »). Adversaires en texte libre.
- **Classement** : celui de la feuille fait foi pour le match. S'il diffère de la fiche du
  membre, une case cochée par défaut met à jour `profile_details.classement` (valeurs du
  CHECK de la table uniquement, donc pas `-30`). Conséquence : tout membre voit et peut
  corriger le classement des autres membres de son club.
- **Serveur** (`2026101105_team_compo.sql` puis `2026101201_team_compo_scan_quota.sql`) : `team_member_roster(club)` (membres +
  classement, réservé aux membres) ; `team_compo_command(club, rencontre, {simples:[{slot,
  joueur_club, joueur_adverse, update_classement}]}, request_id)` appelle
  `team_match_command('create')` pour chaque simple avec une clé dérivée de `request_id` (mêmes
  contrôles, règle du 3ᵉ set et historique) : une erreur annule toute la compo, un rejeu réseau
  renvoie les mêmes matchs ; `team_compo_scan_begin(club)` (quota, SQLSTATE `PT429` → HTTP 429).
- Hors ligne : la lecture et l'enregistrement exigent le réseau ; utiliser « Ajouter match manuellement ».

Déploiement : appliquer `2026101105_team_compo.sql` et `2026101201_team_compo_scan_quota.sql`, définir le secret `ANTHROPIC_API_KEY`
(`supabase secrets set`), déployer la fonction `compo-scan`, puis la PWA.
Tests : `npm run test:team-compo` (rapprochement, SQL PGlite, Edge Function simulée, parcours UI).

## Déploiement et recette

Appliquer sur la base de développement, dans cet ordre, avant de déployer les clients :

1. `2026092101_team_scoring_rules.sql` (si pas déjà appliquée).
2. `2026092401_team_match_commands.sql`.

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

## Mise en production

La base de production n'a pas été modifiée par ce chantier. Les migrations appliquées
sur le projet de développement ne valent pas application en production.

1. Depuis cette branche à jour (ou le commit fusionné), viser explicitement la
   connexion PostgreSQL de production dans `TEAM_MATCHES_PROD_DB_URL`, sans changer
   le projet lié par défaut à la CLI. Ne pas enregistrer cette URL dans le dépôt.
2. Vérifier les migrations proposées :

   ```sh
   supabase db push --db-url "$TEAM_MATCHES_PROD_DB_URL" --include-all --dry-run
   ```

   Les seules migrations attendues pour cette PR sont, si elles ne sont pas déjà
   appliquées : `2026092101_team_scoring_rules.sql`, puis
   `2026092401_team_match_commands.sql`. `--include-all` permet d'appliquer celle du
   21 septembre si la production possède déjà les migrations d'e-mails du 23.
   Si d'autres migrations apparaissent, vérifier le décalage avant de continuer.
   Ne pas exécuter `migration repair` pour masquer une différence d'historique.
3. Après vérification du dry-run, appliquer :

   ```sh
   supabase db push --db-url "$TEAM_MATCHES_PROD_DB_URL" --include-all
   ```

4. Déployer le BO et la PWA ensemble immédiatement après les migrations. Si la
   fusion dans `main` déclenche Vercel, appliquer le SQL juste avant cette fusion.
   Les anciens clients BO doivent être actualisés : le lien au Live utilise
   désormais la commande atomique. Aucun nouveau secret, cron ou déploiement
   d'Edge Function n'est requis par cette PR.
5. Dans le BO, renseigner le troisième set des simples des compétitions actives.
   Les nouvelles règles ne réécrivent pas celles des matchs déjà créés. Les matchs
   historiques sans règle demandent un choix explicite dans la PWA.
6. Refaire un contrôle rapide : création simple/double, STB automatique, reprise
   entre deux membres, validation puis correction, état « En cours », classements
   et badge « Perf ». Actualiser la PWA installée pour charger la nouvelle version.

La synchronisation hors connexion transversale reste hors de cette livraison.
