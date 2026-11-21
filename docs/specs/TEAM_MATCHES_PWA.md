# Suivi des rencontres par équipe — décisions du 21 septembre 2026

## Périmètre validé

Une rencontre est déjà planifiée. Tout membre du club peut ajouter les matchs,
saisir les résultats, confirmer la rencontre et corriger les résultats.
La consultation ne dépend pas de la confirmation. Les frontières entre clubs
et les permissions d'écriture restent applicables.

Les places dépendent du format de compétition, doubles inclus. Création guidée :
place, joueur(s) du club, adversaire(s). Membres recherchables et texte libre,
classement du jour conservé, NC par défaut. Grille : 3e, 2e puis 4e série.
Double (25/10/2026) : en tête de chaque étape joueurs, les joueurs déjà alignés en simple
dans la rencontre (de chaque côté) se cochent d'un tap, jusqu'à deux (nom, classement et
membre repris ; un second tap les retire). Une place remplie ainsi tient sur une ligne ;
seules les places restantes affichent la saisie libre et la grille des classements.

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
Les admins du club et les **capitaines de l'équipe** peuvent changer la date et l'heure d'une
rencontre depuis sa fiche ; comme au BO, la rencontre repasse alors à confirmer si elle l'était.

### Capitaines — 26 octobre 2026
- Table `team_equipe_captains (club_id, equipe_id, user_id)` : plusieurs capitaines par équipe,
  déclarés par un admin depuis la liste des équipes du BO (`/team-matches/admin`, colonne
  *Capitaines*) ou la fiche équipe (section *Capitaines*), parmi les membres
  du club. Lecture réservée aux membres du club ; écriture `can_manage_club_content`.
- Une équipe appartient à une compétition, donc à une saison : les capitaines se redéclarent à
  chaque saison. Un capitaine retiré du club perd le droit, même si sa ligne subsiste
  (affichée « Ancien membre du club » au BO).
- `team_can_reschedule(club, rencontre)` : admin, ou capitaine de l'équipe de la rencontre.
  La PWA s'en sert pour afficher « Changer la date ».
- `team_rencontre_set_date(club, rencontre, date)` (SECURITY DEFINER) : seul chemin d'écriture
  de la date côté PWA. Il remet lui-même `confirmed_at`/`confirmed_by` à `NULL`, car
  `guard_team_encounter` ne le fait pas quand l'écriture vient du propriétaire de la fonction.
- Un changement de jour marque la rencontre `date_manuelle` (trigger, 18/11/2026) : la
  synchronisation Ten'Up ne remettra plus la date de la feuille. Voir `TEAM_MATCHES.md`,
  *Date modifiée par le club*.

### Photos de rencontre — 26 octobre 2026
- Section *Photos* sur la fiche rencontre (`TeamPhotos`) : grille visible de tous (bucket public).
- Ajout réservé aux admins et capitaines (`team_can_reschedule`). La PWA réduit chaque photo
  (1600 px, JPEG, orientation EXIF, `compressPhoto`), l'envoie sous
  `<club>/<rencontre>/<user>-<horodatage>-<i>.jpg`, puis appelle `team_rencontre_add_photos`, qui
  vérifie chemin et propriétaire Storage de chaque fichier avant de l'ajouter à `photo_urls`.
- Retrait : chacun ses propres photos (auteur lu dans le nom de fichier), l'admin toutes.
  `team_rencontre_remove_photo` retire l'URL, puis le client supprime le fichier (policy
  propriétaire). Un échec de cette suppression laisse un fichier orphelin, sans effet visible.
- Les photos ajoutées depuis la PWA sont les mêmes que celles du BO (visuel de résultat, actu).

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

## Compo d'équipe (liste des joueurs retenus) — 19 novembre 2026

Avant la rencontre, le capitaine (ou un admin) tient **une liste simple des joueurs qui
joueront**, choisis dans tout le club ou saisis à la main pour une personne sans compte. Pas de
places, de paires, de disponibilités ni de brouillon : l'affectation aux simples et doubles reste
la feuille de match du jour J (section précédente). **Toute personne connectée** voit la liste,
membre ou non ; **un visiteur ne la voit jamais**, même après la rencontre.

Livraison en 4 PR (brief `docs/briefs/compo-equipes/`) : SQL (cette section), PWA capitaine,
PWA parcours visiteur, BO. **PR1 — SQL** (`2026111901_team_compo_players.sql`) :

- **Faille corrigée** : `team_lines_public_read` laissait un visiteur lire `joueurs_club` d'un
  match saisi à l'avance. Un visiteur ne lit plus une ligne de `team_match_lines` qu'une fois la
  rencontre commencée (`date_heure <= now()`), ou si le match est en live ou a un gagnant
  (`team_line_public`). Les scores restent publics pendant et après la rencontre. Le broadcast
  `team_broadcast` n'envoie que `rencontre_id` : rien à changer.
- **Compte connecté sans adhésion** (demande en attente, autre club) : il lit désormais
  `team_saisons` → `team_rencontres` d'un club actif, et `team_match_lines` aux mêmes conditions
  qu'un visiteur (policies `*_authenticated_public_read`, même règle que les lives en
  `2026093001`). Avant, `tenant_isolation` lui renvoyait une liste vide là où un visiteur voyait tout.
- **Tables** `team_match_players` (un membre `user_id`, ou un invité `guest_prenom`/`guest_nom`/
  `guest_sex` facultatif ; `notified_at` réservé à l'option P1 « Prévenir les joueurs ») et
  `team_match_compos` (en-tête : `revision`, `updated_at`, `updated_by`). **Aucun accès direct**,
  ni anon ni authenticated : tout passe par les RPC ci-dessous. Unicité d'un membre par rencontre,
  et d'un invité par nom normalisé (`team_compo_name_key` : casse, espaces, accents).
- **Droit d'écriture** `team_can_compose` = `team_can_reschedule` (admin/manager ou capitaine de
  l'équipe), club actif.
- **RPC** (EXECUTE `authenticated` seulement) :
  - `team_compo_get(club, rencontre)` → `players [{id, is_guest, prenom, nom, initials, classement,
    is_captain, is_me, sex}]` triés par nom, `captains`, `version` (révision, 0 = jamais
    enregistrée), `updated_at`, `updated_by {prenom, nom, role: capitaine|admin}`, `can_edit`,
    `min_players = max(simples, 2 × doubles)`, `simples`, `doubles`, `format`, `genre`. Le sexe
    n'est renvoyé qu'en compétition mixte ou à qui peut modifier. Le classement est affiché à tous.
  - `team_compo_summaries(club, rencontres[])` (200 ids au plus) → pour chaque rencontre ayant au
    moins un joueur : `count`, `is_me`, `preview` (3 au plus : moi, puis capitaines, puis par nom ;
    prénom et initiales), `updated_at`. Une seule requête pour la liste « Matchs équipes ».
  - `team_compo_candidates(club, rencontre)` (`team_can_compose`) → membres au nom renseigné,
    avec classement, sexe et `is_captain`. `team_member_roster` reste inchangé pour ses usages.
  - `team_compo_save(club, rencontre, players, version)` (`team_can_compose`) : `players` =
    `[{user_id}]`, `[{id}]` (invité déjà présent) ou `[{prenom, nom?, sex?}]` ; 30 entrées au plus,
    liste vide autorisée. Enregistre en **diff** (ids et `notified_at` stables), incrémente la
    révision et renvoie `team_compo_get`.
- **Codes d'erreur** (message stable, traduit côté client par `shared/teamCompoCopy`) :
  `COMPO_AUTH_REQUIRED` (42501), `COMPO_NOT_FOUND` (P0002), `COMPO_FORBIDDEN` (42501),
  `COMPO_INVALID` / `COMPO_TOO_LARGE` / `PLAYER_NOT_MEMBER` (22023), `DUPLICATE_PLAYER` (23505,
  `DETAIL` = nom du joueur), `COMPO_STALE` (**PT409**, jamais 40001 ; `DETAIL` = prénom de l'auteur
  de la dernière version).

Déploiement : appliquer `2026111901_team_compo_players.sql` (aucun client ne l'utilise encore).
Tests : `npm run test:team-compo` (`tests/team-compo-players-sql.test.mjs`).

**PR2 — PWA, côté capitaine** (`2026111902_team_compo_user_id.sql` + PWA) :

- `team_compo_get` renvoie aussi `user_id` des membres retenus, **seulement à qui peut modifier**
  (`null` pour un lecteur simple) : l'éditeur en a besoin pour renvoyer la liste à `team_compo_save`.
- Section **« Compo »** de la fiche rencontre (`TeamLineupSection`), entre l'en-tête et « Matchs »,
  masquée pour une rencontre WO :
  - visiteur, rencontre pas encore commencée : « Qui joue ? Connectez-vous » + `Se connecter`
    (« Vous reviendrez ici juste après. », vrai pour la connexion seulement) / `Créer un compte` ;
    c'est alors le seul bouton de connexion de la fiche. Rien une fois la rencontre commencée (la
    feuille de match publique prend le relais). Même rendu qu'une compo existe ou non ;
  - compo vide : « Compo pas encore saisie » + « Romain Escaffre, capitaine, l'ajoutera ici avant la
    rencontre. » ; pour l'admin ou le capitaine, texte d'invitation + `Choisir les joueurs`. Rencontre
    commencée sans compo : rien, sauf pour qui peut encore la saisir ;
  - compo saisie : liste par nom (initiales, moi en rouge, sans compte en pointillé, étiquettes
    « Vous » et « Capitaine », classement), nombre de joueurs, note « Visible uniquement par les
    personnes connectées. », « N joueurs · Modifier » pour l'admin ou le capitaine, « Compo
    enregistrée » 3 s après un enregistrement. À la fermeture de la feuille, le focus revient au bouton
    qui l'ouvre (« Modifier », ou « Choisir les joueurs » si la compo est restée vide).
  - garde-fou : si un membre retenu arrive sans `user_id` (serveur sans `2026111902`), la feuille ne
    s'ouvre pas et un message demande de recharger. Enregistrer aurait effacé ce joueur.
- Feuille **« Choisir les joueurs »** (`TeamLineupEditor`, sur `TeamSheet`) : sous-titre « Tout le
  club · 3 simples, 1 double · Rencontre messieurs » (dames, garçons, filles ; rien en mixte) ; recherche « Rechercher
  ou saisir un nom » ; puces `Tous` / `Hommes` / `Femmes` avec effectifs, présélectionnées selon le
  genre de la compétition, masquées si les membres n'ont pas pu être chargés (« Impossible de charger
  les membres du club. » + `Réessayer`). Une recherche parcourt tout le club : « Tous » s'allume, et
  choisir une puce efface la recherche. Groupe « Retenus · N » en tête (N = joueurs cochés, comme le
  pied de la feuille) : un joueur coché y remonte, un joueur décoché y reste jusqu'à la fermeture ;
  une personne cochée hors du genre de la rencontre porte la mention « Femme · Rencontre messieurs »,
  ajoutée à « Capitaine » le cas échéant, sans rien bloquer. La liste de la fiche porte la même
  mention quand le sexe est reçu (admin ou capitaine) ; un retenu qui a quitté le club y est marqué « N'est
  plus membre du club » ; reste du club par nom ; ligne entière cochable (`role="checkbox"`, 56 px,
  case 26 px) ; classement en pastille, rien s'il n'est pas renseigné (NC est un vrai classement).
  Nom introuvable : « Aucun membre du club ne s'appelle « … » » + carte « Ajouter …, sans compte »
  (sexe facultatif, prérempli selon la rencontre : Homme en messieurs, Femme en dames, « Non précisé »
  en mixte) ; si des membres correspondent en partie, ils sont
  listés et l'ajout sans compte vient en dernier ; un invité déjà dans la liste n'est pas reproposé. Pied fixe : indication de nombre
  (`role="status"`, orange sous le minimum, jamais bloquante ; en mixte « 5 joueurs · 3 femmes,
  2 hommes »), masquée si les membres n'ont pas pu être chargés, et `Enregistrer la compo`, jamais
  grisé. Un retenu sorti du club est nommé avant tout envoi : « Léa Partie ne fait plus partie du
  club. Retirez-le de la compo. » Erreurs en `role="alert"` : doublon, version
  périmée avec `Recharger`, droits, hors ligne (les choix sont gardés). Fermer avec des changements
  demande « Abandonner vos changements ? » (focus sur `Continuer à modifier`).
- Le bouton « Photographier la compo » devient **« Photographier les feuilles de match »** (21/11/2026 ;
  « Saisir la feuille de match » ne disait pas qu'il s'agit d'une photo). Avant l'heure de la
  rencontre, il est secondaire et la section « Compo » vient avant « Matchs » (bouton plein :
  « Choisir les joueurs »). Une fois l'heure passée (ou un match en live / avec un résultat), la photo
  devient le bouton plein, « Choisir les joueurs » passe en secondaire et la section « Compo » descend
  sous les matchs. État vide des matchs : « Matchs à venir » et « Photographiez les feuilles de match
  des deux équipes, ou ajoutez les matchs à la main. »
- Textes partagés avec le futur écran du BO : `shared/teamCompoCopy.mjs`.
- Le parcours visiteur est livré par la PR3 (ci-dessous).

Déploiement : appliquer `2026111902_team_compo_user_id.sql` **avant** la PWA.

**PR3 — PWA, parcours visiteur** (sans migration) :

- **Cartes de la liste « Matchs équipes »** (`TeamCompoSummary` dans `MatchEquipeCell`), rencontres
  pas encore commencées seulement :
  - connecté : jusqu'à 3 pastilles d'initiales (moi en rouge, sans compte en pointillé, « +N ») puis
    les prénoms (« Claire, Marie, Sophie +1 ») ; si je joue, « Vous jouez » + « 5 joueurs » ; liste
    vide : cercle en pointillé + « Compo à venir ». Un seul appel `team_compo_summaries` pour toute la
    liste (clé `['team-compo-summaries', club, ids]`, invalidée après un enregistrement), jamais en
    anonyme ;
  - visiteur : bandeau « Connectez-vous pour voir qui joue chaque rencontre. » + `Se connecter`, et
    « Compo réservée aux connectés » avec un cadenas sur chaque carte à venir ;
  - les pastilles sont décoratives : l'`aria-label` de la carte gagne « Vous jouez, compo de 5
    joueurs », « compo de 4 joueurs », « compo à venir » ou « compo réservée aux personnes connectées ».
- **Fiche rencontre** : carte « Vous jouez cette rencontre » (date, heure, lieu) si je suis retenu ;
  fraîcheur « Mise à jour il y a 2 h par Romain Escaffre, capitaine » (« il y a 5 min », « hier à
  18h42 », « le 12 nov. à 9h », heure de Paris, `freshnessLabel`) ; jusqu'à 6 joueurs dans la fiche,
  au-delà les 6 premiers + `Voir les 10 joueurs`, qui ouvre la feuille « Compo · 10 joueurs ». En
  mixte, la liste est groupée « Dames · 4 », « Messieurs · 5 », « Sexe non précisé · 1 » (dans la
  feuille, et dans la fiche quand elle montre tout).
- **Retour sur la même rencontre** : `Se connecter` passe `state.from` et le contexte de la rencontre ;
  `/login` affiche « Connectez-vous pour voir la compo de CAC – TC Grisolles 1, dimanche 22 novembre.
  Vous reviendrez ensuite sur la rencontre. » et accepte aussi `?returnTo=` (rechargement, texte
  générique). `Créer un compte` porte `?returnTo=/matches-equipes/:id` : `signupReturnTo` accepte
  désormais une fiche rencontre (en plus de `/cours`), y compris via l'e-mail de confirmation et le
  lien « Se connecter » de la page de confirmation. Au retour, toast « Vous êtes connecté. Voici la
  compo. » et focus sur le titre « Compo » ; la marque est retirée de l'historique (pas de toast au
  rechargement). Une demande d'adhésion en attente voit la compo (décision 1).

Tests : `npm run test:team-compo` (`tests/team-compo-visitor-client.test.mjs`).
Tests : `npm run test:team-compo` (`tests/team-lineup-client.test.mjs` en plus).

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
   Les joueurs des simples déjà créés sont proposés en tête, des deux côtés : deux taps
   suffisent sans défiler ; un joueur sans simple se saisit à la main sur la place libre.
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
