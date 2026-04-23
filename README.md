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

### Génération d'affiches de programmation
- Import PDF depuis les feuilles de programmation FFT/TEN'UP
- Saisie manuelle via CSV
- Export en image JPEG (haute qualité, ratio 2×)
- Mise en page A4 avec 8 matches par page (2 colonnes × 4 lignes)
- Charte graphique CAC Tennis intégrée

### Événements
- Gestion des événements du club (Animations, Tournois, Matchs par équipe, Sorties, Soirées)
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
- Table `live_matches` exposée via Supabase Realtime (préparation PWA publique)

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
│   └── LoginPage.tsx               # Authentification
├── components/
│   ├── ConfigurationForm.tsx       # Formulaire de configuration TMC
│   ├── ScheduleView.tsx            # Vues calendrier et tableau avec drag-and-drop
│   ├── ConfigDropdown.tsx          # Sélecteur de configurations prédéfinies
│   ├── EventCard.tsx               # Carte d'un événement
│   ├── EventForm.tsx               # Formulaire création/édition d'événement
│   ├── LiveMatchCard.tsx           # Carte d'un match dans la liste Live Score
│   ├── LiveMatchForm.tsx           # Formulaire de création d'un match en live
│   └── LiveScoreEntry.tsx          # Interface +/- de saisie de score
├── hooks/
│   └── useLocalStorage.ts          # Hook pour localStorage
├── lib/
│   └── supabase.ts                 # Client Supabase
├── types.ts                        # Définitions TypeScript
├── tmcLogic.ts                     # Logique de génération des matches TMC
├── scheduler.ts                    # Algorithme de planification
├── moveMatch.ts                    # Logique de déplacement des matches
├── liveScoreRules.ts               # Règles de score tennis (sets, tiebreak, super TB)
├── App.tsx                         # Configuration du routeur
└── main.tsx                        # Point d'entrée
```

## Licence

MIT
