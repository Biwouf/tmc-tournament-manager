# CODEBASE.md — Carte d'architecture TMC Tournament Manager

> Fichier destiné à l'IA. Lire en premier avant toute intervention sur le code.
> **À maintenir à jour** à chaque changement de rôle d'un fichier ou création d'un nouveau fichier `src/`.

---

## Vue d'ensemble

Application React/TypeScript pour gérer des tournois de tennis TMC (Tournoi Multi-Chances). Deux modules indépendants :

1. **TMC Planner** — configuration + génération automatique du planning multi-tournois
2. **Programmation Image** — import d'une feuille FFT/TEN'UP (PDF ou CSV) → export affiche JPEG

Stack : React 19, TypeScript, Vite, Tailwind CSS, Supabase (auth), localStorage (persistance).

---

## Structure `src/`

### Logique métier (pas de dépendances React)

| Fichier | Rôle |
|---|---|
| `types.ts` | Tous les types TypeScript du projet (`GlobalConfig`, `TournamentConfig`, `Match`, `ScheduledMatch`, `Schedule`, `TournamentEntry`, `DailyTimeSlot`, `TennisRanking`, `Gender`) |
| `tmcLogic.ts` | Génère les matchs TMC pour 4, 8 ou 16 joueurs. Entrée : `TournamentConfig`. Sortie : `Match[]`. Pas d'effet de bord. |
| `scheduler.ts` | Algorithme de planification : génère les créneaux horaires (`generateTimeSlots`) et distribue les matchs dessus (`generateSchedule`). Entrée : `GlobalConfig` + `Match[][]`. Sortie : `Schedule`. |
| `moveMatch.ts` | Déplacement manuel d'un ou plusieurs matchs avec cascade automatique des tours suivants si la contrainte 4h est violée. Importe `generateTimeSlots` depuis `scheduler.ts`. |

### Pages (React Router)

| Fichier | Route | Rôle |
|---|---|---|
| `pages/LoginPage.tsx` | `/login` | Auth Supabase |
| `pages/AppHomePage.tsx` | `/` | Dashboard — accès aux deux modules |
| `pages/HomePage.tsx` | `/tmc-planning` | Liste des configurations sauvegardées |
| `pages/TournamentPage.tsx` | `/tmc-planning/:id` | Écran principal TMC Planner (config + schedule) |
| `pages/ProgrammationImagePage.tsx` | `/programmation-image` | Import PDF/CSV → rendu affiche → export JPEG |

### Composants

| Fichier | Utilisé dans | Rôle |
|---|---|---|
| `components/ConfigurationForm.tsx` | `TournamentPage` | Formulaire de configuration GlobalConfig |
| `components/ScheduleView.tsx` | `TournamentPage` | Affichage calendrier/tableau + drag-and-drop des matchs |
| `components/ConfigDropdown.tsx` | `TournamentPage` | Sélecteur de configurations prédéfinies |

### Infra

| Fichier | Rôle |
|---|---|
| `hooks/useLocalStorage.ts` | Hook générique `useLocalStorage<T>(key, defaultValue)` — persistance locale de `TournamentEntry[]` |
| `lib/supabase.ts` | Client Supabase (auth uniquement, pas de base de données utilisée) |
| `App.tsx` | Routeur React Router + guard d'authentification |
| `main.tsx` | Point d'entrée, monte `<BrowserRouter>` |

---

## Flux de données — TMC Planner

```
GlobalConfig (formulaire)
  → tmcLogic.generateTMCMatches() par TournamentConfig  →  Match[][]
  → scheduler.generateSchedule(config, matchesByTournament)  →  Schedule
  → ScheduleView (affichage)
  → moveMatch / moveMatches (drag-and-drop)  →  Schedule mis à jour
  → useLocalStorage (persistance)
```

## Flux de données — Programmation Image

```
PDF (pdfjs-dist) ou CSV (texte brut)
  → parsing dans ProgrammationImagePage
  → état local React (liste de matchs du jour)
  → rendu DOM → html-to-image → export JPEG
```

---

## Constantes importantes

- `MIN_HOURS_BETWEEN_MATCHES = 240 min` (4h) — délai obligatoire entre deux tours du même tournoi
- Nombre de joueurs supportés : 4, 8, 16 (puissances de 2) + 12 (tableau asymétrique, 4 joueurs exemptés du T1)
- Capacité max affiche : 8 matchs par page A4

---

## Specs fonctionnelles

Voir `docs/specs/` :
- `SCHEDULING_RULES.md` — règles de l'algo de planification (contraintes R1–R5)
- `GEN_PROG.md` — spec du module Programmation Image
