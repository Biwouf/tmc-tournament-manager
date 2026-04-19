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
  created_at: string;          // Géré par Supabase
  updated_at: string;          // Géré par Supabase (trigger)
}
```

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
