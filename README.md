# Gestionnaire de Tournois TMC

Application web pour organiser des tournois de tennis multi-chances (TMCs) et générer des affiches de programmation.

## Fonctionnalités

### Planification TMC
- Configuration de tournois multi-chances avec différents nombres de joueurs (4, 8, 12 ou 16)
- Gestion des créneaux horaires par jour
- Planification automatique des matches sur plusieurs courts
- Support de tournois simultanés (hommes et femmes)
- Filtrage par classement de tennis (NC à 15)
- Vue calendrier et vue tableau pour le planning
- Déplacement des matches par glisser-déposer
- Export du planning au format CSV (compatible Excel)

### Génération d'affiches de programmation
- Import PDF depuis les feuilles de programmation FFT/TEN'UP
- Saisie manuelle via CSV
- Export en image JPEG (haute qualité, ratio 2×)
- Mise en page A4 avec 8 matches par page (2 colonnes × 4 lignes)
- Charte graphique CAC Tennis intégrée
- **Basculement vers Live Score** : depuis l'aperçu, un bouton crée tous les matchs détectés dans Live Score (statut « En attente », événement lié optionnel) — plus de double saisie

### Événements
- Gestion des événements du club (Animations, Tournois, Sorties, Soirées)
- Liste paginée avec toggle « à venir / passés »
- Formulaire de création/édition avec description en Markdown (aperçu intégré)
- Upload d'image (JPEG/PNG, max 5 Mo) stockée sur Supabase Storage
- Actions : modifier, dupliquer, supprimer
- Exposition d'un flux JSON authentifié (via client Supabase) pour une future webapp publique

### Live Score
- Saisie en temps réel du score d'un match de tennis (simple ou double)
- Liste des matchs regroupés en 3 sections : en live / en attente / terminés
- Création d'un match (joueurs, classements, clubs, événement lié optionnel)
- Interface +/- par joueur pour saisir les jeux et les tiebreaks
- Détection automatique du vainqueur (sets 1 et 2, avec set décisif normal ou super tiebreak)
- Possibilité d'annuler la fin de match pour corriger une erreur de saisie
- Badge « À supprimer » sur les matchs terminés depuis plus de 2 jours
- Table `live_matches` exposée via Supabase Realtime
- Disponible aussi côté PWA : connexion avec un compte BO → création de match, démarrage/reprise/libération d'un live, suivi du score, suppression. Un live a un gestionnaire (champ `scored_by`) ; un autre utilisateur authentifié peut **prendre le contrôle** après confirmation (warning avec le nom du gestionnaire actuel) — le précédent gestionnaire, s'il est sur la page de saisie, voit un bandeau l'avertir et bascule en lecture seule via Realtime.

### Actus
- Rédaction d'actualités du club avec contenu en Markdown (aperçu intégré)
- Upload **multi-images** facultatif (JPEG/PNG, max 5 Mo par image, bucket Supabase Storage)
- Statut **brouillon** ou **publié** ; deux boutons distincts dans le formulaire
- Date de première publication conservée (`published_at` jamais écrasée)
- Actions sur la liste : modifier, publier, dépublier, supprimer
- Table `actus` exposée en lecture publique au rôle `anon` (préparation PWA, uniquement les actus publiées)

### Matches par équipe
- Gestion des **rencontres interclubs** du club (back-office), indépendamment des événements
- **Vue « grille de saison »** : lignes = équipes groupées par compétition, colonnes = journées de poule puis tours de phase finale. Chaque cellule est une rencontre colorée par état (victoire, défaite, nul, score à saisir, à venir, WO, à programmer) et cliquable — **saisir un score prend 2 clics**
- Deux vues alternatives sur les mêmes données : **Agenda** (à saisir / ce week-end / week-end suivant / déjà jouées) et **Liste** (une ligne par équipe, avancement, bilan, état)
- **Panneau latéral** : détail de la rencontre sélectionnée (score, matches individuels, raccourcis Live Score / Photos / Actu / WO) ou générateur d'affiche
- Un compteur d'en-tête remonte les **scores à saisir** — les rencontres jouées sans score ne se découvrent plus par hasard
- **Référentiel** (carte « Saisons & équipes » sur l'accueil) : saisons (une seule active à la fois), compétitions (nom, type adultes/jeunes, genre, catégorie, format) et équipes (création/suppression)
- Une compétition peut être marquée **« terminée »** : elle quitte la grille active pour une section repliée, sans disparaître
- **Équipes** par compétition : division, nombre de journées de poule (les journées sont générées automatiquement)
- **Phase de poule** puis **phases finales** : qualification d'une équipe avec stade de départ (les stades 1/16 → finale sont générés automatiquement)
- **Rencontres** : club adverse, date/lieu, score final (saisie manuelle ou calculé depuis le Live Score selon le format)
- **Matches individuels** (simples/doubles) avec bascule en un clic vers le **Live Score** ; le résultat du live met à jour le gagnant et recalcule le score de la rencontre
- **Photos** de la rencontre (bucket dédié) et bouton **« Créer une actu »** qui préremplit le formulaire d'actu avec le titre et les photos
- **Génération d'affiche** des rencontres à venir, depuis le panneau latéral : les rencontres du week-end courant sont présélectionnées (max 8), l'aperçu suit la sélection → affiche JPEG téléchargée localement (`affiche-rencontres-AAAA-MM-JJ.jpg`). Le fond se choisit parmi les fonds du club, ajoutés dans *Admin › Configuration du site › Affiches* ; **sans aucun fond configuré, la génération est impossible**

### PWA — navigation
- Trois onglets en bas : **Actu**, **Match équipes**, **Live**
- **Actu** : Actualités et Événements fusionnés, basculables via des sous-onglets soulignés (l'URL conserve `?tab=…`, pull-to-refresh sur les deux flux)
- **Match équipes** : rencontres interclubs d'une équipe du club en **lecture** — à venir / passées, filtrables par saison et par équipe (bottom sheet). Cellule en mode résultat (victoire/défaite/nul + score) pour les rencontres passées. Pas d'édition depuis la PWA, pas d'exposition des joueurs nominatifs
- **Live** : suivi du live score (inchangé)

### PWA — bannière d'incitation à l'installation
- Bannière fixe en bas (au-dessus de la barre de navigation) qui invite à installer l'app sur l'écran d'accueil
- Variante Android Chrome/Edge : bouton « Installer » qui déclenche le prompt natif (`beforeinstallprompt`)
- Variante iOS Safari : instructions visuelles « Touche [Partager] · puis [+] Sur l'écran d'accueil »
- Masquée si l'app est déjà installée (mode standalone)
- Fermeture (croix ou « Plus tard ») : reproposée 7 jours plus tard

### Comptes, rôles et invitations
- Accès au back-office **sur invitation** : tout se passe sur l'écran *Admin › Membres* (`/admin/members`), réservé aux administrateurs du club. L'ancienne adresse `/admin/invite` y redirige.
- **Inviter** : par email, ou en générant un lien à copier (utile en cas de blocage SMTP). L'invitation porte un **rôle**, choisi à l'envoi (défaut : Membre, le moins privilégié) :
  - **Administrateur** — tous les modules + gestion des membres
  - **Gestionnaire** — contenus et outils du club (actus, événements, matches par équipe, affiche, planning), sans gestion des membres
  - **Membre** — Live Score uniquement (profil adhérent PWA)
- Le rôle définit ce que la personne **voit** dans le back-office : le dashboard n'affiche que les modules autorisés
- **Gérer les membres** depuis le même écran : liste (nom, email, rôle, statut), changement de rôle, retrait du club, et relance de l'invitation pour quelqu'un qui n'a jamais activé son compte
  - Une invitation non activée apparaît dans la liste avec le badge *Invitation en attente* — c'est l'email qui identifie la personne tant qu'elle n'a pas rempli son profil
  - **Retirer** quelqu'un coupe son accès immédiatement, mais ne supprime pas son compte : une nouvelle invitation le rattachera
  - Un club doit toujours garder **au moins un administrateur** : rétrograder ou retirer le dernier est refusé
- Un compte qui n'appartient pas au club du back-office ouvert se voit refuser l'accès avec un message explicite (et un bouton de déconnexion), au lieu d'un back-office aux listes vides
- Inviter un email qui a déjà un compte le **rattache** au club courant, sans nouvel email

### Configuration du site
Écran *Admin › Configuration du site* (`/admin/site`), réservé aux **administrateurs** du club — un gestionnaire n'y a pas accès.

- Permet de renseigner les informations publiques du club **sans passer par la base** : identité (nom, sport, ville, logos, **couleurs**), page d'accueil (bandeau, chiffres clés, teasers école et infrastructures, appel à l'action), **Le Club** (président·e, encadrant, valeurs, méthodes et niveaux, programmes, bureau), **Infrastructures** (courts, club house, vestiaires), **Tarifs** (adhésion, cours, autres frais), coordonnées (adresse, téléphone, e-mail, lien Maps, horaires d'accueil), réseaux sociaux, partenaires, mentions légales et affichage des sections.
- Ces informations alimentent le **futur site vitrine** du club. Elles ne changent **ni le back-office, ni l'application des adhérents**, à **deux exceptions près** : les **couleurs** (voir ci-dessous) et le panneau ***Affiches***, qui porte des réglages utilisés par le back-office lui-même.
- **Un bouton d'enregistrement par panneau** : corriger un numéro de téléphone ne réécrit pas l'identité du club, et deux personnes qui modifient deux panneaux différents ne s'écrasent pas.
- Les panneaux sont **repliés par défaut** — cliquer sur un titre le déplie. Chacun indique s'il est *Configuré* ou *À compléter*, ce qui donne une vue d'avancement de la saisie ; un panneau qui porte des **modifications non enregistrées** le signale plutôt que de les cacher, et replier ne perd jamais une saisie en cours.
- Les champs marqués ⬤ sont ceux qu'attend le site vitrine, mais **un panneau incomplet s'enregistre** : on peut compléter plus tard.
- Les listes (chiffres clés, valeurs du club, programmes, membres du bureau, courts, formules de tarifs, horaires…) s'ajoutent, se retirent et se réordonnent. Une **entrée à demi remplie est refusée**, en la nommant (« 2ᵉ horaire — « Jour » est obligatoire. ») : la laisser passer ferait perdre toute la liste au rechargement suivant.
- Le panneau **Partenaires** tient la bande « Ils soutiennent le club » : un logo par partenaire (obligatoire), un nom et un lien facultatifs. Les partenaires se réordonnent, et retirer un partenaire supprime son logo.
- Le panneau **Affichage des sections** décide des blocs visibles sur le site vitrine (actualités, prochains rendez-vous, partenaires, chiffres clés). Les quatre sont **cochés par défaut** : un club qui n'a jamais ouvert cet écran affiche tout. Décocher masque le bloc **sur le site vitrine seulement** — les actus et les événements restent publiés dans l'application des adhérents.
- Dans le panneau **Tarifs**, les tarifs des formules d'adhésion et de cours se saisissent **en chiffres seuls** (« 210 ») — laissés vides, aucun tarif n'est affiché, et surtout pas « 0 € ». Les **autres frais** sont l'exception : leur tarif est du texte libre (« 15€ / h »), l'unité y étant variable.
- Le panneau **Affiches** — le dernier, et le seul qui ne concerne pas le site vitrine — porte les **fonds des affiches générées par le back-office** : celles de la programmation TMC et celles des rencontres par équipes.
  - **Plusieurs fonds par affiche.** Chacun porte un **nom** (« Tournoi de la Pentecôte », « Été 2026 ») et une **image** : au moment de générer, vous choisissez lequel appliquer parmi des vignettes. Les fonds s'ajoutent, se réordonnent et **se suppriment** ; retirer un fond efface aussi son image du stockage.
  - **Format attendu : A4 portrait** (ratio 0,71) — *794 × 1123 px minimum* pour la programmation TMC, *1414 × 2000 px minimum* pour les rencontres. **Plus grand est accepté** : un 2480 × 3508 (A4 à 300 dpi) convient pour les deux, et la même image peut servir aux deux affiches.
  - Le fond n'est pas un décor mais un cadre : les textes s'écrivent par-dessus, à des emplacements fixes que le champ indique (haut de l'affiche et grille des matchs d'un côté, bande centrale de l'autre) — **laissez ces zones libres**.
  - Une image aux mauvaises proportions est **refusée au choix du fichier**, en annonçant le ratio attendu et celui reçu ; rien n'est envoyé. Une image trop petite est refusée aussi : elle sortirait floue à l'export.
  - ⚠️ **Sans aucun fond configuré, l'affiche ne peut pas être générée** — le bouton est désactivé et un message renvoie vers cet écran. Un fond au minimum par affiche est donc à prévoir avant d'utiliser les deux modules.
- Les images sont envoyées **à l'enregistrement du panneau**, pas au choix du fichier ; remplacer ou retirer une image supprime l'ancienne.

#### Couleurs du club
Trois champs dans *Identité du club › Couleurs*, qui repeignent **le back-office et l'application des adhérents** :

| Champ | Effet |
|---|---|
| **Couleur principale** (obligatoire) | Boutons, liens, en-têtes, anneaux de focus. C'est elle qui **teinte tout le reste** : fonds, bordures, textes secondaires et dégradé de la page en sont dérivés. |
| **Couleur secondaire** | Boutons secondaires. Laissée vide : dérivée de la principale (même teinte, plus claire). |
| **Couleur d'accent** | Fonds doux, survols, badges. Laissée vide : dérivée de la principale. |

Le **logo principal** sert aussi d'**icône d'onglet** (favicon) au back-office et à l'application, et d'icône d'écran d'accueil sur iOS et Android. Une image **carrée** rend donc mieux qu'un logo large, que le navigateur déformera.

- La couleur du texte posé sur la principale et la secondaire (blanc ou foncé) est **choisie automatiquement** selon le contraste — une couleur claire ne donne pas du blanc sur blanc.
- Les couleurs de **sens** ne changent jamais : rouge d'erreur et bouton *Supprimer*, vert/rouge/jaune des résultats gagné / perdu / nul.
- L'effet est **immédiat** sur cet écran après enregistrement ; les autres écrans le prennent au prochain chargement.
- ⚠️ Les **affiches générées** (Programmation Image, Matches par équipe) gardent pour l'instant le rouge du CAC : elles ne suivent pas encore ces couleurs.

### Console plateforme (super-admin)
Réservée au **super-admin** de la plateforme, sur `/super-admin` (carte *Plateforme › Console plateforme* du dashboard). Invisible et inaccessible pour un administrateur de club.

- **Créer un club** : nom, slug et sport. Le slug est le sous-domaine du club (`<slug>.feelike.app`) : minuscules, chiffres et tirets, 2 à 32 caractères, ni préfixe `app-` (réservé à la PWA) ni slug réservé par la plateforme. Sa ligne de configuration est créée automatiquement.
- **Lister** les clubs avec leur statut, leur date de création, leur nombre de membres et un marqueur **« aucun admin »** — l'état d'un club fraîchement créé, dont l'action suivante est l'invitation.
- **Inviter le premier administrateur** d'un club, par email ou en générant un lien à copier.
- **Suspendre / réactiver** un club. Un club suspendu n'est plus accessible à ses membres (back-office et PWA). Suspendre le club dans lequel on se trouve est refusé.
- **Entrer dans un club en support** : le back-office bascule sur ce club (même suspendu, pour diagnostic), avec un bandeau permanent rappelant où l'on se trouve et un bouton *Quitter*. Ça ne donne aucun droit supplémentaire : le club affiché change, pas les permissions.

Le **tout premier super-admin** se pose à la main dans le SQL Editor Supabase — il n'existe volontairement aucune interface de promotion (personne ne peut se promouvoir soi-même) :

```sql
UPDATE public.profiles SET is_super_admin = true
WHERE id = (SELECT id FROM auth.users WHERE email = '<email>');
```

### Général
- Authentification via Supabase
- Sauvegarde automatique avec localStorage (TMC) et Supabase (Events)

## Installation

```bash
# Installer les dépendances
npm install

# Lancer en mode développement
npm run dev

# Compiler pour la production
npm run build
```

### Configuration de l'environnement (nouveau dev)

L'application pointe sur Supabase via des variables d'environnement. **En local, on travaille toujours sur le projet Supabase de développement** — jamais sur la production.

Pour le back-office (racine du projet) :

```bash
# Copier le modèle versionné
cp .env.example .env.local

# Puis éditer .env.local et renseigner les clés du projet Supabase de DEV :
#   VITE_SUPABASE_URL      → dashboard Supabase (dev) → Project Settings → API
#   VITE_SUPABASE_ANON_KEY → idem
#   VITE_ENV=development    (à garder tel quel en local)
```

Faire de même pour la PWA :

```bash
cp pwa/.env.example pwa/.env.local
# puis renseigner les mêmes clés du projet Supabase de DEV
```

Notes :
- `.env` et `.env.local` sont gitignorés : **aucune clé réelle n'est versionnée**.
- `VITE_ENV` vaut `development` en local et `production` sur les déploiements. Si un serveur de dev local démarre avec `VITE_ENV=production`, un avertissement est loggé dans la console pour éviter d'atteindre la prod par erreur.

### Whitelist des URLs de redirection (obligatoire pour les invitations)

Le flux d'invitation renvoie l'invité sur `<origin>/accept-invite`, où `<origin>` est
l'origine réelle de l'app (`window.location.origin` — aucun port n'est codé en dur). Supabase
n'autorise cette redirection que si elle figure dans **Authentication → URL Configuration →
Redirect URLs** du projet concerné ; sinon il retombe **silencieusement** sur le *Site URL* et
l'invité n'atteint jamais l'écran d'activation (il reçoit bien l'email, mais le lien le dépose
ailleurs).

À déclarer une fois par projet Supabase :

| Projet | Entrée |
|---|---|
| dev | `http://localhost:*/**` — glob de port : survit au décalage de Vite (5173 → 5174 → …) quand plusieurs serveurs de dev tournent |
| prod | l'origine de déploiement, ex. `https://<projet>.vercel.app/**` (puis `https://*.feelike.app/**` au passage au wildcard) |

## Utilisation

### Planification TMC

#### 1. Configuration Générale

- **Date de début/fin** : Définissez la période du tournoi
- **Nombre de courts** : Nombre de courts disponibles
- **Durée d'un match** : Durée estimée en minutes (par défaut 90min)

#### 2. Créneaux Horaires

Pour chaque jour du tournoi, définissez :
- La date
- L'heure du premier match
- L'heure du dernier match (dernière heure de début autorisée)

#### 3. Tournois

Ajoutez autant de tournois que nécessaire :
- **Sexe** : Homme ou Femme
- **Nombre de joueurs** : 4, 8, 12 ou 16 (12 joueurs = tableau asymétrique, 4 joueurs exemptés du 1er tour)
- **Classement minimum et maximum** : De NC (le plus bas) à 15 (le plus haut)

#### 4. Génération du Planning

Une fois tous les paramètres renseignés, cliquez sur "Générer le Planning" pour obtenir :
- Une vue calendrier jour par jour avec déplacement des matches par glisser-déposer
- Une vue tableau complète
- L'identification de chaque match par tournoi et type (quart, demi, finale, etc.)

### Génération d'affiches de programmation

Accessible depuis le menu principal → **Programmation Image**.

#### 1. Import des données

Deux méthodes disponibles :
- **Import PDF** : Importer directement une feuille de programmation FFT/TEN'UP. L'application extrait automatiquement les joueurs, classements, clubs et horaires.
- **Saisie CSV** : Saisir manuellement les données des matches au format CSV (sans club).

#### 2. Export en image

Une fois les matches chargés, cliquez sur "Télécharger" pour générer une image JPEG par page.
- Chaque page contient jusqu'à 8 matches
- Le fond de l'affiche se choisit **parmi les fonds du club**, ajoutés dans *Admin › Configuration du site › Affiches* : une rangée de vignettes au-dessus de l'aperçu, le premier fond par défaut. **Sans aucun fond configuré, la génération est impossible.**

#### 3. Basculer les matches vers Live Score

Sous l'aperçu, la zone **« Envoyer vers Live Score »** permet de créer en un clic tous les matches détectés dans le module Live Score :
- Sélection optionnelle d'un événement à associer aux matches
- Tous les matches sont créés avec le statut « En attente » et devront être démarrés manuellement depuis `/live-score`
- Le bouton se réinitialise dès qu'un nouveau PDF/CSV est importé

## Technologies

- **React 19** : Framework UI
- **TypeScript** : Typage statique
- **Vite** : Build tool
- **Tailwind CSS** : Styling
- **Supabase** : Authentification et base de données
- **html-to-image** : Génération d'images depuis le DOM
- **pdfjs-dist** : Parsing des PDFs FFT/TEN'UP
- **localStorage** : Persistance locale des données

## Structure du Projet

```
src/
├── pages/
│   ├── AppHomePage.tsx             # Dashboard principal
│   ├── HomePage.tsx                # Liste des tournois
│   ├── TournamentPage.tsx          # Configuration et planning d'un tournoi
│   ├── ProgrammationImagePage.tsx  # Générateur d'affiches
│   ├── EventsPage.tsx              # Liste des événements du club
│   ├── LiveScorePage.tsx           # Liste des matchs en live score
│   ├── LiveMatchPage.tsx           # Saisie du score d'un match
│   ├── ActusPage.tsx               # Liste des actus du club (brouillons + publiées)
│   └── LoginPage.tsx               # Authentification
├── components/
│   ├── ConfigurationForm.tsx       # Formulaire de configuration TMC
│   ├── ScheduleView.tsx            # Vues calendrier et tableau avec drag-and-drop
│   ├── ConfigDropdown.tsx          # Sélecteur de configurations prédéfinies
│   ├── EventCard.tsx               # Carte d'un événement
│   ├── EventForm.tsx               # Formulaire création/édition d'événement
│   ├── LiveMatchCard.tsx           # Carte d'un match dans la liste Live Score
│   ├── LiveMatchForm.tsx           # Formulaire de création d'un match en live
│   ├── LiveScoreEntry.tsx          # Interface +/- de saisie de score
│   └── ActuForm.tsx                # Formulaire création/édition d'actu (Markdown + multi-images)
├── hooks/
│   └── useLocalStorage.ts          # Hook pour localStorage
├── lib/
│   └── supabase.ts                 # Client Supabase
├── types.ts                        # Définitions TypeScript
├── tmcLogic.ts                     # Logique de génération des matches TMC
├── scheduler.ts                    # Algorithme de planification
├── moveMatch.ts                    # Logique de déplacement des matches
├── exportScheduleCsv.ts            # Export du planning TMC en CSV
├── liveScoreRules.ts               # Règles de score tennis (sets, tiebreak, super TB)
├── App.tsx                         # Configuration du routeur
└── main.tsx                        # Point d'entrée
```

## Licence

MIT
