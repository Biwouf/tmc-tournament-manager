# Spec — Module Actus (Back-office)

> Statut : implémenté
> Dernière mise à jour : 2026-05-06

---

## Objectif

Permettre aux admins de rédiger et publier des actualités du club depuis le back-office.
Les actus publiées sont servies à la PWA CAC Tennis. À terme, une publication vers la page Facebook du club pourra être ajoutée.

---

## Scope

- Module back-office CRUD (liste + formulaire)
- Stockage Supabase (table `actus` + bucket `actu-images`)
- **Multi-images** : 0..N images facultatives par actu
- Flux JSON consommé par la PWA (lecture publique via rôle `anon`, uniquement les actus publiées)

Hors scope v1 : publication automatique sur Facebook.

---

## Modèle de données

### Type TypeScript (`src/types.ts`)

```ts
export interface ActuFocalPoint {
  x: number; // 0–100
  y: number; // 0–100
}

export interface Actu {
  id: string;
  titre: string;
  contenu: string;             // Markdown
  image_urls: string[];        // 0..N images
  image_focal_points: (ActuFocalPoint | null)[]; // tableau parallèle à image_urls
  published: boolean;          // false = brouillon, true = publié
  published_at: string | null; // première publication, jamais écrasé
  created_at: string;
  updated_at: string;
}
```

`image_focal_points[i]` correspond à `image_urls[i]`. Chaque entrée est soit `null` (centre par défaut 50/50), soit `{ x, y }` en pourcentages 0–100.

---

## Infrastructure Supabase

Migration : `supabase/migrations/20260426_actus.sql`.

### Table `actus`

```sql
CREATE TABLE actus (
  id                   UUID        DEFAULT gen_random_uuid() PRIMARY KEY,
  titre                TEXT        NOT NULL,
  contenu              TEXT        NOT NULL,
  image_urls           TEXT[]      NOT NULL DEFAULT '{}',
  image_focal_points   JSONB       NOT NULL DEFAULT '[]'::jsonb, -- patch 20260506
  published            BOOLEAN     NOT NULL DEFAULT false,
  published_at         TIMESTAMPTZ,
  created_at           TIMESTAMPTZ DEFAULT now() NOT NULL,
  updated_at           TIMESTAMPTZ DEFAULT now() NOT NULL
);
```

- Trigger `actus_updated_at` réutilise `set_updated_at()` créée par la migration Events.
- RLS activé.

### Policies RLS

- `actus_anon_select` : lecture publique des actus `published = true` (PWA).
- `actus_authenticated_select / insert / update / delete` : full access pour l'admin BO.

### Storage — bucket `actu-images`

Bucket public, JPEG/PNG, max 5 Mo (validation côté client).

- `actu_images_read` : lecture publique
- `actu_images_write` : insert pour `authenticated`
- `actu_images_delete` : delete pour `authenticated`

Nommage des fichiers : `{actu-id}/{timestamp}-{index}-{nom-sanitizé}.{ext}`.

---

## Interface back-office

### Intégration dans l'app

- 5ème carte sur `AppHomePage` → label **« Actus »**, description **« Rédiger et publier les actualités du club. »**
- Route principale : `/actus`
- Pages : `src/pages/ActusPage.tsx` + `src/components/ActuForm.tsx`

---

### Page liste — `ActusPage.tsx` (`/actus`)

**Affichage :**
- Toutes les actus (publiées + brouillons), triées par `created_at` DESC
- Chaque carte affiche : titre, date de création, badge statut, nombre d'images si > 0
  - Badge **« Publié »** (vert) si `published = true`
  - Badge **« Brouillon »** (gris) si `published = false`

**Actions sur chaque carte :**
- **Modifier** → `/actus/:id/edit`
- **Publier** (si `published = false`) → `published = true` ; renseigne `published_at = now()` **uniquement si `published_at` est null** (conserve la date de première publication)
- **Dépublier** (si `published = true`) → `published = false` ; `published_at` inchangé
- **Supprimer** → `window.confirm` → suppression en base + suppression de toutes les images du bucket (`image_urls`)

**Bouton « Créer une actu »** : en haut à droite → `/actus/new`.

---

### Formulaire — `ActuForm.tsx`

- Création : route `/actus/new`
- Édition : route `/actus/:id/edit`

**Champs :**

| Champ | Composant | Obligatoire | Notes |
|---|---|---|---|
| Titre | `<input type="text">` | Oui | |
| Contenu | Textarea + onglet Aperçu | Oui | Markdown, même pattern que `EventForm` |
| Images | Input file multiple + grille d'aperçus + bouton retirer + clic pour définir le point de focus | Non (0..N) | JPEG/PNG, max 5 Mo / fichier, bucket `actu-images` |

**Gestion des images (multi) :**

- Sélection multiple via input file (`multiple`).
- Aperçus :
  - Images existantes (édition) : récupérées depuis `image_urls`, marquables pour suppression.
  - Nouveaux fichiers : aperçu local via `URL.createObjectURL`, badge « Nouveau ».
- Bouton **« Retirer »** par image :
  - Sur image existante → marque pour suppression du bucket à la sauvegarde.
  - Sur nouveau fichier → retire de la sélection avant upload.
- **Point de focus par image** : chaque aperçu est cliquable (overlay `cursor-crosshair`). Le clic met à jour le focal point de l'image (coordonnées en pourcentages 0–100 par rapport au cadre de prévisualisation), un marqueur le matérialise et l'image est rendue en preview avec `object-position: x% y%`. Valeur par défaut à l'ajout : `{ x: 50, y: 50 }`. Les images existantes sans focal point en base sont initialisées à 50/50 dans l'état local.
- À la soumission :
  1. Upsert de l'actu (sans toucher `image_urls` ni `image_focal_points`).
  2. Suppression dans le bucket des images marquées.
  3. Upload des nouveaux fichiers.
  4. Update de `image_urls` + `image_focal_points` avec les listes finales (existantes restantes + nouvelles uploadées, dans le même ordre).

**Boutons de soumission :**
- **« Enregistrer en brouillon »** → `published = false`.
- **« Publier »** → `published = true` + `published_at = now()` si `published_at` est null.

**Validation côté client :**
- Titre : non vide.
- Contenu : non vide.
- Chaque image : JPEG/PNG, max 5 Mo (les fichiers invalides sont ignorés et un message d'erreur s'affiche).

---

## Routes (App.tsx)

```tsx
<Route path="/actus"          element={auth(<ActusPage />)} />
<Route path="/actus/new"      element={auth(<ActuForm />)} />
<Route path="/actus/:id/edit" element={auth(<ActuForm />)} />
```

---

## Fichiers livrés

```
src/
  pages/ActusPage.tsx       # Liste + badge brouillon/publié, actions publier/dépublier/supprimer
  components/ActuForm.tsx   # Formulaire création/édition + multi-images + focal point
  types.ts                  # Interfaces Actu, ActuFocalPoint
supabase/migrations/
  20260426_actus.sql                # Table + RLS + bucket + policies
  20260506_actus_focal_points.sql   # Ajout colonne image_focal_points (JSONB[])
```

---

## Feature : Focal Point

> Scope : backoffice (`ActuForm.tsx`) + PWA (`ActuCard`, `ActuDetailPage`)
> Approche : focal point CSS — stockage de coordonnées x/y, rendu via `object-position`

### Problème

Les images uploadées sont affichées avec `object-fit: cover` dans la PWA. Sans indication de point d'intérêt, le navigateur centre l'image par défaut, ce qui tronque les sujets décalés (visages en bord de cadre, texte en bas, etc.). Le problème est accentué sur la vue liste (miniatures format paysage ou carré).

### Approche retenue

Pas de recadrage de l'image originale. On stocke `{ x, y }` (pourcentages 0–100) par image et on l'applique via `object-position: {x}% {y}%`. Aucun re-upload, l'image originale est conservée intacte dans le bucket.

### Backoffice — `ActuForm.tsx`

Chaque aperçu d'image dans la grille contient :

1. **L'image** avec `object-fit: cover` + `object-position: {x}% {y}%` (preview en temps réel)
2. **Un overlay cliquable** (position absolute, `cursor: crosshair`) — au clic : `x = (e.offsetX / imgWidth) * 100`, `y = (e.offsetY / imgHeight) * 100`
3. **Un marqueur** (cercle 12px, `mix-blend-mode: difference`) positionné aux coordonnées actuelles
4. **Label discret** `"Point de focus"` pour signaler la fonctionnalité

État local : `DEFAULT_FOCAL_POINT = { x: 50, y: 50 }` à l'ajout d'une image. Les actus existantes sans focal point sont initialisées à 50/50 dans l'état local.

L'overlay ne doit pas interférer avec le bouton "Retirer" existant. Le désactiver si l'image est en cours de chargement.

### Contraintes de synchronisation

- `image_focal_points` et `image_urls` doivent rester en sync.
- Retrait d'une image à l'index `i` → retirer aussi `image_focal_points[i]`.
- Ajout d'une image → push `{ x: 50, y: 50 }` dans focal_points.

### Hors scope v1

- Crop manuel de l'image.
- Focal point sur les images d'événements (`EventForm`).
- Migration des actus existantes (le fallback `50% 50%` suffit).

---

## Interface PWA

> Consommé par `pwa/src/pages/ActusPage.tsx` et `pwa/src/pages/ActuDetailPage.tsx`.

### Type TypeScript (`pwa/src/types.ts`)

Synchroniser avec `src/types.ts` :

```ts
export interface ActuFocalPoint { x: number; y: number; }

export interface Actu {
  id: string;
  titre: string;
  contenu: string;
  image_urls: string[];
  image_focal_points: (ActuFocalPoint | null)[];
  published: boolean;
  published_at: string | null;
  created_at: string;
  updated_at: string;
}
```

### Requête Supabase (rôle `anon`)

```ts
const { data } = await supabase
  .from('actus')
  .select('*')
  .eq('published', true)
  .order('published_at', { ascending: false })
  .range(offset, offset + 9);
```

### Pages

**`ActusPage.tsx`** — flux vertical paginé (load more) par `published_at` DESC. Chaque carte : image, titre, extrait 2-3 lignes tronqué, date de publication formatée. État vide : "Aucune actualité pour l'instant".

**`ActuDetailPage.tsx`** — titre, image full-width, date, contenu Markdown rendu via `react-markdown` + `rehype-raw` (pour le rendu `<u>` inséré par le MarkdownEditor). Bouton retour vers `/actus`.

### Focal point (helper partagé)

```ts
// pwa/src/utils/focalPoint.ts
export function focalPointStyle(fp: ActuFocalPoint | null | undefined): React.CSSProperties {
  if (!fp) return { objectPosition: '50% 50%' };
  return { objectPosition: `${fp.x}% ${fp.y}%` };
}
```

Appliquer sur chaque `<img>` dans `ActuCard.tsx` et `ActuDetailPage.tsx` :

```tsx
<img
  src={actu.image_urls[i]}
  style={{ objectFit: 'cover', ...focalPointStyle(actu.image_focal_points?.[i]) }}
/>
```

Les actus sans `image_focal_points` (existantes avant la migration) sont gérées par le `?.` guard + le fallback `50% 50%`.

---

## Évolutions futures

- Bouton **« Publier sur Facebook »** dans le formulaire : déclenche un appel à l'API Facebook Graph via une Supabase Edge Function (le Page Access Token reste côté serveur, jamais exposé dans le client).
