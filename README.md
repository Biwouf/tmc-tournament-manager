# Gestionnaire de Tournois TMC

Application web pour organiser des tournois de tennis multi-chances (TMCs).

## Fonctionnalités

- Configuration de tournois multi-chances avec différents nombres de joueurs (4, 8, ou 16)
- Gestion des créneaux horaires par jour
- Planification automatique des matches sur plusieurs courts
- Support de tournois simultanés (hommes et femmes)
- Filtrage par classement de tennis (40 à 15)
- Sauvegarde automatique avec localStorage
- Vue calendrier et vue tableau pour le planning
- Interface responsive et moderne

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

### 1. Configuration Générale

- **Date de début/fin** : Définissez la période du tournoi
- **Nombre de courts** : Nombre de courts disponibles
- **Durée d'un match** : Durée estimée en minutes (par défaut 90min)

### 2. Créneaux Horaires

Pour chaque jour du tournoi, définissez :
- La date
- L'heure du premier match
- L'heure du dernier match (dernière heure de début autorisée)

### 3. Tournois

Ajoutez autant de tournois que nécessaire :
- **Sexe** : Homme ou Femme
- **Nombre de joueurs** : 4, 8 ou 16 (puissance de 2)
- **Classement minimum et maximum** : De 40 (le plus bas) à 15 (le plus haut)

### 4. Génération du Planning

Une fois tous les paramètres renseignés, cliquez sur "Générer le Planning" pour obtenir :
- Une vue calendrier jour par jour
- Une vue tableau complète
- L'identification de chaque match par tournoi et type (quart, demi, finale, etc.)

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

- **React** : Framework UI
- **TypeScript** : Typage statique
- **Vite** : Build tool
- **Tailwind CSS** : Styling
- **localStorage** : Persistance des données

## Structure du Projet

```
src/
├── components/
│   ├── ConfigurationForm.tsx  # Formulaire de configuration
│   └── ScheduleView.tsx        # Affichage du planning
├── hooks/
│   └── useLocalStorage.ts      # Hook pour localStorage
├── types.ts                    # Définitions TypeScript
├── tmcLogic.ts                 # Logique de génération des matches TMC
├── scheduler.ts                # Algorithme de planification
├── App.tsx                     # Composant principal
└── main.tsx                    # Point d'entrée
```

## Sauvegarde

L'application sauvegarde automatiquement :
- La configuration des tournois
- Le planning généré

Les données sont stockées dans le localStorage du navigateur et restaurées automatiquement au rechargement.

## Support

Pour toute question ou suggestion, n'hésitez pas à ouvrir une issue.

## Licence

MIT
