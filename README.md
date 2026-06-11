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
- **Admin** : saisons (une seule active à la fois) et compétitions (nom, type adultes/jeunes, genre, catégorie, format)
- **Équipes** par compétition : division, nombre de journées de poule (les journées sont générées automatiquement)
- **Phase de poule** puis **phases finales** : qualification d'une équipe avec stade de départ (les stades 1/16 → finale sont générés automatiquement)
- **Rencontres** : club adverse, date/lieu, score final (saisie manuelle ou calculé depuis le Live Score selon le format)
- **Matches individuels** (simples/doubles) avec bascule en un clic vers le **Live Score** ; le résultat du live met à jour le gagnant et recalcule le score de la rencontre
- **Photos** de la rencontre (bucket dédié) et bouton **« Créer une actu »** qui préremplit le formulaire d'actu avec le titre et les photos
- **Génération d'affiche** des rencontres à venir : sélection (max 8) → affiche JPEG téléchargée localement

### PWA — bannière d'incitation à l'installation
- Bannière fixe en bas (au-dessus de la barre de navigation) qui invite à installer l'app sur l'écran d'accueil
- Variante Android Chrome/Edge : bouton « Installer » qui déclenche le prompt natif (`beforeinstallprompt`)
- Variante iOS Safari : instructions visuelles « Touche [Partager] · puis [+] Sur l'écran d'accueil »
- Masquée si l'app est déjà installée (mode standalone)
- Fermeture (croix ou « Plus tard ») : reproposée 7 jours plus tard

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
- Le format suit la charte graphique CAC Tennis

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
