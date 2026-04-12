# Gestionnaire de Tournois TMC

Application web pour organiser des tournois de tennis multi-chances (TMCs) et générer des affiches de programmation.

## Fonctionnalités

### Planification TMC
- Configuration de tournois multi-chances avec différents nombres de joueurs (4, 8, ou 16)
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

### Général
- Authentification via Supabase
- Sauvegarde automatique avec localStorage

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
- **Nombre de joueurs** : 4, 8 ou 16 (puissance de 2)
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
- **Import PDF** : Importer directement une feuille de programmation FFT/TEN'UP. L'application extrait automatiquement les joueurs, classements, horaires et courts.
- **Saisie CSV** : Saisir manuellement les données des matches au format CSV.

#### 2. Export en image

Une fois les matches chargés, cliquez sur "Télécharger" pour générer une image JPEG par page.
- Chaque page contient jusqu'à 8 matches
- Le format suit la charte graphique CAC Tennis

## Format TMC (Tournoi Multi-Chances)

Dans un TMC, chaque joueur dispute **exactement le même nombre de matches**.

### Exemple pour 8 joueurs

Chaque joueur joue 3 matches au total :
- **Tableau principal** : 7 matches
  - 4 quarts de finale
  - 2 demi-finales
  - 1 finale
- **Matches de classement** : 5 matches
  - 4 matches pour les places 5 à 8
  - 1 match pour la 3ème place

**Total** : 12 matches

### Exemple pour 4 joueurs

Chaque joueur joue 2 matches :
- 2 demi-finales
- 1 finale
- 1 match pour la 3ème place

**Total** : 4 matches

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
│   └── LoginPage.tsx               # Authentification
├── components/
│   ├── ConfigurationForm.tsx       # Formulaire de configuration TMC
│   ├── ScheduleView.tsx            # Vues calendrier et tableau avec drag-and-drop
│   └── ConfigDropdown.tsx          # Sélecteur de configurations prédéfinies
├── hooks/
│   └── useLocalStorage.ts          # Hook pour localStorage
├── lib/
│   └── supabase.ts                 # Client Supabase
├── types.ts                        # Définitions TypeScript
├── tmcLogic.ts                     # Logique de génération des matches TMC
├── scheduler.ts                    # Algorithme de planification
├── moveMatch.ts                    # Logique de déplacement des matches
├── App.tsx                         # Configuration du routeur
└── main.tsx                        # Point d'entrée
```

## Licence

MIT
