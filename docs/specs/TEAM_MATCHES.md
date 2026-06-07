# Spec — Module Matches par équipe

> Statut : intégré (back-office)
> Dernière mise à jour : 2026-06-06

## Écarts d'implémentation vs spec initiale

- **Live Score** : le payload `live_matches` a été corrigé (`j1`…`j4` au lieu de
  `player1`…`player4`) — voir section *Intégration Live Score*.
- **Trigger `updated_at`** : la migration réutilise la fonction partagée `set_updated_at()`
  (définie dans `20260418_events.sql`) au lieu de redéfinir `set_updated_at_team_rencontres()`.
- **Routes** : `/team-matches/rencontre/new` est servie par `TeamRencontreForm` (création),
  `/team-matches/rencontre/:id` par `TeamRencontrePage` (suivi). La spec initiale mappait `new`
  vers `TeamRencontrePage`, ce qui contredisait la section *Formulaire de rencontre*.
- **Nommage** : la page détail d'équipe est `TeamEquipePage.tsx` (cohérent avec l'arborescence
  et les routes), pas `TeamMatcheEquipePage.tsx`.
- Le bucket `team-match-photos` et ses policies sont inclus dans la migration SQL.

---

## Objectif

Créer un module dédié à la gestion des rencontres par équipe dans le back-office. Ces rencontres sont actuellement stockées comme type d'événement, ce qui est inadapté (les joueurs n'ont pas à s'inscrire). Le nouveau module repart de zéro — aucune migration depuis `events`.

---

## Scope

- Back-office uniquement (pas de PWA dans cette version)
- Section Admin : gestion des saisons et compétitions
- CRUD des équipes du club dans chaque compétition
- Création et suivi des rencontres (score, photos)
- Intégration optionnelle avec le module Live Score

Hors scope : exposition PWA, notifications, statistiques de saison.

---

## Intégration dans l'app

- Nouvelle carte sur `AppHomePage` → label **"Matches par équipe"**, description **"Gérer les rencontres interclubs de l'équipe."**
- Route racine : `/team-matches`
- Navigation admin : `/team-matches/admin`
- Page principale : `src/pages/TeamMatchesPage.tsx`

---

## Modèle de données

### Types TypeScript (`src/types.ts`)

```ts
// --- Référentiel ---

export type TeamCompetitionNom =
  | 'Pyrénées Interclubs'
  | 'CODEP'
  | 'GAN 35'
  | 'Thénégal'
  | 'Interclubs';

export type TeamType = 'adultes' | 'jeunes';

export type TeamGenre =
  | 'hommes'
  | 'femmes'
  | 'mixte'
  | 'garcons'
  | 'filles';

export type TeamCategorie =
  | 'seniors'
  | '35_ans'
  | '60_ans'
  | '17_18'
  | '15_16'
  | '13_14'
  | '11_12';

export type TeamFormat =
  | '2S1D'    // 2 simples et 1 double
  | '3S1D2'   // 3 simples et 1 double (double = 2 pts)
  | '4S1D2'   // 4 simples et 1 double (double = 2 pts)
  | '4S2D';   // 4 simples et 2 doubles

export type TeamDivision = 'R1A' | 'R1B' | 'R2' | 'R3' | 'R4' | 'R5' | 'R6';

export type TeamStadeFinale = '1/16' | '1/8' | '1/4' | '1/2' | 'finale';

export type TeamMatchLineType = 'simple' | 'double';

export type TeamMatchGagnant = 'club' | 'adverse';

// --- Entités ---

export interface TeamSaison {
  id: string;
  label: string;       // ex. "2025/2026"
  actif: boolean;
  created_at: string;
}

export interface TeamCompetition {
  id: string;
  saison_id: string;
  nom: TeamCompetitionNom;
  type: TeamType;
  genre: TeamGenre;
  categorie: TeamCategorie;
  format: TeamFormat;
  created_at: string;
}

export interface TeamEquipe {
  id: string;
  competition_id: string;
  numero: number;           // 1, 2, 3…
  division: TeamDivision;
  nb_journees_poule: number;
  qualifiee: boolean | null; // null = non encore déterminé
  stade_finale_depart: TeamStadeFinale | null;
  created_at: string;
}

export interface TeamEtape {
  id: string;
  equipe_id: string;
  phase: 'poule' | 'finale';
  numero_journee: number | null;      // renseigné si phase = 'poule'
  stade_finale: TeamStadeFinale | null; // renseigné si phase = 'finale'
  created_at: string;
}

export interface TeamJoueur {
  prenom: string;
  nom: string | null;
  classement: string; // ex. "30", "15/2"
}

export interface TeamMatchLine {
  id: string;
  rencontre_id: string;
  ordre: number;
  match_type: TeamMatchLineType;
  joueurs_club: TeamJoueur[];
  joueurs_adverse: TeamJoueur[];
  live_match_id: string | null;
  score: string | null;         // saisie libre si pas de live
  gagnant: TeamMatchGagnant | null;
  created_at: string;
}

export interface TeamRencontre {
  id: string;
  etape_id: string;
  club_adverse: string;
  date_heure: string;          // ISO 8601
  domicile: boolean;
  score_club: number | null;
  score_adverse: number | null;
  photo_urls: string[];
  created_at: string;
  updated_at: string;
}
```

### Libellés d'affichage

| Valeur | Libellé affiché |
|---|---|
| `adultes` | Adultes |
| `jeunes` | Jeunes |
| `hommes` | Hommes |
| `femmes` | Femmes |
| `mixte` | Mixte |
| `garcons` | Garçons |
| `filles` | Filles |
| `seniors` | Seniors |
| `35_ans` | +35 ans |
| `60_ans` | +60 ans |
| `17_18` | 17/18 ans |
| `15_16` | 15/16 ans |
| `13_14` | 13/14 ans |
| `11_12` | 11/12 ans |
| `2S1D` | 2 simples et 1 double |
| `3S1D2` | 3 simples et 1 double (double = 2 pts) |
| `4S1D2` | 4 simples et 1 double (double = 2 pts) |
| `4S2D` | 4 simples et 2 doubles |

### Contraintes métier genre/type

Les valeurs de `genre` valides dépendent du `type` :

| type | genres valides |
|---|---|
| `adultes` | `hommes`, `femmes`, `mixte` |
| `jeunes` | `garcons`, `filles` |

Les valeurs de `categorie` valides dépendent du `type` :

| type | catégories valides |
|---|---|
| `adultes` | `seniors`, `35_ans`, `60_ans` |
| `jeunes` | `17_18`, `15_16`, `13_14`, `11_12` |

---

## Infrastructure Supabase

### Migrations SQL

**Fichier** : `supabase/migrations/20260606_team_matches.sql`

```sql
-- ============================================================
-- SAISONS
-- ============================================================
CREATE TABLE IF NOT EXISTS team_saisons (
  id         UUID        DEFAULT gen_random_uuid() PRIMARY KEY,
  label      TEXT        NOT NULL,
  actif      BOOLEAN     NOT NULL DEFAULT false,
  created_at TIMESTAMPTZ DEFAULT now() NOT NULL
);

ALTER TABLE team_saisons ENABLE ROW LEVEL SECURITY;
CREATE POLICY "team_saisons_all" ON team_saisons FOR ALL TO authenticated USING (true) WITH CHECK (true);
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.team_saisons TO authenticated;

-- ============================================================
-- COMPÉTITIONS
-- ============================================================
CREATE TABLE IF NOT EXISTS team_competitions (
  id         UUID        DEFAULT gen_random_uuid() PRIMARY KEY,
  saison_id  UUID        NOT NULL REFERENCES team_saisons(id) ON DELETE CASCADE,
  nom        TEXT        NOT NULL CHECK (nom IN (
                           'Pyrénées Interclubs', 'CODEP', 'GAN 35', 'Thénégal', 'Interclubs'
                         )),
  type       TEXT        NOT NULL CHECK (type IN ('adultes', 'jeunes')),
  genre      TEXT        NOT NULL CHECK (genre IN ('hommes', 'femmes', 'mixte', 'garcons', 'filles')),
  categorie  TEXT        NOT NULL CHECK (categorie IN (
                           'seniors', '35_ans', '60_ans', '17_18', '15_16', '13_14', '11_12'
                         )),
  format     TEXT        NOT NULL CHECK (format IN ('2S1D', '3S1D2', '4S1D2', '4S2D')),
  created_at TIMESTAMPTZ DEFAULT now() NOT NULL
);

ALTER TABLE team_competitions ENABLE ROW LEVEL SECURITY;
CREATE POLICY "team_competitions_all" ON team_competitions FOR ALL TO authenticated USING (true) WITH CHECK (true);
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.team_competitions TO authenticated;

-- ============================================================
-- ÉQUIPES
-- ============================================================
CREATE TABLE IF NOT EXISTS team_equipes (
  id                   UUID        DEFAULT gen_random_uuid() PRIMARY KEY,
  competition_id       UUID        NOT NULL REFERENCES team_competitions(id) ON DELETE CASCADE,
  numero               INTEGER     NOT NULL DEFAULT 1 CHECK (numero >= 1),
  division             TEXT        NOT NULL CHECK (division IN ('R1A', 'R1B', 'R2', 'R3', 'R4', 'R5', 'R6')),
  nb_journees_poule    INTEGER     NOT NULL CHECK (nb_journees_poule >= 1),
  qualifiee            BOOLEAN,    -- null = non déterminé, true/false après la phase de poule
  stade_finale_depart  TEXT        CHECK (stade_finale_depart IN ('1/16', '1/8', '1/4', '1/2', 'finale')),
  created_at           TIMESTAMPTZ DEFAULT now() NOT NULL
);

ALTER TABLE team_equipes ENABLE ROW LEVEL SECURITY;
CREATE POLICY "team_equipes_all" ON team_equipes FOR ALL TO authenticated USING (true) WITH CHECK (true);
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.team_equipes TO authenticated;

-- ============================================================
-- ÉTAPES (journées de poule + phases finales)
-- ============================================================
CREATE TABLE IF NOT EXISTS team_etapes (
  id              UUID        DEFAULT gen_random_uuid() PRIMARY KEY,
  equipe_id       UUID        NOT NULL REFERENCES team_equipes(id) ON DELETE CASCADE,
  phase           TEXT        NOT NULL CHECK (phase IN ('poule', 'finale')),
  numero_journee  INTEGER,    -- renseigné si phase = 'poule'
  stade_finale    TEXT        CHECK (stade_finale IN ('1/16', '1/8', '1/4', '1/2', 'finale')),
  created_at      TIMESTAMPTZ DEFAULT now() NOT NULL,
  CONSTRAINT check_etape_phase CHECK (
    (phase = 'poule' AND numero_journee IS NOT NULL AND stade_finale IS NULL) OR
    (phase = 'finale' AND stade_finale IS NOT NULL AND numero_journee IS NULL)
  )
);

ALTER TABLE team_etapes ENABLE ROW LEVEL SECURITY;
CREATE POLICY "team_etapes_all" ON team_etapes FOR ALL TO authenticated USING (true) WITH CHECK (true);
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.team_etapes TO authenticated;

-- ============================================================
-- RENCONTRES (une par étape)
-- ============================================================
CREATE OR REPLACE FUNCTION set_updated_at_team_rencontres()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TABLE IF NOT EXISTS team_rencontres (
  id             UUID        DEFAULT gen_random_uuid() PRIMARY KEY,
  etape_id       UUID        NOT NULL UNIQUE REFERENCES team_etapes(id) ON DELETE CASCADE,
  club_adverse   TEXT        NOT NULL,
  date_heure     TIMESTAMPTZ NOT NULL,
  domicile       BOOLEAN     NOT NULL,
  score_club     INTEGER,
  score_adverse  INTEGER,
  photo_urls     TEXT[]      NOT NULL DEFAULT '{}',
  created_at     TIMESTAMPTZ DEFAULT now() NOT NULL,
  updated_at     TIMESTAMPTZ DEFAULT now() NOT NULL
);

CREATE TRIGGER team_rencontres_updated_at
  BEFORE UPDATE ON team_rencontres
  FOR EACH ROW EXECUTE FUNCTION set_updated_at_team_rencontres();

ALTER TABLE team_rencontres ENABLE ROW LEVEL SECURITY;
CREATE POLICY "team_rencontres_all" ON team_rencontres FOR ALL TO authenticated USING (true) WITH CHECK (true);
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.team_rencontres TO authenticated;

-- ============================================================
-- MATCHES INDIVIDUELS D'UNE RENCONTRE (optionnel)
-- ============================================================
CREATE TABLE IF NOT EXISTS team_match_lines (
  id              UUID        DEFAULT gen_random_uuid() PRIMARY KEY,
  rencontre_id    UUID        NOT NULL REFERENCES team_rencontres(id) ON DELETE CASCADE,
  ordre           INTEGER     NOT NULL DEFAULT 0,
  match_type      TEXT        NOT NULL CHECK (match_type IN ('simple', 'double')),
  joueurs_club    JSONB       NOT NULL DEFAULT '[]',    -- [{prenom, nom, classement}]
  joueurs_adverse JSONB       NOT NULL DEFAULT '[]',    -- [{prenom, nom, classement}]
  live_match_id   UUID        REFERENCES live_matches(id) ON DELETE SET NULL,
  score           TEXT,       -- saisie libre si pas de live, ex. "6-4 6-2"
  gagnant         TEXT        CHECK (gagnant IN ('club', 'adverse')),
  created_at      TIMESTAMPTZ DEFAULT now() NOT NULL
);

ALTER TABLE team_match_lines ENABLE ROW LEVEL SECURITY;
CREATE POLICY "team_match_lines_all" ON team_match_lines FOR ALL TO authenticated USING (true) WITH CHECK (true);
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.team_match_lines TO authenticated;
```

### Bucket Storage — `team-match-photos`

- **Visibilité** : publique
- **Formats acceptés** : `image/jpeg`, `image/png`
- **Taille max** : 10 Mo
- **Nommage** : `{rencontre_id}/{timestamp}-{nom-fichier-sanitizé}.{ext}`

```sql
INSERT INTO storage.buckets (id, name, public)
VALUES ('team-match-photos', 'team-match-photos', true);

CREATE POLICY "team_match_photos_read" ON storage.objects
  FOR SELECT USING (bucket_id = 'team-match-photos');

CREATE POLICY "team_match_photos_write" ON storage.objects
  FOR INSERT TO authenticated WITH CHECK (bucket_id = 'team-match-photos');

CREATE POLICY "team_match_photos_delete" ON storage.objects
  FOR DELETE TO authenticated USING (bucket_id = 'team-match-photos');
```

---

## Section Admin — `/team-matches/admin`

Page `src/pages/TeamMatchesAdminPage.tsx`. Accessible depuis un bouton "Admin" dans le header de `TeamMatchesPage`.

### Gestion des saisons

Tableau ou liste des saisons existantes.

| Champ | Composant | Contrainte |
|---|---|---|
| Label | `<input type="text">` | Non vide, ex. "2025/2026" |
| Active | Toggle | Une seule saison active à la fois |

Actions : Créer, Modifier (inline), Supprimer (si aucune compétition liée).

**Règle** : activer une saison désactive automatiquement la précédente active.

### Gestion des compétitions

Par saison (filtrée sur la saison active par défaut, sélecteur pour les autres).

Tableau listant les compétitions avec colonnes : Nom, Type, Genre, Catégorie, Format.

Actions : Créer, Modifier, Supprimer (si aucune équipe liée).

**Formulaire de compétition** (modale ou inline) :

| Champ | Composant | Notes |
|---|---|---|
| Saison | `<select>` | Pré-remplie avec la saison active |
| Nom | `<select>` | Liste des 5 noms du `TeamCompetitionNom` |
| Type | Segmented `Adultes / Jeunes` | Conditionne genre et catégorie |
| Genre | `<select>` | Options filtrées selon le type |
| Catégorie | `<select>` | Options filtrées selon le type |
| Format | `<select>` | 4 options avec libellé complet |

---

## Module principal — `/team-matches`

### Page liste des équipes — `TeamMatchesPage.tsx`

**Filtres** (en haut) :
- Sélecteur de saison (par défaut : saison active)
- Sélecteur de compétition (toutes les compétitions de la saison sélectionnée)

**Liste** : une carte par équipe.

**Carte équipe** :
- En-tête : compétition (nom + catégorie + genre), division, "Équipe N"
- Sous-titre : saison
- Badges : phase de poule en cours (Jx/N) ou phase finale (stade courant)
- Actions : **Voir** | **Supprimer** (avec confirmation)

**Bouton "Créer une équipe"** → ouvre formulaire (modale ou page dédiée).

**Formulaire de création d'équipe** :

| Champ | Composant | Notes |
|---|---|---|
| Compétition | `<select>` | Parmi les compétitions de la saison active |
| Numéro | `<select>` `1 / 2 / 3…` | Incrémenté auto selon les équipes existantes dans la compétition |
| Division | `<select>` | R1A, R1B, R2…R6 |
| Journées de poule | `<input type="number" min="1">` | Nombre de journées de la phase qualificative |

À la validation : INSERT dans `team_equipes` puis génération automatique des étapes de poule (N lignes dans `team_etapes` avec `phase='poule'` et `numero_journee=1..N`).

**Bouton "Générer une affiche"** (barre de filtres, à gauche de « Créer une compétition ») → ouvre `GeneratePosterModal`.

#### Génération d'affiche des rencontres à venir (`GeneratePosterModal`)

Migré depuis `EventForm` (l'ancien type d'événement `'Match par équipe'` a été supprimé). L'affiche est téléchargée localement en JPEG — **pas d'upload Supabase**.

- **Chargement** : `team_rencontres` avec contexte imbriqué (`etape → equipe → competition`), filtré sur `date_heure >= now()`, trié ASC.
- **Sélection** : une checkbox par rencontre, libellé `{competitionLabel} — Équipe {numero} · {club_adverse}` + date formatée. Max 8 rencontres (capacité de l'affiche) ; les checkboxes non cochées sont désactivées une fois la limite atteinte. État vide : « Aucune rencontre à venir. »
- **Conversion** : `rencontreToTeamMatch()` mappe chaque rencontre en `TeamMatch` (genre déduit de `competition.genre`, type de `competition.categorie`, `teamNumber = min(numero, 3)`, `location` selon `domicile`, date/heure locales).
- **Rendu** : `TeamMatchImagePreview` monté hors viewport (`position: fixed; left: -99999`) → `html-to-image#toJpeg` (q=0.92, pixelRatio 2). Le `dataUrl` produit alimente un aperçu 110×156 + lien `<a download="affiche-matchs.jpg">`.
- **États du bouton** : `idle` → « Générer l'affiche » / `loading` → « Génération… » + spinner / `done` → « Régénérer ». Toute modification de la sélection repasse à `idle` et purge le `dataUrl`.

---

### Page équipe — `TeamMatcheEquipePage.tsx`

Route : `/team-matches/equipe/:id`

**En-tête** :
- Compétition : nom, catégorie, genre (ex. "Pyrénées Interclubs — Hommes Seniors")
- Saison
- "Équipe N — Division RX"
- Badge statut : En poule (Jx/N) | Qualifiée | Éliminée | Phase finale (stade)

**Section Phase de poule** :

Tableau des journées (J1 à JN). Chaque ligne affiche :
- Numéro de journée (ex. "J3")
- Si une rencontre est créée : club adverse, date, lieu (domicile/extérieur), score final (si saisi) ou badge "À jouer" + bouton **Supprimer** (supprime la rencontre et ses matches en cascade ; la ligne repasse à l'état vide)
- Si aucune rencontre : bouton "+ Créer la rencontre" + bouton **Supprimer** (supprime la journée). À la suppression : renumérotation des journées restantes (1..M) et mise à jour de `nb_journees_poule`. La dernière journée ne peut pas être supprimée (min. 1).

**Bouton "Qualifier pour les phases finales"** (visible dès que `qualifiee` est null — **aucun prérequis sur les rencontres de poule**, pour permettre de configurer directement la phase finale d'une équipe saisie a posteriori) :
- Ouvre une modale avec :
  - Toggle : "Qualifiée / Éliminée"
  - Si Qualifiée : `<select>` du stade de départ (1/16, 1/8, 1/4, 1/2, Finale)
- À la validation : UPDATE `team_equipes` (qualifiee + stade_finale_depart) + génération des étapes de la phase finale selon le stade de départ (voir ci-dessous)

**Section Phase finale** (visible uniquement si `qualifiee = true`) :

Même tableau que la poule, mais avec les stades comme intitulés de ligne. Les stades sont générés séquentiellement à partir du stade de départ (ex. si départ = "1/4" → [1/4, 1/2, Finale]). Si l'équipe est éliminée à un stade, les stades suivants restent vides mais affichés (grisés).

Comme en poule, chaque ligne de stade affiche un bouton **Supprimer** : sur une ligne avec rencontre il supprime la rencontre (cascade), sur une ligne vide il supprime le stade (`team_etapes`). La suppression d'un stade est unitaire (pas de renumérotation, pas de garde « min. 1 ») — utile pour retirer un stade de départ saisi trop tôt.

L'en-tête de la section porte un bouton **Annuler la qualification** : il supprime tous les stades de phase finale de l'équipe (et leurs rencontres, en cascade) puis remet `qualifiee = null` et `stade_finale_depart = null`. L'équipe repasse à l'état non tranché → le bouton « Qualifier pour les phases finales » réapparaît, permettant de reconfigurer avec le bon stade de départ. C'est la porte de sortie si tous les stades ont été supprimés (sinon l'équipe resterait bloquée : `qualifiee = true` sans aucun stade ni moyen d'en regénérer).

**Génération des étapes de phase finale** : au moment de la qualification, insérer dans `team_etapes` une ligne par stade depuis `stade_finale_depart` jusqu'à `finale`.

Ordre des stades : `['1/16', '1/8', '1/4', '1/2', 'finale']`. Si le stade de départ est `1/4`, insérer 3 étapes (`1/4`, `1/2`, `finale`).

---

### Formulaire de rencontre — `TeamRencontreForm.tsx`

Routes : `/team-matches/rencontre/new?etapeId=…`, `/team-matches/rencontre/:id/edit`

**Champs** :

| Champ | Composant | Contrainte |
|---|---|---|
| Club adverse | `<input type="text">` | Obligatoire, non vide |
| Date et heure | `<input type="datetime-local">` | Obligatoire |
| Lieu | Segmented `Au club / Déplacement` | Obligatoire |

Contexte affiché en lecture seule en haut du formulaire : compétition, étape (ex. "J3" ou "1/4 de finale"), équipe.

---

### Page de suivi d'une rencontre — `TeamRencontrePage.tsx`

Route : `/team-matches/rencontre/:id`

**En-tête** : contexte complet (compétition, étape, équipe, club adverse, date, lieu).

#### Section "Matches de la rencontre" (optionnel)

Affiche les matches individuels déjà créés (liste de `TeamMatchLine`).

Bouton "+ Ajouter un match" → ouvre une modale de saisie :

| Champ | Composant | Notes |
|---|---|---|
| Type | Segmented `Simple / Double` | |
| Joueurs du club | N champs (N=1 si simple, N=2 si double) | Prénom (obligatoire), Nom (optionnel), Classement (obligatoire) |
| Joueurs adverses | N champs | Prénom (obligatoire), Nom (optionnel), Classement (obligatoire). Club = club adverse de la rencontre (hérité, affiché en lecture seule) |

Validation : prénom et classement obligatoires pour chaque joueur.

Trois états d'une ligne de match :

1. **Sans résultat, pas de live** (`gagnant` null, `live_match_id` null) — rangée d'actions :
   - **Saisir le score** → modale dédiée (`TeamMatchScoreModal`) : vainqueur (segmented `Notre club / Adverse`) + score libre optionnel (ex. "6-4 6-2"). Met à jour `team_match_lines.gagnant` et `.score`. Permet de renseigner un résultat **sans passer par le Live Score**.
   - **Modifier** → réouvre la modale joueurs pré-remplie
   - **Basculer vers le Live Score** — voir section dédiée ci-dessous
   - **Supprimer**
2. **Terminé manuel** (`gagnant` renseigné, `live_match_id` null) — la rangée d'actions est **repliée** en un simple badge **« Terminé »** (vert), cliquable pour rouvrir la modale de score. La modale propose alors **« Retirer le résultat »** (remet `gagnant`/`score` à null → retour à l'état 1 avec ses actions).
3. **Relié au live** (`live_match_id` renseigné) — badge "En live" / "Terminé · voir le live" + lien vers le live (pas d'édition directe — le résultat vient du live).

Le vainqueur/score saisi (`gagnant`, `score`) s'affiche sous les joueurs de la ligne.

**Nombre attendu de matches** : affiché selon le format de la compétition (ex. "3/4 matches saisis" pour `3S1D2` → 3 simples + 1 double = 4 attendus). Pas de blocage si **incomplet** (on peut saisir moins).

**Contrainte de composition (sécurité)** : on ne peut pas dépasser le nombre de simples/doubles du format. Concrètement (`FORMAT_SPECS`) :
- Dans `TeamMatchLineModal`, un type dont toutes les places sont prises est **désactivé** ; le type par défaut est le premier type encore disponible ; un indicateur « Restant — simples : X, doubles : Y » est affiché. La sauvegarde refuse un type complet (filet de sécurité).
- Le bouton **« + Ajouter un match »** est désactivé quand le total attendu du format est atteint.
- Les places restantes excluent le match en cours d'édition (on peut toujours rééditer un match existant).

#### Section "Score final"

Saisie du score global de la rencontre.

| Cas | Comportement |
|---|---|
| Aucun match n'a de vainqueur | Deux `<input type="number">` : "Notre score" / "Score adverse" (saisie manuelle) |
| Au moins un match a un `gagnant` (saisi manuellement **ou** via le live) | Score calculé automatiquement à partir des `gagnant` des `TeamMatchLine`. Affichage en lecture seule. Bouton "Recalculer" pour forcer le recalcul. |

Calcul du score auto : somme des points gagnés selon le format. Exemple pour `3S1D2` :
- Chaque simple gagné = 1 pt
- Double gagné = 2 pts
- Score affiché : points pour le club / points pour l'adverse

Le score est sauvegardé dans `team_rencontres.score_club` et `score_adverse` à chaque modification.

#### Section "Photos"

Upload multiple de photos (JPEG/PNG, max 10 Mo chacune).

- Aperçu en grille (miniatures, supprimables)
- À la sauvegarde : upload vers le bucket `team-match-photos`, URLs ajoutées à `photo_urls`
- Suppression d'une photo : retire du bucket et du tableau

Bouton **"Créer une actu"** (visible si au moins une photo) : redirige vers `/actus/new` avec un état pré-rempli transmis via `sessionStorage` ou `location.state` :
```ts
{
  titre: `Match par équipe — ${club_adverse} (${date courte})`,
  // Pas de corps pré-rempli — l'utilisateur rédige le texte
  image_urls: photo_urls  // les photos de la rencontre
}
```
L'`ActuForm` existant doit lire cet état et pré-remplir les champs si présent.

---

## Intégration Live Score

### Basculement d'un match vers le Live Score

Depuis `TeamRencontrePage`, bouton **"→ Live Score"** sur chaque `TeamMatchLine` sans `live_match_id`.

**Payload inséré dans `live_matches`** (colonnes réelles : `j1_*`…`j4_*`, cf. migration
`20260423_live_matches.sql`). Convention d'équipe de `live_matches` : **équipe 1 = `j1` (+ `j3`
en double)**, **équipe 2 = `j2` (+ `j4` en double)**. Notre club est donc l'équipe 1, l'adverse
l'équipe 2 :

```ts
{
  match_date: 'YYYY-MM-DD',   // partie date de rencontre.date_heure (NOT NULL)
  start_time: 'HH:MM',        // partie heure de rencontre.date_heure
  match_type: line.match_type,
  type_tournoi: `${competition.nom} — ${etape_label_court}`, // ex. "Pyrénées Interclubs — J3"

  // Équipe 1 = notre club (j1, + j3 en double). j1_nom NOT NULL → '' si nul.
  j1_prenom: line.joueurs_club[0].prenom,
  j1_nom:    line.joueurs_club[0].nom ?? '',
  j1_classement: line.joueurs_club[0].classement,
  j1_club:   '',
  j3_prenom: isDouble ? line.joueurs_club[1].prenom : null,
  j3_nom:    isDouble ? (line.joueurs_club[1].nom ?? '') : null,
  j3_classement: isDouble ? line.joueurs_club[1].classement : null,
  j3_club:   isDouble ? '' : null,

  // Équipe 2 = club adverse (j2, + j4 en double). j2_nom NOT NULL → '' si nul.
  j2_prenom: line.joueurs_adverse[0].prenom,
  j2_nom:    line.joueurs_adverse[0].nom ?? '',
  j2_classement: line.joueurs_adverse[0].classement,
  j2_club:   rencontre.club_adverse,
  j4_prenom: isDouble ? line.joueurs_adverse[1].prenom : null,
  j4_nom:    isDouble ? (line.joueurs_adverse[1].nom ?? '') : null,
  j4_classement: isDouble ? line.joueurs_adverse[1].classement : null,
  j4_club:   isDouble ? rencontre.club_adverse : null,

  status: 'pending',
}
```

Après l'INSERT réussi : UPDATE `team_match_lines.live_match_id` avec l'UUID du live créé.

> **Note d'implémentation** — la version initiale de cette spec décrivait des colonnes
> `player1_*`…`player4_*` et un mapping club=`player1/2` / adverse=`player3/4` qui n'existent
> pas dans `live_matches`. Le payload ci-dessus a été corrigé pour coller au schéma réel
> (`j1`…`j4`, équipe 1 = `j1`+`j3`).

### Mise à jour du score depuis le Live Score

Quand un `TeamMatchLine` a un `live_match_id`, écouter (ou requêter à l'ouverture de `TeamRencontrePage`) le statut du live correspondant. Si `status = 'finished'` et `winner` est renseigné :
- Mettre à jour `team_match_lines.gagnant` en conséquence (`winner = 'j1'` → `club`, `winner = 'j2'` → `adverse`, puisque l'équipe 1 = notre club)
- Recalculer le score global de la rencontre

> Implémentation simplifiée acceptable : requête unique au chargement de la page, sans abonnement Realtime (le suivi live se fait depuis `LiveScorePage`).

---

## Validation côté client

| Champ | Règle |
|---|---|
| Label saison | Non vide |
| Nom compétition | Parmi les 5 valeurs autorisées |
| Genre | Compatible avec le type sélectionné |
| Catégorie | Compatible avec le type sélectionné |
| nb_journees_poule | Entier ≥ 1 |
| club_adverse | Non vide |
| date_heure | Obligatoire |
| domicile | Obligatoire (toujours l'un ou l'autre dans le segmented) |
| Prénoms joueurs | Non vide |
| Classements joueurs | Non vide |

---

## Arborescence de fichiers à créer

```
src/
  pages/
    TeamMatchesPage.tsx          # Liste des équipes (filtre saison/compétition)
    TeamMatchesAdminPage.tsx     # Admin saisons + compétitions
    TeamEquipePage.tsx           # Détail d'une équipe (phases + rencontres)
    TeamRencontrePage.tsx        # Suivi d'une rencontre
  components/
    teamMatches/
      TeamEquipeCard.tsx         # Carte équipe dans la liste
      TeamRencontreForm.tsx      # Formulaire création/édition rencontre
      TeamMatchLineModal.tsx     # Modale saisie d'un match individuel
      TeamScoreSection.tsx       # Section score final (manuel ou calculé)
      TeamPhotosSection.tsx      # Section upload de photos
```

## Routes à ajouter dans `App.tsx`

```tsx
<Route path="/team-matches"              element={auth(<TeamMatchesPage />)} />
<Route path="/team-matches/admin"        element={auth(<TeamMatchesAdminPage />)} />
<Route path="/team-matches/equipe/:id"   element={auth(<TeamEquipePage />)} />
<Route path="/team-matches/rencontre/new"      element={auth(<TeamRencontrePage />)} />
<Route path="/team-matches/rencontre/:id"      element={auth(<TeamRencontrePage />)} />
<Route path="/team-matches/rencontre/:id/edit" element={auth(<TeamRencontreForm />)} />
```

---

## Notes d'implémentation

- Utiliser le client Supabase existant (`src/lib/supabase.ts`)
- Pas de state management global — state local React dans chaque page
- Les étapes de poule sont générées automatiquement à la création de l'équipe (INSERT en batch dans `team_etapes`)
- Les étapes de phase finale sont générées lors de la qualification (INSERT en batch)
- Le lien "Créer une actu" passe les données via `location.state` (React Router) — `ActuForm` doit lire `location.state` à l'initialisation et pré-remplir si présent. Pas de modification de la DB dans ce flux.
- Avant de commencer : appliquer la migration SQL et créer le bucket `team-match-photos` dans le dashboard Supabase

---

## Ordre d'implémentation suggéré

1. **Migration SQL** + types TypeScript
2. **Admin** (saisons + compétitions) — `TeamMatchesAdminPage`
3. **Liste équipes + création** — `TeamMatchesPage`
4. **Page équipe** (phases + rencontres vides) — `TeamEquipePage`
5. **Formulaire rencontre** — `TeamRencontreForm`
6. **Page suivi** (matches individuels + score) — `TeamRencontrePage`
7. **Intégration Live Score** (basculement + mise à jour score)
8. **Photos + lien Actu**
