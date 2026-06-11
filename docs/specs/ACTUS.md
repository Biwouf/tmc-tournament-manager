# Spec — Module Actus

> Statut : implémenté
> Dernière mise à jour : 2026-06-03

---

## Objectif

Permettre aux admins de rédiger et publier des actualités du club depuis le back-office.
Les actus publiées sont servies à la PWA CAC Tennis. Une publication vers la page Facebook du club est disponible depuis le formulaire.

---

## Scope

- Module back-office CRUD (liste + formulaire)
- Stockage Supabase (table `actus` + bucket `actu-images`)
- **Multi-images** : 0..N images facultatives par actu, avec point de focus et légende Facebook par image
- Flux JSON consommé par la PWA (lecture publique via rôle `anon`, uniquement les actus publiées)
- Publication optionnelle vers la page Facebook du club (Supabase Edge Function `post-to-facebook`)

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
  image_captions: string[];    // tableau parallèle à image_urls (légendes Facebook)
  published: boolean;          // false = brouillon, true = publié
  published_at: string | null; // première publication, jamais écrasé
  created_at: string;
  updated_at: string;
}
```

`image_focal_points[i]` correspond à `image_urls[i]`. Chaque entrée est soit `null` (centre par défaut 50/50), soit `{ x, y }` en pourcentages 0–100.

`image_captions[i]` correspond à `image_urls[i]`. Une chaîne vide `""` = pas de légende envoyée à Facebook.

---

## Infrastructure Supabase

### Migrations

- `supabase/migrations/2026042601_actus.sql` — table + RLS + bucket
- `supabase/migrations/20260506_actus_focal_points.sql` — colonne `image_focal_points` (JSONB)
- `supabase/migrations/YYYYMMDD_actus_image_captions.sql` — colonne `image_captions` (TEXT[])

### Table `actus`

```sql
CREATE TABLE actus (
  id                   UUID        DEFAULT gen_random_uuid() PRIMARY KEY,
  titre                TEXT        NOT NULL,
  contenu              TEXT        NOT NULL,
  image_urls           TEXT[]      NOT NULL DEFAULT '{}',
  image_focal_points   JSONB       NOT NULL DEFAULT '[]'::jsonb,
  image_captions       TEXT[]      NOT NULL DEFAULT '{}',
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

### Routes (`App.tsx`)

```tsx
<Route path="/actus"          element={auth(<ActusPage />)} />
<Route path="/actus/new"      element={auth(<ActuForm />)} />
<Route path="/actus/:id/edit" element={auth(<ActuForm />)} />
```

---

### Page liste — `ActusPage.tsx` (`/actus`)

**Affichage :**
- Toutes les actus (publiées + brouillons), triées par `created_at` DESC
- Chaque carte affiche : titre, date de création, badge statut, nombre d'images si > 0
  - Badge **« Publié »** (vert) si `published = true`
  - Badge **« Brouillon »** (gris) si `published = false`

**Actions sur chaque carte :**
- **Modifier** → `/actus/:id/edit`
- **Publier** (si `published = false`) → `published = true` ; renseigne `published_at = now()` **uniquement si `published_at` est null**
- **Dépublier** (si `published = true`) → `published = false` ; `published_at` inchangé
- **Supprimer** → `window.confirm` → suppression en base + suppression de toutes les images du bucket

**Bouton « Créer une actu »** : en haut à droite → `/actus/new`.

---

### Formulaire — `ActuForm.tsx`

- Création : route `/actus/new`
- Édition : route `/actus/:id/edit`

**Champs :**

| Champ | Composant | Obligatoire | Notes |
|---|---|---|---|
| Titre | `<input type="text">` | Oui | |
| Contenu | `MarkdownEditor` | Oui | Markdown |
| Images | Input file multiple + grille d'aperçus + bouton retirer + focal point + légende Facebook | Non (0..N) | JPEG/PNG, max 5 Mo |

**Gestion des images (multi) :**

- Sélection multiple via input file (`multiple`).
- Aperçus : images existantes (marquables pour suppression) + nouveaux fichiers (badge « Nouveau »).
- Bouton **« Retirer »** par image.
- **Point de focus** : overlay cliquable `cursor-crosshair`, marqueur, preview `object-position: x% y%`. Valeur par défaut : `{ x: 50, y: 50 }`.
- **Légende Facebook** : `<textarea>` 2-3 lignes sous chaque vignette, placeholder « Légende Facebook (optionnelle) », hint « Visible uniquement quand l'image est ouverte en plein écran sur Facebook ». Lié à un état parallèle `image_captions`.
- À la soumission :
  1. Upsert de l'actu (sans toucher `image_urls`, `image_focal_points`, `image_captions`).
  2. Suppression dans le bucket des images marquées.
  3. Upload des nouveaux fichiers.
  4. Update de `image_urls` + `image_focal_points` + `image_captions` avec les listes finales.

**Validation côté client :**
- Titre : non vide.
- Contenu : non vide.
- Chaque image : JPEG/PNG, max 5 Mo.

**Boutons de soumission :**
- **« Enregistrer en brouillon »** → `published = false`.
- **« Publier »** → `published = true` + `published_at = now()` si `published_at` est null.

**Options de publication Facebook** (bloc visible en permanence, désactivé si `published = true`) :

```
☐  Publier aussi sur Facebook
   └─ (visible uniquement si la case ci-dessus est cochée)
      ☐  Mode debug (post caché — visible uniquement par les admins de la page)
```

- Les deux cases sont décochées par défaut ; ignorées si on clique « Enregistrer en brouillon ».
- Flux à la soumission ("Publier") :
  1. Sauvegarde normale de l'actu (flux existant inchangé).
  2. Si « Publier aussi sur Facebook » coché : appel à l'Edge Function `post-to-facebook` avec `{ actu_id, debug }`.
  3. Affichage d'un état de chargement inline, puis message vert (lien vers le post) ou rouge (erreur détaillée).
  4. Navigation vers `/actus` seulement après le retour de l'Edge Function.

---

## Feature : Focal Point

> Approche : focal point CSS — stockage de coordonnées x/y, rendu via `object-position`

### Backoffice — `ActuForm.tsx`

Chaque aperçu contient :
1. L'image avec `object-fit: cover` + `object-position: {x}% {y}%`
2. Un overlay cliquable `cursor: crosshair` — clic : `x = (e.offsetX / imgWidth) * 100`, idem Y
3. Un marqueur (cercle 12px, `mix-blend-mode: difference`)
4. Label discret `"Point de focus"`

`DEFAULT_FOCAL_POINT = { x: 50, y: 50 }`. Actus existantes sans focal point initialisées à 50/50 localement.

### Contraintes de synchronisation

- `image_focal_points`, `image_urls` et `image_captions` doivent rester en sync.
- Retrait à l'index `i` → retirer aussi `image_focal_points[i]` et `image_captions[i]`.
- Ajout → push `{ x: 50, y: 50 }` dans focal_points, `""` dans captions.

---

## Supabase Edge Function — `post-to-facebook`

### Fichier

`supabase/functions/post-to-facebook/index.ts`

### Variables d'environnement (Supabase Secrets)

| Clé | Valeur |
|---|---|
| `FACEBOOK_PAGE_ID` | ID numérique de la page Facebook |
| `FACEBOOK_PAGE_ACCESS_TOKEN` | Page Access Token longue durée |

### Input (POST body JSON)

```ts
{ actu_id: string; debug: boolean; }
```

### Authentification

L'Edge Function vérifie `Authorization: Bearer {supabase_jwt}`. Rejeter avec 401 si absent.

### Algorithme

**1.** Récupérer l'actu :
```ts
const { data: actu } = await supabaseAdmin
  .from('actus')
  .select('titre, contenu, image_urls, image_captions')
  .eq('id', actu_id)
  .single();
```

**2.** Construire le message texte — seul `contenu` est envoyé, dépouillé du Markdown (images inline, HTML, marqueurs MD). Conserver les sauts de ligne.

**3.** Collecter toutes les images :
- Sources : `actu.image_urls` + images inline extraites du contenu Markdown via `/!\[.*?\]\((https?:\/\/[^)]+)\)/g`
- Dédupliquer (conserver l'ordre).

**4.** Construire une `Map<url, caption>` :
1. `image_captions[i]` pour les URLs de `image_urls` (saisie BO).
2. Texte alternatif des images inline Markdown `![alt](url)`.

**5.** Uploader les images sur Facebook :
```
POST https://graph.facebook.com/v19.0/me/photos
  ?published=false&url={image_url}&caption={caption}&access_token=...
```
Ajouter `caption` uniquement si non vide. En cas d'échec → stopper et renvoyer l'erreur.

**6.** Créer le post :
```json
POST https://graph.facebook.com/v19.0/me/feed
{
  "message": "{message texte}",
  "published": !debug,
  "attached_media": [{ "media_fbid": "..." }, ...],
  "access_token": "..."
}
```
Si aucune image : omettre `attached_media`.

> Note : utiliser `/me/` (pas `/{page_id}/`) avec un Page Access Token — contourne le bug FB `(#200) Unpublished posts must be posted to a page as the page itself`.

### Réponse

Succès : `{ "success": true, "post_id": "...", "post_url": "https://www.facebook.com/{page_id}/posts/{post_id}" }`
Erreur : `{ "success": false, "error": "...", "detail": { ... } }`

### Gestion des erreurs

| Cas | Message |
|---|---|
| Actu introuvable | `"Actu introuvable (id: {actu_id})"` |
| Non authentifié | `"Erreur d'authentification — reconnectez-vous."` |
| Échec upload image | `"Erreur lors de l'upload de l'image {url} : {msg} (code {code})"` |
| Échec création post | `"Erreur lors de la création du post Facebook : {msg} (code {code})"` |
| Token expiré (code 190) | `"Le token Facebook a expiré — veuillez le renouveler dans les variables d'environnement Supabase."` |
| Erreur réseau | `"Erreur réseau lors de la communication avec Facebook."` |

### Mode debug

Quand `debug = true` : le post Facebook est créé avec `published: false` (visible uniquement par les admins de la page). Le message de succès BO précise : `"Post publié en mode caché (visible uniquement par les admins de la page)."`.

---

## Interface PWA

> Consommé par `pwa/src/pages/ActusPage.tsx` et `pwa/src/pages/ActuDetailPage.tsx`.

### Type TypeScript (`pwa/src/types.ts`)

```ts
export interface ActuFocalPoint { x: number; y: number; }

export interface Actu {
  id: string;
  titre: string;
  contenu: string;
  image_urls: string[];
  image_focal_points: (ActuFocalPoint | null)[];
  image_captions: string[];
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

**`ActusPage.tsx`** — flux vertical paginé (load more) par `published_at` DESC. Chaque carte : image, titre, extrait 2-3 lignes, date de publication. État vide : "Aucune actualité pour l'instant".

**`ActuDetailPage.tsx`** — titre, image full-width, date, contenu Markdown rendu via `react-markdown` + `rehype-raw`. Bouton retour vers `/actus`.

### Focal point (helper partagé)

```ts
// pwa/src/utils/focalPoint.ts
export function focalPointStyle(fp: ActuFocalPoint | null | undefined): React.CSSProperties {
  if (!fp) return { objectPosition: '50% 50%' };
  return { objectPosition: `${fp.x}% ${fp.y}%` };
}
```

```tsx
<img
  src={actu.image_urls[i]}
  style={{ objectFit: 'cover', ...focalPointStyle(actu.image_focal_points?.[i]) }}
/>
```

---

## Fichiers

```
src/
  pages/ActusPage.tsx
  components/ActuForm.tsx
  types.ts

pwa/src/
  pages/ActusPage.tsx
  pages/ActuDetailPage.tsx
  components/actus/ActuCard.tsx
  utils/focalPoint.ts
  types.ts

supabase/
  migrations/
    2026042601_actus.sql
    20260506_actus_focal_points.sql
    YYYYMMDD_actus_image_captions.sql
  functions/
    post-to-facebook/index.ts
```

---

## Notes d'implémentation

- API Graph Facebook version `v19.0` (constante centralisée).
- `supabaseAdmin` dans l'Edge Function utilise la `SERVICE_ROLE_KEY` (auto via `Deno.env`).
- Ne pas stocker le `post_id` Facebook en base (hors scope).
- La sauvegarde doit précéder l'appel à l'Edge Function (besoin de l'UUID).
- `image_captions` n'est pas affiché côté PWA ni en consultation BO — uniquement métadonnée Facebook.

---

## Évolutions futures

- Republication / suppression d'un post Facebook existant.
- Analytics Facebook.
- Publication automatique sans action manuelle.
