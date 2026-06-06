# Spec — Module Events

> Statut : prêt pour intégration
> Dernière mise à jour : 2026-04-18

---

## Objectif

Permettre aux admins de créer, modifier, supprimer et dupliquer des événements depuis le backoffice. À terme, les événements seront servis via un flux JSON authentifié à une webapp publique.

---

## Scope de cette spec

- Interface backoffice CRUD (liste + formulaire)
- Stockage Supabase (DB + Storage)
- Flux JSON (endpoint de lecture, authentifié)

Hors scope pour l'instant : la webapp publique de consommation.

---

## Intégration dans l'app

- Nouvelle carte sur `AppHomePage` (3ème carte) → label **"Événements"**, description **"Créer et gérer les événements du club."**
- Route : `/events`
- Layout : header propre à la page, même pattern que les pages existantes
- Page principale : `src/pages/EventsPage.tsx`

---

## Modèle de données

### Type TypeScript

```ts
export type EventType = 'Animation' | 'Tournoi' | 'Match par équipe' | 'Sortie' | 'Soirée';

export interface ClubEvent {
  id: string;                  // UUID généré par Supabase
  type: EventType;
  titre: string;
  description: string;         // Contenu Markdown
  date_debut: string;          // ISO 8601 avec timezone (ex: "2026-06-15T14:00:00+02:00")
  date_fin: string | null;     // Obligatoire si type === 'Tournoi', sinon optionnel
  image_url: string | null;    // URL publique Supabase Storage (optionnelle)
  prix: number | null;         // En euros. null ou 0 = gratuit
  team_matches: TeamMatch[] | null; // Voir section "Match par équipe" ci-dessous
  created_at: string;          // Géré par Supabase
  updated_at: string;          // Géré par Supabase (trigger)
}
```

### Type "Match par équipe" — extension

Quand `type === 'Match par équipe'`, le formulaire fait apparaître une section
"Matchs par équipe" (max 8 entrées) et un bouton "Générer l'affiche". Les
matchs saisis sont sérialisés dans la colonne `team_matches` (JSONB) ; pour
tout autre type, la colonne reste `NULL`.

```ts
export type TeamMatchGender = 'Masculin' | 'Féminin';

export type TeamMatchType =
  | 'Seniors'
  | 'Seniors +35'
  | 'Jeunes 15/16 ans'
  | 'Jeunes 13/14 ans'
  | 'Jeunes 11/12 ans';

export interface TeamMatch {
  id: string;                  // UUID local — keys React et réordonnancement
  gender: TeamMatchGender;
  matchType: TeamMatchType;
  teamNumber: 1 | 2 | 3;
  opponent: string;            // Champ libre (club adverse)
  location: 'home' | 'away';   // home = Au club, away = Chez l'adversaire
  date: string;                // "YYYY-MM-DD"
  time: string;                // "HH:MM"
}
```

**Validation côté client** (à la soumission, uniquement si type = `'Match par équipe'`) :
- Au moins 1 match
- Pour chaque match : `opponent` non vide, `date` et `time` renseignés

Aucune contrainte côté DB — JSONB libre.

Migration : `supabase/migrations/20260515_event_team_matches.sql`.

### Règles de validation

| Champ | Obligatoire | Contrainte |
|---|---|---|
| `type` | Oui | Parmi les 5 valeurs de l'enum |
| `titre` | Oui | Non vide |
| `description` | Oui | Non vide, Markdown |
| `date_debut` | Oui | Datetime (date + heure) |
| `date_fin` | Conditionnel | **Obligatoire si `type === 'Tournoi'`**, optionnel sinon. Doit être > `date_debut` si renseignée. |
| `image_url` | Non | JPEG ou PNG, max 5 Mo |
| `prix` | Non | Nombre positif ou nul. `null` ou `0` → afficher "Gratuit" |

---

## Infrastructure Supabase

### 1. Table `events` — SQL de migration

```sql
CREATE TABLE events (
  id          UUID        DEFAULT gen_random_uuid() PRIMARY KEY,
  type        TEXT        NOT NULL CHECK (type IN ('Animation', 'Tournoi', 'Match par équipe', 'Sortie', 'Soirée')),
  titre       TEXT        NOT NULL,
  description TEXT        NOT NULL,
  date_debut  TIMESTAMPTZ NOT NULL,
  date_fin    TIMESTAMPTZ,
  image_url   TEXT,
  prix        NUMERIC(10, 2) CHECK (prix >= 0),
  created_at  TIMESTAMPTZ DEFAULT now() NOT NULL,
  updated_at  TIMESTAMPTZ DEFAULT now() NOT NULL
);

-- Trigger updated_at
CREATE OR REPLACE FUNCTION set_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER events_updated_at
  BEFORE UPDATE ON events
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- RLS
ALTER TABLE events ENABLE ROW LEVEL SECURITY;

-- Lecture, écriture, modification, suppression : authentifié uniquement
CREATE POLICY "events_select" ON events FOR SELECT TO authenticated USING (true);
CREATE POLICY "events_insert" ON events FOR INSERT TO authenticated WITH CHECK (true);
CREATE POLICY "events_update" ON events FOR UPDATE TO authenticated USING (true);
CREATE POLICY "events_delete" ON events FOR DELETE TO authenticated USING (true);
```

### 2. Supabase Storage — bucket `event-images`

- **Visibilité** : publique (les URLs d'images sont accessibles sans auth pour l'affichage)
- **Formats acceptés** : `image/jpeg`, `image/png`
- **Taille max** : 5 Mo
- **Nommage** : `{uuid-event}/{timestamp}-{nom-fichier-sanitizé}.{ext}`
- **À créer via le dashboard Supabase** ou via migration SQL :

```sql
INSERT INTO storage.buckets (id, name, public)
VALUES ('event-images', 'event-images', true);

CREATE POLICY "event_images_read" ON storage.objects
  FOR SELECT USING (bucket_id = 'event-images');

CREATE POLICY "event_images_write" ON storage.objects
  FOR INSERT TO authenticated WITH CHECK (bucket_id = 'event-images');

CREATE POLICY "event_images_delete" ON storage.objects
  FOR DELETE TO authenticated USING (bucket_id = 'event-images');
```

---

## Interface backoffice

### Page liste — `EventsPage.tsx`

**Comportement par défaut :**
- Affiche les événements à venir
  - Critère "à venir" : si `date_fin` est renseignée → `date_fin >= now()` ; sinon → `date_debut >= now()`
- Triés par `date_debut` **ASC** (le prochain en premier)
- Pagination : **10 événements par page**

**Toggle "Voir les événements passés" :**
- Bouton/switch discret en haut de liste
- Quand activé : affiche les événements passés (critère inversé), triés par `date_debut` **DESC**
- Pagination identique (10/page)

**Carte événement — informations affichées :**
- Badge type (coloré selon le type)
- Titre
- Date début (+ date fin si présente)
- Prix (ou "Gratuit")
- 3 actions : **Modifier** | **Dupliquer** | **Supprimer**

**Suppression :**
- Confirmation avant suppression (modale ou `window.confirm`)
- Si `image_url` est renseignée : supprimer aussi le fichier du bucket Supabase Storage

**Duplication :**
- Crée une copie avec :
  - Titre : `"Copie de [titre original]"`
  - Dates : copiées telles quelles
  - Tous les autres champs copiés (y compris `image_url`)
- Redirige immédiatement vers le formulaire d'édition du doublon

**Bouton "Créer un événement" :** en haut à droite → redirige vers `/events/new`

---

### Formulaire création/édition — `EventForm.tsx`

- Création : route `/events/new`
- Édition : route `/events/:id/edit`

**Champs du formulaire :**

| Champ | Composant | Notes |
|---|---|---|
| Type | `<select>` | 5 valeurs de l'enum |
| Titre | `<input type="text">` | |
| Description | Textarea + onglet Aperçu | Voir section Markdown ci-dessous |
| Date début | `<input type="datetime-local">` | |
| Date fin | `<input type="datetime-local">` | Toujours visible ; marqué **obligatoire** si type = "Tournoi" |
| Image | Input file + aperçu + bouton supprimer | JPEG/PNG, max 5 Mo |
| Prix | `<input type="number" min="0" step="0.01">` | Placeholder "Laisser vide si gratuit" |

**Éditeur Markdown (description) :**
- Deux onglets : **Écrire** / **Aperçu**
- L'onglet Aperçu rend le Markdown en HTML via `react-markdown`
- Formatage supporté (à documenter dans le placeholder) : gras `**texte**`, italique `*texte*`, listes `- item`, titres `# Titre`
- Pas d'éditeur WYSIWYG — simple `<textarea>` + preview

**Upload image :**
1. L'utilisateur sélectionne un fichier → aperçu local immédiat via `URL.createObjectURL`
2. À la **soumission** du formulaire (pas avant) : upload vers Supabase Storage → récupère l'URL publique → stocke dans `image_url`
3. Si une image existait (cas édition) : supprimer l'ancienne du bucket avant d'uploader la nouvelle
4. Bouton "Supprimer l'image" : vide le champ et supprime du bucket si déjà uploadée

**Validation côté client (avant soumission) :**
- Afficher les erreurs inline sous chaque champ
- Bloquer si `date_fin` absent et `type === 'Tournoi'`
- Bloquer si `date_fin` < `date_debut`
- Bloquer si fichier image > 5 Mo ou format non supporté
- Si `type === 'Match par équipe'` : bloquer si la liste de matchs est vide ou
  si un match n'a pas de club adverse, date ou heure (cf. `validateTeamMatches`
  dans `EventForm.tsx`)

### Section "Matchs par équipe" (UI)

Visible uniquement si `type === 'Match par équipe'`.

- Conteneur rouge pâle, header "N / 8", bouton "+ Ajouter un match" (désactivé à 8).
- Chaque ligne de match : `MatchRow` avec en-tête live `"{gender} {matchType} · Équipe {teamNumber}"`, badge orange "À compléter" si club adverse / date / heure absents, boutons ↑ ↓ ✕.
- Champs par match : Genre (`Segmented`), Catégorie (`<select>`), Équipe (`NumberPicker` 1·2·3), Club adverse (input texte), Lieu (`Segmented` Au club / Chez l'adversaire), Date (`<input type="date">`), Heure (`<input type="time">`).
- Composants : `src/components/teamMatch/MatchSection.tsx`, `MatchRow.tsx`, `Segmented.tsx`, `NumberPicker.tsx`.

### Section "Générer l'affiche"

Visible uniquement si `type === 'Match par équipe'`.

| État | Bouton | Notes |
|---|---|---|
| `idle` | "Générer l'affiche" (plein rouge) | Désactivé si 0 match |
| `loading` | "Génération en cours…" + spinner | Désactivé |
| `done` | "Régénérer l'affiche" (bordure rouge, fond blanc) | Aperçu 110×156 + lien "Télécharger l'image" + lien "Annuler la génération" |
| `error` | "Réessayer" + message rouge | Bouton réactivé |

**Disponible dès la création** (avant que l'event soit enregistré). Le rendu DOM ne dépend pas de l'`id` Supabase.

**Auto-reset** : si la liste de matchs change après une génération `done`, le status repasse à `idle` et le `dataUrl` est purgé (sinon il serait stale au moment du submit).

**Flux de génération** (à la volée, **sans I/O réseau**) :
1. `html-to-image#toJpeg` sur le composant `TeamMatchImagePreview` monté hors viewport (`position: fixed; left: -99999`)
2. Le `dataUrl` produit est conservé dans le state local (utilisé pour l'aperçu et le téléchargement direct)

**Flux d'upload** (au submit du formulaire — voir `handleSubmit`) :
1. INSERT (si création) ou UPDATE (si édition) du payload de l'event → on récupère l'`id`
2. Si un `generatedDataUrl` est en attente : suppression de l'image actuelle du bucket, conversion data URL → Blob, upload sous `{eventId}/{timestamp}-affiche-matchs.jpg`, UPDATE `image_url`
3. Précédence des sources d'image : **affiche générée > fichier uploadé > suppression > image existante conservée**

**Composant** : `src/components/TeamMatchImagePreview.tsx` (1414 × 2000, variante « Cellule XL », fond `#c8102e` + overlay `/template_event.png`). Chaque rencontre est une cellule à 3 zones (date `#fff5f6` à séparateur dashed · corps `catégorie` > `Équipe N` > `vs adversaire` · lieu plein bandeau rouge `Au club` / noir `Déplacement`). Layout adaptatif selon `matches.length` : `hero` (1 match, centré, typo zoomée), `normal` (2–4), `compact` (5+). Styles injectés via un `<style>` interne scopé `.tmc-poster` (pas de classes Tailwind, 100 % rasterisable). Fonts `'Prompt'` (UI) et `'Anton'` (numéro du jour + « vs »), fallbacks `'Arial Black', Impact`. Template image : `public/template_event.png`.

**Annuler la génération** : purge le `dataUrl` en mémoire. Si aucune autre source d'image n'est sélectionnée, l'image existante (cas édition) est conservée telle quelle.

**Télécharger l'image** : `<a download>` direct sur le `dataUrl`, pas de re-fetch réseau.

---

## Flux JSON (lecture)

> Disponible dès l'implémentation via le client Supabase, consommable par la future webapp.

**Authentification requise** : oui (JWT Supabase). La future webapp devra s'authentifier — le mécanisme exact (utilisateur public dédié ou autre) sera défini lors de l'implémentation webapp.

**Requête type :**
```ts
// Events à venir, triés par date, paginés
const { data } = await supabase
  .from('events')
  .select('*')
  .gte('date_debut', new Date().toISOString())
  .order('date_debut', { ascending: true })
  .range(0, 9);
```

**Format de réponse** : tableau d'objets `ClubEvent`. Le champ `description` est en Markdown brut — la webapp est responsable du rendu HTML.

---

## Arborescence de fichiers à créer

```
src/
  pages/
    EventsPage.tsx       # Page liste avec pagination et toggle passé/à venir
  components/
    EventForm.tsx        # Formulaire création/édition
    EventCard.tsx        # Carte d'un event dans la liste
  types.ts               # Ajouter ClubEvent et EventType (dans le fichier existant)
```

## Routes à ajouter dans `App.tsx`

```tsx
<Route path="/events"          element={auth(<EventsPage />)} />
<Route path="/events/new"      element={auth(<EventForm />)} />
<Route path="/events/:id/edit" element={auth(<EventForm />)} />
```

---

## Dépendances à ajouter

| Package | Usage |
|---|---|
| `react-markdown` | Rendu Markdown dans l'onglet Aperçu du formulaire |

---

## Notes d'implémentation

- Utiliser le client Supabase existant (`src/lib/supabase.ts`) — pas de nouveau client
- Pas de state management global — state local React dans `EventsPage` et `EventForm`
- Pas de `useLocalStorage` pour les events (tout passe par Supabase)
- Avant de commencer : créer la table `events` et le bucket `event-images` dans le dashboard Supabase

---

## Interface PWA

> Consommé par `pwa/src/pages/EventsPage.tsx` et `pwa/src/pages/EventDetailPage.tsx`.

### Policy RLS à ajouter

```sql
CREATE POLICY "events_anon_select"
  ON events FOR SELECT TO anon USING (true);
```

### Requête Supabase (rôle `anon`)

```ts
const { data } = await supabase
  .from('events')
  .select('*')
  .order('date_debut', { ascending: true });
// Filtrer côté client : garder si (date_fin && date_fin >= now) || (!date_fin && date_debut >= now)
```

### Pages

**`EventsPage.tsx`** — uniquement les événements à venir (filtre client sur `date_debut` / `date_fin`), triés par `date_debut` ASC. Chaque carte : badge type coloré, titre, dates, image (si présente), prix (ou "Gratuit"). État vide : "Aucun événement à venir".

**`EventDetailPage.tsx`** — toutes les infos, `description` Markdown rendu via `react-markdown` + `rehype-raw` (pour le `<u>` du MarkdownEditor). Bouton retour vers `/evenements`.

### Badges par type (cohérent avec le BO)

| Type | Couleur |
|---|---|
| Animation | Bleu |
| Tournoi | Violet |
| Match par équipe | Vert |
| Sortie | Orange |
| Soirée | Rose |
