# CODEBASE.md — Carte d'architecture TMC Tournament Manager

> Fichier destiné à l'IA. Lire en premier avant toute intervention sur le code.
> **À maintenir à jour** à chaque changement de rôle d'un fichier ou création d'un nouveau fichier `src/`.

---

## Vue d'ensemble

Application React/TypeScript pour gérer des tournois de tennis TMC (Tournoi Multi-Chances). Quatre modules indépendants :

1. **TMC Planner** — configuration + génération automatique du planning multi-tournois
2. **Programmation Image** — import d'une feuille FFT/TEN'UP (PDF ou CSV) → export affiche JPEG
3. **Events** — CRUD backoffice d'événements du club (Supabase + Storage)
4. **Live Score** — saisie en temps réel du score d'un match (Supabase + Realtime pour PWA future)

Stack : React 19, TypeScript, Vite, Tailwind CSS, Supabase (auth + DB + Storage), localStorage (persistance TMC), react-markdown.

---

## Structure `src/`

### Logique métier (pas de dépendances React)

| Fichier | Rôle |
|---|---|
| `types.ts` | Tous les types TypeScript du projet (`GlobalConfig`, `TournamentConfig`, `Match`, `ScheduledMatch`, `Schedule`, `TournamentEntry`, `DailyTimeSlot`, `TennisRanking`, `Gender`, `ClubEvent`, `EventType`, `LiveMatch`, `LiveMatchStatus`, `LiveMatchType`, `LiveSet3Format`, `LiveMatchWinner`) |
| `tmcLogic.ts` | Génère les matchs TMC pour 4, 8 ou 16 joueurs. Entrée : `TournamentConfig`. Sortie : `Match[]`. Pas d'effet de bord. |
| `scheduler.ts` | Algorithme de planification : génère les créneaux horaires (`generateTimeSlots`) et distribue les matchs dessus (`generateSchedule`). Entrée : `GlobalConfig` + `Match[][]`. Sortie : `Schedule`. |
| `moveMatch.ts` | Déplacement manuel d'un ou plusieurs matchs avec cascade automatique des tours suivants si la contrainte 4h est violée. Importe `generateTimeSlots` depuis `scheduler.ts`. |
| `liveScoreRules.ts` | Règles pures de score tennis — état d'un set normal (ongoing/tiebreak/won), super tiebreak, incrément/décrément +/- et détection du vainqueur de match. Pas d'effet de bord. Consommé par `LiveScoreEntry` et `LiveMatchPage`. |

### Pages (React Router)

| Fichier | Route | Rôle |
|---|---|---|
| `pages/LoginPage.tsx` | `/login` | Auth Supabase |
| `pages/AppHomePage.tsx` | `/` | Dashboard — accès aux deux modules |
| `pages/HomePage.tsx` | `/tmc-planning` | Liste des configurations sauvegardées |
| `pages/TournamentPage.tsx` | `/tmc-planning/:id` | Écran principal TMC Planner (config + schedule) |
| `pages/ProgrammationImagePage.tsx` | `/programmation-image` | Import PDF/CSV → rendu affiche → export JPEG |
| `pages/EventsPage.tsx` | `/events` | Liste paginée des événements (toggle à venir / passés), actions modifier/dupliquer/supprimer |
| `components/EventForm.tsx` | `/events/new`, `/events/:id/edit` | Formulaire création/édition d'événement (markdown preview, upload image Supabase Storage) |
| `pages/LiveScorePage.tsx` | `/live-score` | Liste des matchs en 3 sections : En live / En attente / Terminés. Actions démarrer/reprendre/voir/supprimer. Badge "À supprimer" si finished + 2j. |
| `pages/LiveMatchPage.tsx` | `/live-score/:id` | Saisie du score d'un match avec `LiveScoreEntry`. Détection auto de fin de match. Bouton "Annuler la fin de match" si finished. |
| `components/LiveMatchForm.tsx` | `/live-score/new` | Formulaire création d'un match (simple/double, joueurs, event lié optionnel parmi les events des 30 derniers jours). |

### Composants

| Fichier | Utilisé dans | Rôle |
|---|---|---|
| `components/ConfigurationForm.tsx` | `TournamentPage` | Formulaire de configuration GlobalConfig |
| `components/ScheduleView.tsx` | `TournamentPage` | Affichage calendrier/tableau + drag-and-drop des matchs |
| `components/ConfigDropdown.tsx` | `TournamentPage` | Sélecteur de configurations prédéfinies |
| `components/EventCard.tsx` | `EventsPage` | Carte d'un événement dans la liste (badge type, dates, prix, actions) |
| `components/EventForm.tsx` | `EventsPage` / routes | Formulaire création/édition (voir ligne pages) |
| `components/LiveMatchCard.tsx` | `LiveScorePage` | Carte d'un match dans la liste (statut, joueurs, score résumé, badge "À supprimer", actions primaire/supprimer) |
| `components/LiveScoreEntry.tsx` | `LiveMatchPage` | Interface +/- par joueur pour saisir le score (sets 1-3, tiebreak auto à 6/6, choix format set 3). Désactivé si `status != 'live'`. |

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
- `EVENTS.md` — spec du module Events (table Supabase `events`, bucket `event-images`, flux JSON)
- `LIVE_SCORE.md` — spec du module Live Score (table Supabase `live_matches`, règles de score, UI back-office, préparation Realtime)

## Infrastructure Supabase

- Table `events` + bucket `event-images` : migration `supabase/migrations/20260418_events.sql`
- Table `live_matches` (+ enums + trigger updated_at réutilisé + Realtime) : migration `supabase/migrations/20260423_live_matches.sql`
