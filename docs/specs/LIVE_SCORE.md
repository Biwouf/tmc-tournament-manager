# Spec — Module Live Score

> Statut : prêt pour intégration  
> Dernière mise à jour : 2026-04-22

---

## Objectif

Permettre à un utilisateur authentifié de saisir en temps réel le score d'un match de tennis depuis le back-office. Les données sont stockées dans Supabase et structurées pour être exposées en temps réel à une future PWA.

---

## Scope de cette spec

- Interface back-office CRUD (liste de matchs + saisie de score)
- Stockage Supabase (table `live_matches`)
- Anticipation Supabase Realtime pour la future PWA

Hors scope (v2) :
- La PWA publique de consommation

---

## Intégration dans l'app

- Nouvelle carte sur `AppHomePage` → label **"Live Score"**, description **"Suivre et saisir le score des matchs en direct."**
- Route principale : `/live-score`
- Route saisie : `/live-score/:id`
- Pages : `src/pages/LiveScorePage.tsx` + `src/pages/LiveMatchPage.tsx`
- Composants : `src/components/LiveMatchForm.tsx`, `src/components/LiveMatchCard.tsx`, `src/components/LiveScoreEntry.tsx`

---

## Modèle de données

### Type TypeScript

```ts
export type LiveMatchStatus = 'pending' | 'live' | 'finished';
export type LiveMatchType = 'simple' | 'double';
export type LiveSet3Format = 'normal' | 'super_tiebreak';
export type LiveMatchWinner = 'j1' | 'j2';

export interface LiveMatch {
  id: string;                      // UUID Supabase
  match_date: string;              // "YYYY-MM-DD"
  start_time: string | null;       // "HH:MM"
  match_type: LiveMatchType;

  // Joueur / équipe 1
  j1_prenom: string;
  j1_nom: string;
  j1_classement: string;           // Classement FFT, ex: "15/4", "30", "NC"
  j1_club: string;                 // Peut être vide ""

  // Joueur / équipe 2
  j2_prenom: string;
  j2_nom: string;
  j2_classement: string;
  j2_club: string;

  // Partenaire équipe 1 (doubles uniquement, null en simple)
  j3_prenom: string | null;
  j3_nom: string | null;
  j3_classement: string | null;
  j3_club: string | null;

  // Partenaire équipe 2 (doubles uniquement, null en simple)
  j4_prenom: string | null;
  j4_nom: string | null;
  j4_classement: string | null;
  j4_club: string | null;

  event_id: string | null;         // FK → events.id (nullable)

  court: string | null;            // Terrain — saisi au démarrage du live (optionnel)

  scored_by: string | null;        // auth.users.id — renseigné au démarrage du live

  status: LiveMatchStatus;

  // Set 1
  set1_j1: number | null;
  set1_j2: number | null;
  set1_tb_j1: number | null;       // Score tiebreak si le set s'est terminé 7/6
  set1_tb_j2: number | null;

  // Set 2
  set2_j1: number | null;
  set2_j2: number | null;
  set2_tb_j1: number | null;
  set2_tb_j2: number | null;

  // Set 3 (optionnel)
  set3_format: LiveSet3Format | null;   // Choix de l'opérateur au démarrage du 3e set
  set3_j1: number | null;              // Jeux (si normal) OU score super tiebreak (si super_tiebreak)
  set3_j2: number | null;
  set3_tb_j1: number | null;           // Score tiebreak uniquement si set3_format='normal' et 6/6
  set3_tb_j2: number | null;

  winner: LiveMatchWinner | null;
  retired_player: LiveMatchWinner | null; // 'j1' | 'j2' si le match s'est terminé par un abandon — sinon null

  started_at: string | null;           // ISO 8601 — renseigné au passage en `live` (sert au tri "En live" — plus récent d'abord)
  finished_at: string | null;          // ISO 8601 — renseigné à la fin du match (pour la règle des 2 jours)
  created_at: string;
  updated_at: string;
}
```

### Notes sur le modèle

- En **double**, j1+j3 forment l'équipe 1 et j2+j4 forment l'équipe 2. Le score (set1_j1, set1_j2…) s'applique aux équipes, pas aux joueurs individuels.
- **set3_format = 'super_tiebreak'** : `set3_j1` / `set3_j2` stockent directement le score du super tiebreak (premier à 10, 2 points d'écart). Les colonnes `set3_tb_*` ne sont pas utilisées dans ce cas.
- **set3_format = 'normal'** : `set3_j1` / `set3_j2` sont des jeux (comme les sets 1 et 2). `set3_tb_j1` / `set3_tb_j2` ne sont renseignés qu'en cas de tiebreak (6/6).
- `j1_club`, `j2_club` (et les doublistes) peuvent être vides (`""`). Rien n'est affiché dans ce cas.
- `court` est `null` tant que le live n'a pas démarré. Il est saisi via un dialog au clic sur « Démarrer le live » (champ optionnel) et affiché sur les cartes BO et PWA.
- `started_at` est `null` tant que le live n'a pas démarré. Renseigné côté client (`new Date().toISOString()`) dans le même `update()` que le passage en `status='live'`, par les producteurs BO (`LiveScorePage.confirmStart`) et PWA (`MatchCard.handleStart`). Ne PAS le re-écrire au « Annuler la fin de match » — l'horodatage du démarrage initial doit être préservé.

### Migrations complémentaires

- `supabase/migrations/20260519_live_matches_court.sql` — ajoute la colonne `court TEXT` (nullable, sans défaut).
- `supabase/migrations/20260523_live_matches_started_at.sql` — ajoute la colonne `started_at TIMESTAMPTZ` (nullable, sans défaut).
- `supabase/migrations/20260523_live_matches_retired_player.sql` — ajoute la colonne `retired_player live_match_winner` (nullable). Renseignée lors d'un abandon ; le vainqueur (`winner`) reste défini comme pour une fin de match normale.

---

## Infrastructure Supabase

### Migration SQL

```sql
-- Types ENUM
CREATE TYPE live_match_status  AS ENUM ('pending', 'live', 'finished');
CREATE TYPE live_match_type    AS ENUM ('simple', 'double');
CREATE TYPE live_set3_format   AS ENUM ('normal', 'super_tiebreak');
CREATE TYPE live_match_winner  AS ENUM ('j1', 'j2');

CREATE TABLE live_matches (
  id             UUID          DEFAULT gen_random_uuid() PRIMARY KEY,
  match_date     DATE          NOT NULL,
  start_time     TIME,
  match_type     live_match_type NOT NULL DEFAULT 'simple',

  -- Équipe 1
  j1_prenom      TEXT          NOT NULL,
  j1_nom         TEXT          NOT NULL,
  j1_classement  TEXT          NOT NULL DEFAULT '',
  j1_club        TEXT          NOT NULL DEFAULT '',

  -- Équipe 2
  j2_prenom      TEXT          NOT NULL,
  j2_nom         TEXT          NOT NULL,
  j2_classement  TEXT          NOT NULL DEFAULT '',
  j2_club        TEXT          NOT NULL DEFAULT '',

  -- Doubliste équipe 1
  j3_prenom      TEXT,
  j3_nom         TEXT,
  j3_classement  TEXT,
  j3_club        TEXT,

  -- Doubliste équipe 2
  j4_prenom      TEXT,
  j4_nom         TEXT,
  j4_classement  TEXT,
  j4_club        TEXT,

  event_id       UUID          REFERENCES events(id) ON DELETE SET NULL,
  scored_by      UUID          REFERENCES auth.users(id) ON DELETE SET NULL,

  status         live_match_status NOT NULL DEFAULT 'pending',

  -- Set 1
  set1_j1        SMALLINT      CHECK (set1_j1 >= 0),
  set1_j2        SMALLINT      CHECK (set1_j2 >= 0),
  set1_tb_j1     SMALLINT      CHECK (set1_tb_j1 >= 0),
  set1_tb_j2     SMALLINT      CHECK (set1_tb_j2 >= 0),

  -- Set 2
  set2_j1        SMALLINT      CHECK (set2_j1 >= 0),
  set2_j2        SMALLINT      CHECK (set2_j2 >= 0),
  set2_tb_j1     SMALLINT      CHECK (set2_tb_j1 >= 0),
  set2_tb_j2     SMALLINT      CHECK (set2_tb_j2 >= 0),

  -- Set 3
  set3_format    live_set3_format,
  set3_j1        SMALLINT      CHECK (set3_j1 >= 0),
  set3_j2        SMALLINT      CHECK (set3_j2 >= 0),
  set3_tb_j1     SMALLINT      CHECK (set3_tb_j1 >= 0),
  set3_tb_j2     SMALLINT      CHECK (set3_tb_j2 >= 0),

  winner         live_match_winner,
  finished_at    TIMESTAMPTZ,

  created_at     TIMESTAMPTZ   DEFAULT now() NOT NULL,
  updated_at     TIMESTAMPTZ   DEFAULT now() NOT NULL
);

-- Trigger updated_at (réutilise la fonction set_updated_at() déjà créée par la migration Events)
CREATE TRIGGER live_matches_updated_at
  BEFORE UPDATE ON live_matches
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- RLS
ALTER TABLE live_matches ENABLE ROW LEVEL SECURITY;

CREATE POLICY "live_matches_select" ON live_matches FOR SELECT TO authenticated USING (true);
CREATE POLICY "live_matches_insert" ON live_matches FOR INSERT TO authenticated WITH CHECK (true);
CREATE POLICY "live_matches_update" ON live_matches FOR UPDATE TO authenticated USING (true);
CREATE POLICY "live_matches_delete" ON live_matches FOR DELETE TO authenticated USING (true);
```

### Supabase Realtime

Activer Realtime sur la table `live_matches` depuis le dashboard Supabase (Table Editor → `live_matches` → Enable Realtime).

Cela permet aux consommateurs futurs (PWA) de s'abonner aux changements via :

```ts
supabase
  .channel('live_matches')
  .on('postgres_changes', { event: '*', schema: 'public', table: 'live_matches' }, (payload) => {
    // Mise à jour en temps réel
  })
  .subscribe();
```

`LiveScorePage` (back-office) s'abonne au canal `live_matches_bo` et re-fetch la liste à chaque événement — la page se met à jour sans refresh. Les mises à jour passent toujours par `supabase.from('live_matches').update(...)` pour que Realtime fonctionne côté BO et PWA.

---

## Interface back-office

### Page liste — `LiveScorePage.tsx` (`/live-score`)

Vue conçue pour projection sur TV en club (V1 « TV Board »). Header `← Accueil / Live Score` avec, si des lives sont en cours, un badge rouge pulsant **« N en cours »**. Boutons header à droite : **« + Créer un match »** (CTA primaire) et **« Se déconnecter »** (secondaire). Container `max-w-[1400px] mx-auto px-8 py-8`.

**Affichage :**
- Trois sections empilées : **En live** (status=`live`), **En attente** (status=`pending`), **Terminés** (status=`finished`)
- Header de section : titre uppercase + badge compteur coloré (rouge / slate / emerald) + ligne de séparation
- Grid `grid-cols-1 lg:grid-cols-2 gap-4` (2 colonnes max — cartes plus larges, score plus gros pour la TV)
- Les matchs terminés depuis plus de 2 jours (`finished_at + 2j < now()`) affichent un badge **« À supprimer »** rouge dans le hero bar de la carte
- **En attente** et **Terminés** : triés par `match_date` + `start_time` ASC (ordre par défaut de la requête Supabase)
- **En live** : tri client par `started_at` DESC (le plus récemment démarré en premier), fallback `created_at` DESC quand `started_at` est null. Tri côté client volontaire : à chaque UPDATE de score, le trigger `updated_at` réordonne la ligne dans le heap Postgres ; un tri DB par démarrage stable garde l'ordre figé. Logique répliquée à l'identique dans `pwa/src/pages/MatchesPage.tsx`.

**Anatomie carte (`LiveMatchCard.tsx`) :**
- **Hero bar** : bloc *Court* à gauche (background contextuel — rouge LIVE / sombre Finished / ambre Pending, label `Court` + valeur ou `— non assigné —`). À droite : chip `type_tournoi` (sombre), chip Simple/Double (slate clair), indicateur statut compact (point coloré + label, ou `LivePulse` + « en direct » pour LIVE), puis menu kebab (•••).
- **Scoreboard** : 2 lignes joueurs séparées par un divider. Pour chaque joueur : icône trophée si vainqueur, nom (bold si vainqueur, semibold sinon), classement en chip slate et club en texte muté · cellules de score 48×48 (set gagné en fond sombre, perdu en slate clair, tiebreak en exposant absolu).
- **Footer** : date + heure (tabular-nums) à gauche · à droite « Live · en cours » (rouge) si LIVE, « Vainqueur : Prénom NOM » (emerald) si finished.

**Menu kebab (•••)** — popover ancré à droite, fermeture au clic extérieur. Items :
- **Bouton primaire** selon statut : « Démarrer » (pending) / « Reprendre » (live) / « Voir » (finished)
  - « Démarrer » ouvre le dialog *« Démarrer le live »* (champ texte *Court (optionnel)*) ; à la confirmation : status `live`, `scored_by = auth.uid()`, `court` enregistré, redirection vers `/live-score/:id`
  - « Reprendre » / « Voir » → redirection directe vers `/live-score/:id`
- **Supprimer** (rouge) → `window.confirm` → suppression définitive. La confirmation et l'appel Supabase vivent dans `LiveScorePage.tsx` ; la carte appelle juste la prop `onDelete()`.

Le composant `LivePulse` (`src/components/LivePulse.tsx`) factorise le point rouge pulsant — utilisé dans le badge header et l'indicateur LIVE des cartes.

---

### Formulaire de création — `LiveMatchForm.tsx`

Crée un match avec status=`pending`.

**Champs :**

| Champ | Composant | Obligatoire | Notes |
|---|---|---|---|
| Type de match | `<select>` | Oui | "Simple" / "Double" |
| Date | `<input type="date">` | Oui | |
| Heure de début | `<input type="time">` | Non | |
| Événement lié | `<select>` | Non | Charge les events depuis la table `events`. Affiche titre + date. Option vide par défaut. |
| J1 Prénom | `<input type="text">` | Oui | |
| J1 Nom | `<input type="text">` | Oui | |
| J1 Classement | `<input type="text">` | Non | Ex: "15/4", "30", "NC" |
| J1 Club | `<input type="text">` | Non | |
| J2 Prénom / Nom / Classement / Club | idem | Oui (prénom+nom) | |
| J3 Prénom / Nom / Classement / Club | idem | Si double | Affiché uniquement si match_type=`double` |
| J4 Prénom / Nom / Classement / Club | idem | Si double | Affiché uniquement si match_type=`double` |

**Validation côté client :**
- Prénom + Nom obligatoires pour J1 et J2
- Si double : J3 et J4 doivent avoir prénom + nom renseignés

---

### Page de saisie de score — `LiveMatchPage.tsx` (`/live-score/:id`)

Accessible si `status = 'live'` (écriture) ou `status = 'finished'` (lecture seule).

**En-tête :** résumé du match (joueurs, event, date/heure, statut).

**Composant `LiveScoreEntry`** (affiché uniquement si `status = 'live'`) :

La saisie de score utilise des **boutons +/- par joueur** (ergonomie tactile, anticipation PWA) :

```
        J1 (ou Équipe 1)       J2 (ou Équipe 2)
Set 1 :  [−] [3] [+]           [−] [2] [+]
Set 2 :  [−] [0] [+]           [−] [0] [+]
```

- Le set 3 n'apparaît qu'une fois que le set 2 est terminé et que chaque joueur a gagné 1 set.
- Au démarrage du 3e set : l'opérateur choisit le format via un bouton radio visible : **"Set normal"** / **"Super tiebreak"**. Ce choix est enregistré immédiatement dans `set3_format`.
- Le tiebreak (score interne) apparaît automatiquement quand le score d'un set normal atteint 6/6. En super tiebreak, les boutons +/- remplacent directement le score du set (pas de notion de jeux).

**Sauvegarde :** chaque action +/- déclenche un `update` Supabase immédiat. Pas de bouton "Enregistrer".

**Détection automatique de fin de match :**
- Après chaque mise à jour, l'application vérifie si les conditions de victoire sont atteintes (cf. règles ci-dessous).
- Si oui : status passe à `finished`, `winner` et `finished_at` sont renseignés. Un message de confirmation s'affiche à l'écran.

**Bouton "Annuler la fin de match"** (visible uniquement si `status = 'finished'`) :
- Remet le match en `status = 'live'`, vide `winner`, `finished_at` et `retired_player`.
- Permet à l'opérateur de corriger une erreur de saisie (y compris un abandon mal déclaré).

**Abandon d'un joueur** (visible uniquement si `status = 'live'` et que l'opérateur est bien le gestionnaire courant) :
- Sous le `LiveScoreEntry`, un bouton secondaire ambre **« Abandon d'un joueur »** ouvre un panneau inline (état local `showRetireConfirm`) : *« Quel joueur abandonne ? »* + deux boutons nommés (via `getTeamLabel`) + un bouton « Annuler ».
- Au clic sur un joueur, le match passe en `status = 'finished'` avec `winner` = adversaire, `retired_player` = joueur ayant abandonné, `finished_at` = maintenant. Le score est figé à l'état courant — aucun set/point n'est modifié.
- Les cartes (BO `LiveMatchCard`, PWA `MatchCard`) affichent un badge **« Abandon »** (fond `amber-100` / texte `amber-800`) sur les matchs terminés par abandon, à côté du libellé vainqueur.

---

## Règles de score

### Sets 1 et 2

- Premier à 6 jeux avec 2 jeux d'écart.
- À 5/5 : on continue. Un joueur peut gagner 7/5 (pas de 6/5).
- À 6/6 : tiebreak.

### Tiebreak (en cas de 6/6 dans un set normal)

- Premier à 7 points avec 2 points d'écart.
- Peut aller jusqu'à 8/6, 9/7, 10/8…
- Le score du set s'affiche **7/6**. Le score interne du tiebreak est stocké dans `setX_tb_j1` / `setX_tb_j2`.

### Set 3 — format normal

Mêmes règles que les sets 1 et 2.

### Set 3 — super tiebreak

- Premier à 10 points avec 2 points d'écart.
- Peut aller jusqu'à 11/9, 12/10…
- Stocké dans `set3_j1` / `set3_j2` (pas de colonnes `set3_tb_*` utilisées).

### Conditions de victoire

| Situation | Gagnant |
|---|---|
| J1 gagne set 1 ET set 2 | J1 |
| J2 gagne set 1 ET set 2 | J2 |
| J1 gagne set 1, J2 gagne set 2, J1 gagne set 3 | J1 |
| J1 gagne set 1, J2 gagne set 2, J2 gagne set 3 | J2 |

### Validation des boutons

Les boutons **+** sont désactivés dès qu'une limite est atteinte :
- Set normal : impossible de dépasser le score valide pour le joueur qui mène (ex: si J1 = 6 et J2 < 5, bloquer J1 à 6).
- Tiebreak / super tiebreak : le bouton **+** du joueur en retard est désactivé si l'autre a gagné avec 2 points d'écart.

---

## Gestion de la durée de vie des matchs

- À la fin d'un match (`status = 'finished'`), `finished_at` est renseigné automatiquement.
- Les matchs dont `finished_at + 2 jours < now()` sont signalés dans la liste avec un badge **"À supprimer"**.
- La suppression est **manuelle** : l'utilisateur clique "Supprimer" sur chaque match concerné.
- Pas de suppression automatique en v1.

---

## Arborescence de fichiers à créer

```
src/
  pages/
    LiveScorePage.tsx     # Liste des matchs (pending / live / finished)
    LiveMatchPage.tsx     # Détail + saisie de score
  components/
    LiveMatchForm.tsx     # Formulaire de création d'un match
    LiveMatchCard.tsx     # Carte d'un match dans la liste
    LiveScoreEntry.tsx    # Interface de saisie de score (boutons +/-)
  types.ts               # Ajouter LiveMatch, LiveMatchStatus, LiveMatchType, LiveSet3Format, LiveMatchWinner
```

## Routes à ajouter dans `App.tsx`

```tsx
<Route path="/live-score"     element={auth(<LiveScorePage />)} />
<Route path="/live-score/:id" element={auth(<LiveMatchPage />)} />
```

---

## Notes d'implémentation

- Utiliser le client Supabase existant (`src/lib/supabase.ts`).
- Pas de state management global — state local React dans chaque page.
- Charger la liste des événements depuis la table `events` pour le select du formulaire (même client Supabase).
- La fonction `set_updated_at()` est déjà créée (migration Events) — ne pas la recréer, juste créer le trigger sur `live_matches`.
- Avant de commencer : créer la table `live_matches` en exécutant la migration SQL ci-dessus dans le dashboard Supabase, puis activer Realtime sur cette table.

---

---

## Interface PWA

> Consommé par `pwa/src/pages/MatchesPage.tsx` et `pwa/src/components/matches/MatchCard.tsx`.

### Policy RLS à ajouter

```sql
CREATE POLICY "live_matches_anon_select"
  ON live_matches FOR SELECT TO anon USING (true);
```

### Supabase Realtime

Activer depuis le dashboard : Table Editor → `live_matches` → Enable Realtime.

```ts
const channel = supabase
  .channel('live_matches_pwa')
  .on('postgres_changes', { event: '*', schema: 'public', table: 'live_matches' }, () => {
    queryClient.invalidateQueries({ queryKey: ['matches'] });
  })
  .subscribe();
```

### Requête Supabase

```ts
const today = new Date().toISOString().split('T')[0];
const { data } = await supabase
  .from('live_matches')
  .select('*')
  .gte('match_date', today)
  .order('match_date', { ascending: true })
  .order('start_time', { ascending: true });
// Filtrer côté client : exclure les finished dont match_date < today
```

### Affichage par statut (`MatchCard.tsx`)

- `live` → badge "LIVE" animé (pulse rouge), score set par set, carte mise en évidence (bordure rouge)
- `pending` → heure prévue, joueurs, "Commence à HH:MM"
- `finished` → score final, badge "Terminé"
- Double : "Équipe 1 : Prenom Nom / Prenom Nom" vs "Équipe 2 : ..."

Les matchs `finished` du jour restent affichés jusqu'à minuit (retirés à `match_date < today`).

---

## Prise de contrôle forcée (BO + PWA)

Un live est rattaché à un gestionnaire via `scored_by`. Un autre utilisateur authentifié peut **prendre le contrôle** après confirmation — pas besoin que le premier libère.

### Table `profiles`

Migration `supabase/migrations/20260521_profiles.sql` :

```sql
CREATE TABLE profiles (
  id     UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  prenom TEXT NOT NULL DEFAULT '',
  nom    TEXT NOT NULL DEFAULT ''
);
```

RLS : lecture libre `authenticated` + `anon` (noms affichés dans les warnings BO et PWA), écriture uniquement sur son propre profil. Trigger `on_auth_user_created` qui crée un profil vide à chaque nouvel `auth.users`. Les profils des users existants sont à insérer manuellement après application de la migration. Fallback : si le profil est vide ou absent, on affiche *« un autre utilisateur »*.

**Renseignement du profil à l'activation du compte** — `AcceptInvitePage` (BO, route `/accept-invite`) demande désormais à l'invité **prénom + nom** en plus du mot de passe ; à la validation, `upsert` sur `profiles` avec l'`id` de l'user courant. Le profil vide créé par le trigger à l'invitation est donc renseigné dès l'activation, sans intervention admin.

### BO

- **`LiveScorePage`** charge le user courant + batch-fetch des profils (`scored_by` distincts non-null) et les passe au menu kebab des cartes (`isOwnLive`). Au clic sur *Reprendre* d'un live qui ne nous appartient pas, un dialog *« Prendre le contrôle du live ? »* affiche le nom du gestionnaire actuel ; à la confirmation, `scored_by` est mis à `auth.uid()` puis redirection vers `/live-score/:id`.
- **`LiveScoreEntry`** accepte une prop `forceDisabled?: boolean` qui s'ajoute au `readonly` interne (basé sur `status !== 'live'`).
- **`LiveMatchPage`** s'abonne au Realtime (filtre `id=eq.${id}`). Si `scored_by` change vers un autre user, bandeau d'alerte *« Ce live a été repris par quelqu'un d'autre. Vous êtes en lecture seule. »* + `forceDisabled` passé au `LiveScoreEntry`.

### PWA

- **`MatchesPage`** batch-fetch les profils après le chargement TanStack Query des matchs, passe `profilesMap` à chaque `MatchCard`.
- **`MatchCard`** : nouvelle branche d'actions `isLive && isAuth && !isOwner` → bouton *« Prendre le contrôle »* (rouge clair) qui ouvre une modale de confirmation avec le nom du gestionnaire actuel ; `handleTakeover` met `scored_by = userId` et redirige vers `/matches/:id/score`.
- **`LiveScoreEntry`** accepte `forceDisabled?: boolean`.
- **`LiveMatchPage`** : guard initial **inchangé** (redirige avec flash si live appartient à un autre user lors d'un accès direct par URL). Nouveau : abonnement Realtime filtré sur l'ID du match → bandeau *« lecture seule »* + `forceDisabled` si `scored_by` change pendant qu'on est sur la page.

---

## Évolutions v2

- Auth admin dans la PWA pour la saisie du score directement depuis l'app publique.
