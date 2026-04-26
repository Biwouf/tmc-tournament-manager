# Spec — Module Actus (Back-office)

> Statut : implémenté
> Dernière mise à jour : 2026-04-26

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
export interface Actu {
  id: string;
  titre: string;
  contenu: string;             // Markdown
  image_urls: string[];        // 0..N images
  published: boolean;          // false = brouillon, true = publié
  published_at: string | null; // première publication, jamais écrasé
  created_at: string;
  updated_at: string;
}
```

---

## Infrastructure Supabase

Migration : `supabase/migrations/20260426_actus.sql`.

### Table `actus`

```sql
CREATE TABLE actus (
  id           UUID        DEFAULT gen_random_uuid() PRIMARY KEY,
  titre        TEXT        NOT NULL,
  contenu      TEXT        NOT NULL,
  image_urls   TEXT[]      NOT NULL DEFAULT '{}',
  published    BOOLEAN     NOT NULL DEFAULT false,
  published_at TIMESTAMPTZ,
  created_at   TIMESTAMPTZ DEFAULT now() NOT NULL,
  updated_at   TIMESTAMPTZ DEFAULT now() NOT NULL
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
| Images | Input file multiple + grille d'aperçus + bouton retirer par image | Non (0..N) | JPEG/PNG, max 5 Mo / fichier, bucket `actu-images` |

**Gestion des images (multi) :**

- Sélection multiple via input file (`multiple`).
- Aperçus :
  - Images existantes (édition) : récupérées depuis `image_urls`, marquables pour suppression.
  - Nouveaux fichiers : aperçu local via `URL.createObjectURL`, badge « Nouveau ».
- Bouton **« Retirer »** par image :
  - Sur image existante → marque pour suppression du bucket à la sauvegarde.
  - Sur nouveau fichier → retire de la sélection avant upload.
- À la soumission :
  1. Upsert de l'actu (sans toucher `image_urls`).
  2. Suppression dans le bucket des images marquées.
  3. Upload des nouveaux fichiers.
  4. Update de `image_urls` avec la liste finale (existantes restantes + nouvelles uploadées, dans l'ordre).

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
  components/ActuForm.tsx   # Formulaire création/édition + multi-images
  types.ts                  # Interface Actu
supabase/migrations/
  20260426_actus.sql        # Table + RLS + bucket + policies
```

---

## Évolutions futures

- Bouton **« Publier sur Facebook »** dans le formulaire : déclenche un appel à l'API Facebook Graph via une Supabase Edge Function (le Page Access Token reste côté serveur, jamais exposé dans le client).
