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
  first_server: LiveMatchWinner | null;   // Côté au service au 1er jeu — null = « Je ne sais pas »

  started_at: string | null;           // ISO 8601 — renseigné au passage en `live` (sert au tri "En live" — plus récent d'abord)
  finished_at: string | null;          // ISO 8601 — renseigné à la fin du match (pour la règle des 2 jours)
  set1_ended_at: string | null;        // ISO 8601 — fin du set 1, posée par le serveur (durée des sets, PWA)
  set2_ended_at: string | null;        // ISO 8601 — fin du set 2, posée par le serveur
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
- `supabase/migrations/2026052301_live_matches_started_at.sql` — ajoute la colonne `started_at TIMESTAMPTZ` (nullable, sans défaut).
- `supabase/migrations/2026101301_live_set_times.sql` — ajoute `set1_ended_at` / `set2_ended_at` (cf. « Durée du match et des sets »).
- `supabase/migrations/2026052302_live_matches_retired_player.sql` — ajoute la colonne `retired_player live_match_winner` (nullable). Renseignée lors d'un abandon ; le vainqueur (`winner`) reste défini comme pour une fin de match normale.
- `supabase/migrations/2026102202_live_matches_first_server.sql` — ajoute la colonne `first_server live_match_winner` (nullable). Cf. « Indicateur de service ».

### Indicateur de service

- Seul le **premier serveur** est stocké (`first_server`) ; le côté au service est **déduit du score** par `getServer(match)` (`liveScoreRules.ts`, BO + PWA). Une correction de score (−, annulation) recale donc l'indicateur sans écriture supplémentaire.
- Règles : le service change à chaque jeu ; un tie-break compte pour un jeu (celui qui l'a commencé reçoit au 1er jeu du set suivant) ; dans un tie-break ou un super tie-break, le serveur sert le 1er point puis le service change tous les 2 points (`tb_j1 + tb_j2`, ou `set3_j1 + set3_j2` en super tie-break).
- En double, l'indicateur désigne l'**équipe** (l'ordre de service des joueurs n'est pas suivi).
- `first_server = null` (inconnu) ou match non `live` → aucun indicateur.
- **Saisie « qui sert maintenant »** : l'utilisateur désigne le côté au service **au score affiché** ; `firstServerFor(match, côté)` (`liveScoreRules.ts`) en déduit le `first_server` à enregistrer (celui pour lequel `getServer` donne ce côté). Permet de renseigner le service quand on arrive en cours de match, sans connaître le 1er serveur. Le score doit donc être saisi **avant** le service : un score corrigé ensuite recale l'indicateur à partir du `first_server` déduit.
- **Au démarrage** : BO, select *Qui sert ?* du dialog *Démarrer le live* (joueurs + *Déjà commencé — à indiquer plus tard*) ; PWA, trois boutons joueur 1 / joueur 2 / *Déjà commencé* qui remplacent « Démarrer le live ». *Déjà commencé* démarre avec `first_server = null` et ouvre directement la feuille *Ajuster le score* (PWA).
- **Pendant le live** : select *Qui sert ?* sous la saisie BO (option *Inconnu* = `null`) ; sélecteur *Qui sert maintenant ?* **sous** la saisie de la feuille *Ajuster le score* PWA, avec *Effacer* (`null`) ; choisir un côté enregistre puis ferme la feuille (retour au tableau). Tant que `first_server` est `null`, le tableau PWA propose *Indiquer qui sert →* à tout moment du match. Les lives de rencontre, démarrés par `team_match_command('start_live')`, partent à `null`.
- Non modifiable sur un match terminé : pour un live de rencontre, toute écriture d'un match terminé re-déclenche la validation du résultat (`guard_team_live`).
- **Affichage** : balle de tennis (`TennisBall`, SVG copié BO/PWA) après le nom du côté au service — tableau du live immersif PWA (`LiveScoreboard`), cartes PWA (`MatchCard`), cartes TV BO (`LiveMatchCard`, à la place du trophée).

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

> ⚠️ **Historique** — remplacé le 18/10/2026 par le Broadcast publié en base (cf. « Temps réel par
> Broadcast » en fin de document). `live_matches` n'est plus dans la publication `supabase_realtime`.

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
- **En attente** : triés par `match_date` + `start_time` ASC (ordre par défaut de la requête Supabase)
- **Terminés** : tri client antéchronologique par `finished_at` DESC (le plus récent en premier) ; les matchs sans `finished_at` passent après, triés par `match_date` + `start_time` DESC. Logique répliquée à l'identique dans `pwa/src/pages/MatchesPage.tsx`.
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
  - PWA (page live) : quand le bouton « + jeu / + point » du tableau de score conclut le 2e set sur un set partout et qu'aucun format n'est encore choisi, une feuille dédiée « Format du set décisif » (deux boutons, rien d'autre) s'ouvre automatiquement. Le lien « Choisir le format du set décisif → » ouvre la même feuille si l'opérateur l'a fermée (match par équipes historique sans règle : il ouvre « Ajuster le score », qui renvoie vers la rencontre).
- Le tiebreak (score interne) apparaît automatiquement quand le score d'un set normal atteint 6/6. En super tiebreak, les boutons +/- remplacent directement le score du set (pas de notion de jeux).

**Sauvegarde :** chaque action +/- déclenche un `update` Supabase immédiat. Pas de bouton "Enregistrer".

**Détection automatique de fin de match :**
- Après chaque mise à jour, l'application vérifie si les conditions de victoire sont atteintes (cf. règles ci-dessous).
- Si oui : status passe à `finished`, `winner` et `finished_at` sont renseignés. Un message de confirmation s'affiche à l'écran.

**Bouton "Annuler la fin de match"** (visible uniquement si `status = 'finished'`) :
- Remet le match en `status = 'live'`, vide `winner`, `finished_at` et `retired_player`.
- Permet à l'opérateur de corriger une erreur de saisie (y compris un abandon mal déclaré).

**Bouton "Terminer le match"** (visible si `status = 'live'`, sans `retired_player`, et que le score désigne déjà un vainqueur) :
- Cas d'un match rouvert sans changer le score (ex. 8/10 au super tie-break) : les « + » sont désactivés et aucun point ne peut plus déclencher la détection automatique — le match restait bloqué en `live` (incident prod du 14/10/2026).
- Le bouton réécrit le score inchangé en passant par la même détection : `status = 'finished'`, `winner` et `finished_at` renseignés. BO : bandeau vert au-dessus du `LiveScoreEntry` ; PWA : sous le tableau de score et dans la feuille « Ajuster le score » (`canFinish` dans `pwa/src/lib/liveScoreActions.ts`).

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
- Les matchs terminés depuis plus de 3 jours (`finished_at`) sont masqués des listes BO et PWA (cf. « Visibilité à trois jours »).
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

> ⚠️ **Historique** — remplacé par le Broadcast publié en base (cf. « Temps réel par Broadcast »).

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

Les matchs `finished` restent affichés trois jours après `finished_at`, du plus récent au plus ancien (cf. « Visibilité à trois jours »).

### Dialog de saisie du court au démarrage (PWA — `MatchCard.tsx`)

Au clic sur « Démarrer le live », un dialog de saisie du court est affiché **avant** la mise à jour Supabase — identique au comportement BO.

**État :** `const [courtInput, setCourtInput] = useState<string | null>(null);` — `null` = dialog fermé.

**Flux :**
1. Clic « Démarrer le live » → `setCourtInput('')`
2. Dialog : titre *« Quel court ? »*, sous-titre *« Laissez vide si le court n'est pas encore défini. »*, champ texte autofocus, bouton **Démarrer** (primaire), bouton **Annuler**
3. Entrée ou clic Démarrer → `handleStart(courtInput.trim() || null)`, dialog fermé
4. Annuler → `setCourtInput(null)`, aucune mise à jour

**`handleStart` :**
```ts
const handleStart = async (court: string | null) => {
  if (!userId) return;
  setBusy(true);
  const { error } = await supabase
    .from('live_matches')
    .update({ status: 'live', scored_by: userId, court })
    .eq('id', match.id);
  if (error) { setActionError(error.message); setBusy(false); return; }
  setCourtInput(null);
  refresh();
  navigate(`/matches/${match.id}/score`);
};
```

**Ne pas toucher :** `handleTakeover` (le court est déjà assigné), `handleRelease`, `handleDelete`, `handleResume`.
La colonne `court` existe depuis `supabase/migrations/20260519_live_matches_court.sql`.

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


## Fiabilité des écritures — septembre 2026

Les pages de saisie BO et PWA utilisent le même contrat (`hooks/useLiveMatch.ts` et
`lib/liveMatchWrites.ts`, copies à synchroniser).

- Une sauvegarde à la fois, verrouillée avant le prochain rendu React. Les boutons de score,
  abandon et annulation sont désactivés pendant la requête. Le score affiché est confirmé par
  le serveur : aucun état optimiste n'est présenté comme enregistré.
- `live_matches.revision` est un entier initialisé à 0, incrémenté par trigger pour toute
  mise à jour, y compris service role. Les clients incluent la version lue dans les filtres
  UPDATE/DELETE et exigent une ligne retournée. Une version dépassée ou une ligne inaccessible
  produit une erreur explicite, jamais un succès silencieux.
- Les notifications Realtime et réponses ne remplacent l'état affiché que si leur version
  est plus récente. Un accusé retardé ne peut pas annuler une reprise de contrôle.
- Erreur/conflit : relecture serveur sans rejouer automatiquement l'écriture incertaine,
  message visible et bouton de rechargement. Requêtes bornées à 15 secondes. Revalidation
  au retour réseau/focus, à la souscription/reconnexion Realtime et toutes les 30 secondes
  lorsque l'écran est visible. Les réponses d'un ancien écran sont ignorées.
- Le gestionnaire conserve la main sur la fin, l'abandon et l'annulation de fin. Un autre
  utilisateur voit l'écran en lecture seule. Le changement de gestionnaire ne permet pas
  de modifier les scores dans la même écriture. Le démarrage d'un match en attente conserve
  ses scores et ses joueurs. La libération conserve les scores et remet le match en attente.
- En base, seul le gestionnaire peut modifier le match ; la reprise explicite reste possible
  pour un membre autorisé par la RLS du club. Un match en attente peut être supprimé par un
  membre ; un match démarré, seulement par son gestionnaire ou un admin/manager du club.
  Les créations doivent être en attente, sans gestionnaire. Le déplacement d'un match vers
  un autre club est refusé. Les opérations de maintenance serveur et la FK events
  ON DELETE SET NULL restent fonctionnelles.

### Déploiement et vérification

Appliquer `20260907_live_match_consistency.sql` sur le projet de développement **avant**
de tester ces clients, puis en production avant le déploiement BO/PWA. Aucun changement
supplémentaire d'Edge Function. Faire recharger les anciennes sessions : leurs écritures
respectent le nouveau contrôle de gestionnaire, mais elles n'envoient pas de version et ne
bénéficient donc pas du contrôle de concurrence des nouveaux clients.

`npm run test:live-score` exécute les hooks BO/PWA avec React et Supabase simulé, ainsi que
la migration réelle dans PGlite sur le schéma Live. Scénarios : double clic, réponse ancienne,
reprise, erreur réseau, absence de ligne modifiée, abandon/annulation, libération/démarrage,
isolation du club et suppression de l'événement parent. Les conflits SQL sont simulés par
écritures successives portant la même version, pas par deux connexions PostgreSQL simultanées.

Avant merge : deux sessions du projet de dev, score lent, reprise pendant saisie, fin et
annulation par le propriétaire, mode hors ligne puis rechargement. Les tests isolés ne
remplacent pas ce contrôle du Supabase réellement déployé.


Correctif de transition : les lectures et écritures refusent une `revision` absente ou
invalide avec un message de rechargement, avant tout appel de mutation. Une réponse Realtime
incomplète est ignorée ; une lecture valide peut remplacer un ancien état local dépourvu de
version (page restée ouverte lors de la migration ou du rechargement Vite).


### Lecture publique explicite

`20260908_live_matches_public_read.sql` crée la policy SELECT `anon` jusque-là laissée
au dashboard. Les visiteurs peuvent lire les matchs en attente, en cours et terminés des
clubs actifs. Aucun droit d'écriture anonyme ; les contrôles de version et de propriétaire
restent inchangés. Le filtre de dates de la liste PWA reste identique pour tous les visiteurs.
Appliquer cette migration après celle de versionnement sur dev, puis prod.


### Visibilité à trois jours — BO et PWA

Les listes excluent à la source les matchs `finished` dont `finished_at` est strictement
antérieur à maintenant moins 3 × 24 heures. La PWA ne filtre plus sur `match_date` : les
résultats des jours précédents restent visibles durant ces trois jours, et les matchs
encore en cours ne disparaissent pas au changement de jour. Les matchs sans `finished_at`
restent visibles pour ne pas les masquer sur une hypothèse. La règle est évaluée à chaque
chargement/rafraîchissement de la liste. Les fiches accessibles par lien restent consultables.

Aucune suppression en base. Les liens `team_match_lines.live_match_id` et la synchronisation
des résultats interclubs sont conservés. Une future purge nécessite de définir la durée de
conservation et de garantir la synchronisation des résultats avant suppression.

### Durée du match et des sets — PWA (13/10/2026)

La page live de la PWA (`LiveScoreboard`) affiche « Durée du match : 1 h 23 » à côté du badge
de statut et une ligne « Durée » sous les colonnes S1–S3
(« 42′ », « 1h05 »). Pendant le live, la durée du match et celle du set en cours avancent
toutes les 30 s. Le BO n'affiche rien.

- Match : `finished_at` (ou maintenant si `live`) − `started_at`.
- Set 1 : `set1_ended_at` − `started_at` ; set 2 : `set2_ended_at` − `set1_ended_at` ;
  set 3 : `finished_at` − `set2_ended_at`. Le set en cours se mesure jusqu'à maintenant, et
  un set interrompu par un abandon jusqu'à `finished_at`.
- `set1_ended_at` / `set2_ended_at` sont posés par le trigger `live_matches_set_times`
  (après `live_matches_guard`), jamais par les clients : horodatage quand le set devient gagné
  alors que le match était `live`, conservé ensuite, effacé si une correction annule le set.
  Un score historique (insertion, Ten'Up, match hors live) ne reçoit pas d'heure. La règle
  `live_set_won` est le miroir SQL de `getNormalSetWinner`.
- Sans ces heures (matchs antérieurs ou migration non appliquée), seule la durée du match
  s'affiche. Une saisie en retard date la fin du set au moment de la saisie ; une
  réouverture de match compte dans sa durée.

Calcul : `pwa/src/lib/liveDurations.ts`. Test : `tests/live-set-times-sql.test.mjs`
(`npm run test:live-score`).

### Récap du live terminé — PWA (22/10/2026)

Un live terminé affiche à la fin de son fil une accroche sombre **« Récap du match »**
(`pwa/src/components/live/LiveRecap.tsx`), visible de tous, visiteurs compris : vainqueur, score
des sets (points du perdant du tie-break en exposant), publications, réactions, spectateurs, et le
bouton **« Revivre le match »**. Il ouvre une story plein écran façon retransmission
(`LiveReplay.tsx`, `<dialog>` modal, fond noir et couleur du club) qui s'enchaîne seule, barres de
progression en haut ; toucher à gauche recule, à droite avance, pause et fermeture en haut à droite,
Échap ferme. Écran de fin : « Revoir » ou « Retour au live ». Scènes, les absentes étant sautées :

1. **Intro** — joueurs ou paires, tournoi, court, date.
2. **Le match en accéléré** (5 à 14 s, ~0,45 s par étape) — tableau de score qui se remplit avec
   l'heure réelle de chaque jeu, badge **BREAK** quand le premier serveur est connu, et les 5
   commentaires ou photos les plus réagis qui apparaissent à leur heure. Sautée sans historique.
3. **Le moment fort** — calculé par `matchHighlight` : remontée d'au moins 2 jeux dans un set gagné
   (« Mené 2–5, A. Martin retourne la situation »), sinon victoire après la perte du premier set,
   sinon série d'au moins 4 jeux, sinon tie-break ou super tie-break. Seuls les jeux d'ordre connu
   comptent ; pas de remontée ni de premier set perdu sur abandon. Sautée si rien de remarquable.
4. **Photos** — diaporama des 6 photos les plus réagies, 2,6 s chacune, zoom lent, légende, auteur.
5. **En tribune** — spectateurs (au-delà de 10), publications, réactions, top 3 des emojis qui
   s'envolent.
6. **Vainqueur** — score final, jeux de chaque set en cases (couleur du club / blanc), durée.

`prefers-reduced-motion` coupe les transitions, le zoom, les emojis et le défilement des
compteurs ; les scènes avancent toujours seules. Les compteurs animés exposent leur valeur exacte
aux lecteurs d'écran.

- **Déroulé du score** : le trigger `live_matches_score_events` (AFTER UPDATE) insère dans
  `live_score_events` un instantané du score (mêmes clés que `live_posts.score`) au démarrage
  (`pending` → `live`) et à chaque changement des jeux d'un set ou du super tie-break, tant que
  le match est `live` (y compris l'écriture qui le termine). Les points d'un tie-break de set
  normal, le court et les écritures hors live (Ten'Up, import) n'écrivent rien.
  `recapSets` (`pwa/src/lib/liveRecap.ts`) reconstruit l'ordre des jeux : une correction retire
  le jeu annulé au lieu de l'attribuer à l'adversaire ; les jeux déjà marqués au démarrage ou
  ajoutés des deux côtés dans une même saisie ont un ordre inconnu (case pâle). Le score final
  de la ligne fait foi. Pas de case pour le super tie-break (score affiché seul), pas de break :
  le serveur n'est pas connu. Un match terminé avant la migration n'a que son score final.
- **Replay et breaks** : `replayFrames` rejoue les instantanés (une correction efface les étapes
  qu'elle annule, le score final de la ligne fait foi). Le break se déduit de `first_server` avec la
  même règle que `getServer` (service alterné à chaque jeu, un tie-break compte pour un jeu) ; sans
  premier serveur, ou quand une saisie ajoute plusieurs jeux d'un coup, aucun break n'est affiché.
- **Spectateurs uniques** : à l'ouverture d'un live **en cours**, la PWA appelle une fois par
  appareil et par match `live_match_view(match, viewer)` ; `viewer` est un UUID aléatoire gardé
  en `localStorage` (`live_viewer`, matchs déjà comptés dans `live_viewed`), aucune donnée
  personnelle. Insertion `ON CONFLICT DO NOTHING` dans `live_match_viewers`, sans effet hors
  live. Le chiffre n'est publié que **au-delà de 10** (`viewers` null sinon, décidé côté
  serveur). Un client peut gonfler le compteur avec des UUID inventés : statistique indicative.
- **Lecture** : `live_match_recap(match, club)`, publique (club actif), `null` tant que le
  match n'est pas terminé. Depuis `2026102301_live_recap_replay.sql` elle renvoie aussi l'heure
  de chaque instantané (`score[].at`), les 5 publications les plus réagies (`moments`, commentaires
  et photos, avec leur emoji dominant) et les 6 photos les plus réagies (`photos_top`). Publications et réactions supprimées exclues, publications ajoutées
  après la fin comptées. La PWA la relit quand son fil change (nouvelle publication ou réaction).
- Charge : une insertion par jeu marqué, une par appareil et par match, aucun verrou sur
  `live_matches`, aucun canal Realtime ni battement de présence.

Migrations : `2026102203_live_recap.sql`, `2026102301_live_recap_replay.sql`. Tests : `tests/live-recap-sql.test.mjs` et
`tests/live-activity-client.test.mjs` (`npm run test:live-activity`).

---

## Temps réel par Broadcast — octobre 2026

Les pannes prod des 10, 17 et 18/10/2026 (instance Nano) ont montré que `postgres_changes`
coûtait à lui seul environ 36 % du temps base : Realtime relit le WAL via wal2json en boucle tant
qu'un abonné existe (655 000 lectures en 8 jours), et chaque (ré)abonnement écrit une ligne
`realtime.subscription` puis évalue la RLS par abonné et par changement (17 000 abonnements en
8 jours pour une dizaine d'appareils). S'y ajoutait un polling de 15 à 30 s sur chaque écran.

### Côté base — `2026101820_live_broadcast.sql`

Des triggers `AFTER` publient chaque écriture par `realtime.send(..., private => false)` ; Realtime
diffuse le message aux canaux du topic, sans polling du WAL ni RLS par abonné.

| Topic | Événement | Payload | Déclencheur |
|---|---|---|---|
| `live:match:<match_id>` | `score` | `{ row }` — ligne `live_matches` complète après écriture | INSERT/UPDATE `live_matches` |
| `live:match:<match_id>` | `post` | `{ id, sequence, op }` | INSERT/UPDATE `live_posts` (message, sondage, photo, vote, clôture, réaction, suppression logique) |
| `live:club:<club_id>` | `live` | `{ id, op, status, team_rencontre_id }` | INSERT/UPDATE/DELETE `live_matches` |
| `live:club:<club_id>` | `team` | `{ rencontre_id }` | INSERT/UPDATE/DELETE `team_rencontres`, `team_match_lines` |

- **Topics publics** : un visiteur lit déjà `live_matches` et `live_posts` des clubs actifs ; les
  signaux d'équipe ne portent que des identifiants. Rien n'est publié pour un club non actif
  (`live_club_active`).
- La migration retire `live_matches` et `live_posts` de la publication `supabase_realtime`.
- Fonctions `SECURITY DEFINER` (l'écriture dans `realtime.messages` n'est pas accordée à
  `authenticated`), non exécutables directement par les clients.

### Côté clients

- `lib/liveChannel.ts` (copies BO `src/` et PWA `pwa/`) : **un canal par topic**, partagé entre
  écouteurs avec un compteur de références (`supabase.channel(topic)` renvoie le canal existant de
  même topic : sans partage, le `removeChannel` d'un écran couperait l'autre). Le canal reste
  ouvert **10 s** après le dernier écouteur (`RELEASE_DELAY`) : naviguer entre la liste et un live
  ne le rejoint pas à nouveau. Les noms de canal ne contiennent plus l'utilisateur : se connecter
  ou se déconnecter ne rouvre rien.
- Polling : **secours** à 15 s (fil, scores de rencontre, pages équipes) ou 30 s (score, listes)
  tant que le canal n'est pas abonné ; **filet** de 2 min (`LIVE_SAFETY_POLL`) quand il l'est, un
  message Broadcast perdu n'étant jamais rejoué. Revalidation à chaque (ré)abonnement, au retour
  réseau et au focus.
- Score (`useLiveMatch`, BO + PWA) : la ligne du message `score` passe par le même contrôle de
  version (`revision`) qu'avant — aucun aller-retour supplémentaire pour afficher le point.
- Ouverture d'un live depuis la liste (PWA) : `LiveMatchPage` passe à `useLiveMatch` la ligne déjà
  en cache (`['matches', clubId]`, tenue à jour par le Broadcast du club) ; elle s'affiche **sans
  attendre le réseau** (« Synchronisation… »), puis la lecture serveur la remplace si elle est plus
  récente. Tant qu'elle n'est pas confirmée (`confirmed`), la saisie est bloquée : jamais d'écriture
  sur un score non vérifié. Un lien direct, sans liste en cache, attend la lecture comme avant.
- Fil (`useLiveActivity`) : un message `post` ou une commande de l'utilisateur ne relit que la
  **tête du fil** (`live_activity_page` sans curseur), fusionnée dans la première page chargée
  (`mergeActivityHead`) ; les pages plus anciennes ne sont relues que si le post concerné s'y
  trouve. Avec une seule page chargée, c'est une invalidation ordinaire (une lecture). L'écho
  d'une publication déjà affichée est ignoré.
- Listes : `MatchesPage` (PWA) et `LiveScorePage` (BO) écoutent `live:club:<id>` / `live` ;
  `MatchesEquipesPage` écoute `team` et les `live` dont le statut change l'état « en direct » d'une
  rencontre affichée ; `TeamRencontrePage` (PWA) les `team` / `live` de sa rencontre.

### Déploiement

1. Vérifier dans le dashboard (Realtime → Settings) que les **canaux publics** sont autorisés.
2. Appliquer la migration sur dev, tester (deux appareils : score, commentaire, réaction, liste,
   rencontre d'équipe, mise en arrière-plan puis retour), puis en prod.
3. Déployer BO et PWA juste après : un client resté sur l'ancienne version ne reçoit plus
   d'événement et retombe sur son polling (la liste BO, qui n'en avait pas, jusqu'au rechargement).
4. Contrôler dans `pg_stat_statements` la disparition des appels `realtime.list_changes` /
   wal2json.

Tests : `tests/live-broadcast-sql.test.mjs` (`npm run test:live-score`, `realtime.send` simulé),
`tests/live-activity-head.test.mjs` (`npm run test:live-activity`), `tests/pwa-network.test.mjs`.

## Notifications Web Push — octobre 2026

Détail, mise en service et recette : `docs/LIVE_PUSH.md` (migration `2026102401_live_web_push.sql`).

- **Début de match** : au démarrage (PWA : sous le choix du serveur ; BO : dialog *Démarrer le live* ; rencontres d'équipe PWA et BO), une case « Prévenir les abonnés du club », cochée par défaut. Si elle est cochée, le client appelle `live_push_announce_start(club, match)` juste après le passage en `live` : alerte aux appareils du club dont la préférence Live est active, sauf la personne qui démarre. Un échec de l'alerte ne bloque jamais le démarrage (PWA : message sous le tableau).
- **Suivre un match** : cloche seule (`LiveFollowButton iconOnly`, sans bordure) sur les cartes des matchs en attente / en live et en haut à droite du live (le bouton « i » passe à sa gauche) ; pleine et à la couleur du club quand les alertes sont actives, au trait sinon. Sur la page du live, chaque changement est confirmé par un toast en bas (« Alertes activées / désactivées pour ce match », 3 s, au-dessus de la barre de saisie), réservée aux membres du club. Le suiveur reçoit les fins de set 1 et 2, la fin du match (une seule fois même après « Rouvrir pour corriger ») et les publications du fil des autres membres, regroupées en rafale.
- **Accueil des live** : bandeau d'activation des alertes Live (membre) ou d'invitation à se connecter (visiteur), « Plus tard » mémorisé. Interrupteur permanent dans **Mon profil**.
- Aucune colonne ajoutée à `live_matches` : les fins de set/match sont détectées par le trigger `live_push_match` (sur `set1_ended_at` / `set2_ended_at` / `status`), sans coût sur les écritures de point ordinaires (clause `WHEN`).

