# CODEBASE.md — Carte d'architecture TMC Tournament Manager

> Fichier destiné à l'IA. Lire en premier avant toute intervention sur le code.
> **À maintenir à jour** à chaque changement de rôle d'un fichier ou création d'un nouveau fichier `src/`.

---

## Vue d'ensemble

Application React/TypeScript pour gérer des tournois de tennis TMC (Tournoi Multi-Chances). Cinq modules indépendants :

1. **TMC Planner** — configuration + génération automatique du planning multi-tournois
2. **Programmation Image** — import d'une feuille FFT/TEN'UP (PDF ou CSV) → export affiche JPEG
3. **Events** — CRUD backoffice d'événements du club (Supabase + Storage)
4. **Live Score** — saisie en temps réel du score d'un match (Supabase + Realtime pour PWA future)
5. **Actus** — CRUD backoffice des actualités du club (Markdown + multi-images, brouillon/publié)

Stack : React 19, TypeScript, Vite, Tailwind CSS, Supabase (auth + DB + Storage), localStorage (persistance TMC), react-markdown.

---

## Structure `src/`

### Logique métier (pas de dépendances React)

| Fichier | Rôle |
|---|---|
| `types.ts` | Tous les types TypeScript du projet (`GlobalConfig`, `TournamentConfig`, `Match` — inclut `bracket: MatchBracket`, `MatchBracket`, `ScheduledMatch`, `Schedule`, `TournamentEntry`, `DailyTimeSlot`, `TennisRanking`, `Gender`, `ClubEvent` — inclut `team_matches: TeamMatch[] \| null`, `EventType`, `TeamMatch`, `TeamMatchGender`, `TeamMatchType`, `LiveMatch`, `LiveMatchStatus`, `LiveMatchType`, `LiveSet3Format`, `LiveMatchWinner`, `Profile` (id/prenom/nom — gestionnaires de lives), `Actu` — inclut `image_captions` (légendes affichées en PWA), `ActuFocalPoint`) |
| `tmcLogic.ts` | Génère les matchs TMC pour 4, 8, 12, 16 ou 24 joueurs. Entrée : `TournamentConfig`. Sortie : `Match[]`. Pas d'effet de bord. |
| `scheduler.ts` | Algorithme de planification : génère les créneaux horaires (`generateTimeSlots`), distribue les matchs (`generateSchedule`) et tente de placer les matchs non planifiés après ajustement manuel (`retryUnscheduledMatches`). La contrainte 4h est trackée par `(tournoi, bracket)`. La stratégie de remplissage est contrôlée par `GlobalConfig.slotFillingStrategy` (`'smooth'` ou `'max'`). |
| `moveMatch.ts` | Déplacement manuel d'un ou plusieurs matchs avec cascade automatique des tours suivants si la contrainte 4h est violée. Le check feeder utilise le bracket du match (helper `findFeederMatches`). Importe `generateTimeSlots` depuis `scheduler.ts`. |
| `exportScheduleCsv.ts` | Export d'un `Schedule` au format CSV (séparateur `;`, UTF-8 BOM pour Excel). Tri par date / heure / terrain ; déclenche le téléchargement du fichier. Consommé par `TournamentPage`. |
| `liveScoreRules.ts` | Règles pures de score tennis — état d'un set normal (ongoing/tiebreak/won), super tiebreak, incrément/décrément +/- et détection du vainqueur de match. Pas d'effet de bord. Consommé par `LiveScoreEntry` et `LiveMatchPage`. **Existe en double dans `pwa/src/liveScoreRules.ts`** — à maintenir synchronisé. |

### Pages (React Router)

| Fichier | Route | Rôle |
|---|---|---|
| `pages/LoginPage.tsx` | `/login` | Auth Supabase |
| `pages/AppHomePage.tsx` | `/` | Dashboard — accès aux deux modules |
| `pages/HomePage.tsx` | `/tmc-planning` | Liste des configurations sauvegardées |
| `pages/TournamentPage.tsx` | `/tmc-planning/:id` | Écran principal TMC Planner (config + schedule) |
| `pages/ProgrammationImagePage.tsx` | `/programmation-image` | Import PDF/CSV → rendu affiche → export JPEG. Bouton « Basculer vers Live Score » : insère tous les matchs détectés dans `live_matches` (status `pending`, match_type `simple`) avec un événement optionnel. |
| `pages/EventsPage.tsx` | `/events` | Liste paginée des événements (toggle à venir / passés), actions modifier/dupliquer/supprimer |
| `components/EventForm.tsx` | `/events/new`, `/events/:id/edit` | Formulaire création/édition d'événement (markdown preview, upload image Supabase Storage) |
| `pages/LiveScorePage.tsx` | `/live-score` | Vue projetée sur TV en club (V1 TV Board). Header `← Accueil / Live Score` avec badge "N en cours" (rouge pulsant) si lives. 3 sections (En live / En attente / Terminés) en grid 2 colonnes ; header de section avec compteur coloré. Abonnement Supabase Realtime sur `live_matches`. Démarrer ouvre un dialog pour saisir le court. Batch-fetch des profils des gestionnaires actuels (`scored_by`) pour afficher leur nom dans le dialog *« Prendre le contrôle »* (warning quand l'opérateur clique sur le live d'un autre user). Container `max-w-[1400px]`. |
| `pages/LiveMatchPage.tsx` | `/live-score/:id` | Saisie du score d'un match avec `LiveScoreEntry`. Détection auto de fin de match. Bouton "Annuler la fin de match" si finished. Abonnement Realtime filtré sur l'ID du match : si `scored_by` change vers un autre user, bandeau d'alerte *« Vous êtes en lecture seule »* + `forceDisabled` passé au `LiveScoreEntry`. |
| `components/LiveMatchForm.tsx` | `/live-score/new` | Formulaire création d'un match (simple/double, joueurs, event lié optionnel parmi les events des 30 derniers jours). |
| `pages/ActusPage.tsx` | `/actus` | Liste des actus (brouillons + publiées) triées DESC, badges Brouillon/Publié, actions publier/dépublier/modifier/supprimer. |
| `components/ActuForm.tsx` | `/actus/new`, `/actus/:id/edit` | Formulaire création/édition d'actu (markdown preview, multi-images optionnelles avec sélection du point de focus par clic sur l'aperçu, deux boutons « Brouillon » / « Publier »). Au clic sur « Publier », une option « Publier aussi sur Facebook » (+ sous-option « Mode debug ») déclenche l'appel à l'Edge Function `post-to-facebook` ; le résultat (lien vers le post ou erreur) est affiché inline et la navigation vers `/actus` est suspendue jusqu'au retour. |
| `pages/InvitePage.tsx` | `/admin/invite` | Formulaire admin pour inviter un nouvel utilisateur au BO. Deux actions : « Envoyer l'invitation » (email via Supabase) ou « Générer un lien à copier (sans email) » — fallback utile en cas de rate limit SMTP ou pour partage manuel. Route protégée par le guard auth. |
| `pages/AcceptInvitePage.tsx` | `/accept-invite` | Page publique d'activation de compte. Supabase JS parse automatiquement le hash `#access_token=...&type=invite` (`detectSessionInUrl: true`). L'invité saisit son **prénom + nom** et son mot de passe ; à la validation, `supabase.auth.updateUser({ password })` puis `upsert` sur `profiles` (RLS `auth.uid() = id` autorise l'écriture de son propre profil), puis redirection vers `/`. |

### Composants

| Fichier | Utilisé dans | Rôle |
|---|---|---|
| `components/ConfigurationForm.tsx` | `TournamentPage` | Formulaire de configuration GlobalConfig |
| `components/ScheduleView.tsx` | `TournamentPage` | Affichage calendrier/tableau + drag-and-drop des matchs |
| `components/ConfigDropdown.tsx` | `TournamentPage` | Sélecteur de configurations prédéfinies |
| `components/EventCard.tsx` | `EventsPage` | Carte d'un événement dans la liste (badge type, dates, prix, actions) |
| `components/EventForm.tsx` | `EventsPage` / routes | Formulaire création/édition (voir ligne pages) |
| `components/LiveMatchCard.tsx` | `LiveScorePage` | Carte d'un match (V1 TV Board). Hero bar avec bloc court coloré contextuel (rouge LIVE / sombre Finished / ambre Pending), chips `type_tournoi` + Simple/Double, badge statut compact + menu kebab. Libellé du bouton primaire selon statut/ownership : Démarrer (pending) / Reprendre (live + own) / **Prendre le contrôle** (live + autre user, via prop `isOwnLive`) / Voir (finished) + Supprimer. Scoreboard ATP avec trophée vainqueur, classement (chip) et club par joueur, cellules de score 48×48 (set gagné fond sombre). Footer date + "Live · en cours" ou "Vainqueur : …". Badge "À supprimer" intégré au hero bar. |
| `components/LivePulse.tsx` | `LiveMatchCard`, `LiveScorePage` | Point rouge pulsant (animate-ping). Utilisé sur les indicateurs LIVE (badge header + statut carte). |
| `components/LiveScoreEntry.tsx` | `LiveMatchPage` | Interface +/- par joueur pour saisir le score (sets 1-3, tiebreak auto à 6/6, choix format set 3). Désactivé si `status != 'live'` ou si la prop `forceDisabled` est `true` (utilisée par `LiveMatchPage` lors d'une perte de contrôle live). |
| `components/MarkdownEditor.tsx` | `ActuForm`, `EventForm` | Éditeur Markdown contrôlé (`value` / `onChange`) avec onglets Écrire/Aperçu, toolbar (Gras, Italique, Souligné via `<u>`, H1/H2/H3) et raccourcis Ctrl/Cmd+B / +I. Aperçu : `react-markdown` + `remark-breaks` + `rehype-raw` (pour le souligné HTML inline). Embarque le helper `expandBlankLines`. |
| `components/TeamMatchImagePreview.tsx` | `EventForm` | Rendu DOM de l'affiche 1414×2000 pour les events `'Match par équipe'`. Cellules Bandeau auto-adaptatives. Monté hors viewport et exporté en JPEG via `html-to-image`. |
| `components/teamMatch/MatchSection.tsx` | `EventForm` | Conteneur de la liste de matchs (header N/8, bouton "+ Ajouter", max 8). Expose `makeTeamMatch()`. |
| `components/teamMatch/MatchRow.tsx` | `MatchSection` | Carte d'un match : champs gender/matchType/teamNumber/opponent/location/date/time, boutons ↑ ↓ ✕, badge "À compléter". |
| `components/teamMatch/Segmented.tsx` | `MatchRow` | Boutons groupés générique (Genre, Lieu). |
| `components/teamMatch/NumberPicker.tsx` | `MatchRow` | Sélecteur numéroté 1·2·3 (teamNumber). |

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
- Nombre de joueurs supportés : 4, 8, 16 (puissances de 2) + 12 et 24 (tableaux asymétriques)
- Capacité max affiche : 8 matchs par page A4

---

## Specs fonctionnelles

Voir `docs/specs/` :
- `SCHEDULING_RULES.md` — règles de l'algo de planification (contraintes R1–R5)
- `GEN_PROG.md` — spec du module Programmation Image
- `GEN_PROG_TO_LIVE_SCORE.md` — basculement des matchs détectés depuis l'affiche vers Live Score (création en bloc dans `live_matches`)
- `EVENTS.md` — spec du module Events (table Supabase `events`, bucket `event-images`, flux JSON)
- `LIVE_SCORE.md` — spec du module Live Score (table Supabase `live_matches`, règles de score, UI back-office, préparation Realtime)
- `ACTUS.md` — spec du module Actus (table Supabase `actus`, bucket `actu-images`, multi-images, brouillon/publié, lecture `anon` PWA)
- `ACTUS_FOCAL_POINT.md` — point de focus par image d'actu (colonne `image_focal_points`, overlay BO, helper CSS PWA `objectPosition`)
- `ACTUS_FACEBOOK.md` — publication simultanée d'une actu sur la page Facebook du club via Edge Function `post-to-facebook` (checkboxes dans `ActuForm`, secrets `FACEBOOK_PAGE_ID` / `FACEBOOK_PAGE_ACCESS_TOKEN`)
- `PWA_PULL_TO_REFRESH.md` — pull-to-refresh PWA sur Actus & Événements (`usePullToRefresh` + `PullToRefreshWrapper`)

## Edge Functions Supabase

| Fonction | Rôle |
|---|---|
| `supabase/functions/post-to-facebook/index.ts` | Publie une actu sur la page Facebook du club. Appelée depuis `ActuForm` quand la case « Publier aussi sur Facebook » est cochée. Utilise les secrets `FACEBOOK_PAGE_ID` et `FACEBOOK_PAGE_ACCESS_TOKEN`. |
| `supabase/functions/invite-user/index.ts` | Envoie une invitation par email à un nouvel utilisateur via `auth.admin.inviteUserByEmail`, ou — si `action: 'generate-link'` — retourne juste le lien d'invitation via `auth.admin.generateLink` sans envoyer d'email (fallback rate limit). Vérifie d'abord que l'appelant est authentifié (JWT). Le `redirectTo` est fourni par le client (`window.location.origin + '/accept-invite'`) — la whitelist Auth → URL Configuration côté dashboard Supabase fait foi pour la sécurité. Appelée depuis `InvitePage`. |

## Infrastructure Supabase

- Table `events` + bucket `event-images` : migration `supabase/migrations/20260418_events.sql` puis `supabase/migrations/20260515_event_team_matches.sql` (ajout colonne `team_matches JSONB`)
- Table `live_matches` (+ enums + trigger updated_at réutilisé + Realtime) : migration `supabase/migrations/20260423_live_matches.sql` puis `supabase/migrations/20260519_live_matches_court.sql` (ajout colonne `court TEXT` nullable — terrain saisi au démarrage du live)
- Table `profiles` (id/prenom/nom, FK `auth.users(id)`, RLS lecture libre `authenticated` + `anon`, écriture sur son propre profil, trigger `on_auth_user_created` qui crée un profil vide à chaque nouveau user) : migration `supabase/migrations/20260521_profiles.sql`. Utilisée pour afficher le nom du gestionnaire actuel dans le warning *« Prendre le contrôle »* (BO + PWA). Les profils existants sont à insérer manuellement après application de la migration. |
- Table `actus` (`image_urls TEXT[]`, `image_focal_points JSONB`, `image_captions TEXT[]`, `published`, `published_at`) + bucket `actu-images` + RLS `anon`/`authenticated` : migrations `supabase/migrations/20260426_actus.sql` puis `supabase/migrations/20260426_actus_image_urls.sql` (patch `image_url` → `image_urls`) puis `supabase/migrations/20260506_actus_focal_points.sql` (ajout `image_focal_points` parallèle à `image_urls`) puis `supabase/migrations/20260510_actus_image_captions.sql` (ajout `image_captions` — légendes Facebook par photo, BO-only)
- Policies RLS `anon` (lecture publique pour PWA) : à ajouter sur `events` et `live_matches` (voir `docs/specs/PWA.MD`). Déjà en place sur `actus`.

---

## PWA — `pwa/`

Projet Vite/React autonome dans le dossier `pwa/`. Consomme les tables Supabase en lecture via le rôle `anon` ; bascule sur le rôle `authenticated` pour la gestion des lives (création de match, démarrage/saisie/suppression). Auth via `supabase.auth.signInWithPassword` (mêmes comptes que le BO).

Stack : React 19, TypeScript, Vite, Tailwind CSS v4, `vite-plugin-pwa`, TanStack Query, React Router v7, Supabase JS.

Déploiement : projet Vercel séparé, Root Directory = `pwa/`.

> **Service Worker** — Le `runtimeCaching` de `VitePWA` (cf. `pwa/vite.config.ts`) ne couvre **que les assets Supabase Storage** (`/storage/v1/object/public/...`, buckets `actu-images` et `event-images`). L'API REST (`/rest/v1/...`), l'auth (`/auth/v1/...`) et Realtime ne sont **jamais** cachés par le SW — sinon les GET `live_matches` (et autres tables) seraient servis périmés après un PATCH, et la mise à jour live ne se verrait qu'au prochain event Realtime. Ne pas réintroduire de pattern large type `url.hostname.includes('supabase.co')`.

### Structure `pwa/src/`

| Fichier | Rôle |
|---|---|
| `App.tsx` | Routes + guard `RequireAuth` (redirige `/login` avec `state.from`) |
| `lib/supabase.ts` | Client Supabase avec `persistSession: true` + `autoRefreshToken: true` (durée du JWT à régler dans le dashboard Supabase) |
| `lib/pwa.ts` | Helper `isStandalone()` — détecte si l'app tourne en mode PWA installée (display-mode standalone ou iOS Safari `navigator.standalone`) |
| `hooks/useAuth.ts` | Hook React partagé : retourne `{ user, loading }`, écoute `onAuthStateChange` |
| `hooks/useInstallPrompt.ts` | Hook qui gère la bannière d'installation : capture `beforeinstallprompt` (Android), détecte iOS Safari, gère le dismiss 7 jours via `localStorage` (`cac:installPromptDismissedAt`). Retourne `{ variant, promptInstall, dismiss }`. |
| `hooks/usePullToRefresh.ts` | Hook générique tirer-pour-rafraîchir basé sur Pointer Events. S'active uniquement sur `pointerType === 'touch'` quand `containerRef.scrollTop === 0`. Retourne `{ pullProgress, isDragging }`. Seuil interne de 80 px ; déclenche `onRefresh` au release si seuil atteint. |
| `liveScoreRules.ts` | **Copie** de `src/liveScoreRules.ts` (BO). À synchroniser manuellement si les règles de score changent. |
| `types.ts` | Types partagés copiés depuis le BO + types `Actu` / `ActuFocalPoint` PWA |
| `utils/focalPoint.ts` | Helper `focalPointStyle(fp)` → renvoie `{ objectPosition: 'x% y%' }` (fallback `50% 50%` si null/undefined). Utilisé par `ActuCard` et `ActuDetailPage`. |
| `pages/LoginPage.tsx` | Formulaire email/mot de passe → redirige sur `state.from ?? /matches` |
| `pages/MatchesPage.tsx` | Liste des matchs (Realtime), bouton « Déconnexion », FAB « + » → `/matches/new` (visibles uniquement si auth). Batch-fetch des profils des gestionnaires (`scored_by`) après chargement des matchs, passé en prop `profilesMap` à chaque `MatchCard`. |
| `pages/NewMatchPage.tsx` | Formulaire création de match (iso BO), `status='pending'`, `scored_by=null` |
| `pages/LiveMatchPage.tsx` | Saisie du score (route `/matches/:id/score`). Garde l'accès initial : redirige avec flash si `pending` ou si live appartient à un autre user. Abonnement Realtime filtré sur l'ID du match : si `scored_by` change pendant que l'user est sur la page, bandeau *« lecture seule »* + `forceDisabled` passé au `LiveScoreEntry`. |
| `components/matches/MatchCard.tsx` | Carte avec actions conditionnelles : Démarrer / Reprendre+Libérer / **Prendre le contrôle** (live d'un autre user — ouvre une modale de warning avec le nom du gestionnaire actuel, lu dans `profilesMap`) / Voir+Supprimer (selon auth + ownership). |
| `components/matches/LiveScoreEntry.tsx` | Composant +/- (adapté du BO, layout mobile) |
| `components/install/InstallBanner.tsx` | Bannière fixe au-dessus de la `BottomNav` qui invite à installer la PWA. Variante Android (CTA `beforeinstallprompt`) + variante iOS (instructions Partager → Sur l'écran d'accueil). Pose la classe `has-install-banner` sur `<body>` pour ajuster `padding-bottom` de `.pwa-content`. |
| `components/layout/AppHeader.tsx` | Header fixe route-aware (56px). Mode `root` (tabs) : logo + titre. Mode `sub` : back button (libellé court sur iOS, icône seule sur Android via `navigator.userAgent`) + titre. Affiche optionnellement une action droite tirée de `HeaderActionContext`. |
| `components/layout/BottomNav.tsx` | Navigation fixe basse — 3 onglets (Actus / Événements / Matches). |
| `components/layout/PullToRefreshWrapper.tsx` | Wrapper scrollable (`h-full overflow-y-auto`) consommé par `ActusPage` et `EventsPage`. Indicateur SVG inline (couleur `text-primary`) qui se translate et tourne pendant le tirage, `animate-spin` pendant le rechargement, transition `transform 0.2s ease` lors du snap-back. `overscroll-behavior-y: contain` pour neutraliser le PTR natif iOS/Android. Repose sur `usePullToRefresh`. |
| `components/layout/headerConfig.ts` | Map des routes → `HeaderConfig` (`mode`, `title`, `backTo`, `backLabel`). Helper `resolveHeader(pathname)` consommé par `AppHeader`. Ajouter une route ici quand on en crée une. |
| `components/layout/HeaderActionContext.tsx` | Provider + hook `useHeaderAction(action)` pour qu'une page pose une action droite dans le header (text / icon / accent). `onClick` lu via ref → pas besoin de mémoïsation côté appelant. |

### Routes PWA

| Route | Auth | Rôle |
|---|---|---|
| `/login` | publique | Connexion |
| `/actus`, `/evenements`, `/matches`, et leurs détails | publiques | Lecture `anon` |
| `/matches/new` | requise | Création d'un match |
| `/matches/:id/score` | requise (et ownership pour `live`) | Saisie / consultation d'un live |

Spec fonctionnelle complète : `docs/specs/PWA.MD` et `docs/specs/PWA_LIVE_AUTH.md`.
