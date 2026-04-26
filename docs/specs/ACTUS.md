# Spec — Module Actus (Back-office)

> Statut : à implémenter
> Dernière mise à jour : 2026-04-26

---

## Objectif

Permettre aux admins de rédiger et publier des actualités du club depuis le back-office.
Les actus publiées sont servies à la PWA CAC Tennis. À terme, une publication vers la page Facebook du club pourra être ajoutée.

---

## Scope

- Module back-office CRUD (liste + formulaire)
- Stockage Supabase (table `actus` + bucket `actu-images`)
- Flux JSON consommé par la PWA (lecture publique via rôle `anon`)

Hors scope v1 : publication automatique sur Facebook.

---

## Modèle de données

### Type TypeScript

```ts
export interface Actu {
  id: string;
  titre: string;
  contenu: string;             // Markdown
  image_url: string | null;
  published: boolean;          // false = brouillon, true = publié
  published_at: string | null; // renseigné à la première publication, jamais écrasé
  created_at: string;
  updated_at: string;
}
```

Ajouter ce type dans `src/types.ts`.

---

## Infrastructure Supabase

### Migration SQL — table `actus`

```sql
CREATE TABLE actus (
  id           UUID        DEFAULT gen_random_uuid() PRIMARY KEY,
  titre        TEXT        NOT NULL,
  contenu      TEXT        NOT NULL,
  image_url    TEXT,
  published    BOOLEAN     NOT NULL DEFAULT false,
  published_at TIMESTAMPTZ,
  created_at   TIMESTAMPTZ DEFAULT now() NOT NULL,
  updated_at   TIMESTAMPTZ DEFAULT now() NOT NULL
);

-- Réutilise la fonction set_updated_at() déjà créée par la migration Events
CREATE TRIGGER actus_updated_at
  BEFORE UPDATE ON actus
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

ALTER TABLE actus ENABLE ROW LEVEL SECURITY;

-- Lecture publique (PWA) : uniquement les actus publiées
CREATE POLICY "actus_anon_select"
  ON actus FOR SELECT TO anon USING (published = true);

-- Lecture admin (BO) : toutes les actus, brouillons inclus
CREATE POLICY "actus_authenticated_select"
  ON actus FOR SELECT TO authenticated USING (true);
CREATE POLICY "actus_insert"
  ON actus FOR INSERT TO authenticated WITH CHECK (true);
CREATE POLICY "actus_update"
  ON actus FOR UPDATE TO authenticated USING (true);
CREATE POLICY "actus_delete"
  ON actus FOR DELETE TO authenticated USING (true);
```

### Storage — bucket `actu-images`

Même configuration que `event-images` (bucket public, JPEG/PNG, max 5 Mo).

```sql
INSERT INTO storage.buckets (id, name, public)
VALUES ('actu-images', 'actu-images', true);

CREATE POLICY "actu_images_read"
  ON storage.objects FOR SELECT USING (bucket_id = 'actu-images');
CREATE POLICY "actu_images_write"
  ON storage.objects FOR INSERT TO authenticated WITH CHECK (bucket_id = 'actu-images');
CREATE POLICY "actu_images_delete"
  ON storage.objects FOR DELETE TO authenticated USING (bucket_id = 'actu-images');
```

---

## Interface back-office

### Intégration dans l'app

- Nouvelle carte sur `AppHomePage` (5ème carte) → label **"Actus"**, description **"Rédiger et publier les actualités du club."**
- Route principale : `/actus`
- Pages : `src/pages/ActusPage.tsx` + `src/components/ActuForm.tsx`

---

### Page liste — `ActusPage.tsx` (`/actus`)

**Affichage :**
- Toutes les actus (publiées + brouillons), triées par `created_at` DESC
- Chaque carte affiche : titre, date de création, badge statut
  - Badge **"Publié"** (vert) si `published = true`
  - Badge **"Brouillon"** (gris) si `published = false`

**Actions sur chaque carte :**
- **Modifier** → `/actus/:id/edit`
- **Publier** (si `published = false`) → passe à `published = true` + renseigne `published_at = now()` **uniquement si `published_at` est null** (conserver la date de première publication)
- **Dépublier** (si `published = true`) → passe à `published = false`, `published_at` inchangé
- **Supprimer** → `window.confirm` → suppression en base + suppression du fichier dans le bucket si `image_url` renseigné

**Bouton "Créer une actu"** : en haut à droite → `/actus/new`

---

### Formulaire — `ActuForm.tsx`

- Création : route `/actus/new`
- Édition : route `/actus/:id/edit`

**Champs :**

| Champ | Composant | Obligatoire | Notes |
|---|---|---|---|
| Titre | `<input type="text">` | Oui | |
| Contenu | Textarea + onglet Aperçu | Oui | Markdown, même pattern que `EventForm` |
| Image | Input file + aperçu + bouton supprimer | Non | JPEG/PNG, max 5 Mo, bucket `actu-images` |

**Upload image :** même comportement que dans `EventForm` :
1. Sélection → aperçu local via `URL.createObjectURL`
2. À la soumission → upload vers bucket `actu-images`, récupère l'URL publique, stocke dans `image_url`
3. Si une image existait (édition) → supprimer l'ancienne avant d'uploader la nouvelle
4. Bouton "Supprimer l'image" → vide le champ + supprime du bucket si déjà uploadée

**Nommage des fichiers dans le bucket** : `{uuid-actu}/{timestamp}-{nom-sanitizé}.{ext}`

**Boutons de soumission (deux boutons distincts) :**
- **"Enregistrer en brouillon"** → sauvegarde avec `published = false`
- **"Publier"** → sauvegarde avec `published = true` + `published_at = now()` si `published_at` est null

**Validation côté client :**
- Titre : non vide
- Contenu : non vide
- Image : JPEG/PNG uniquement, max 5 Mo

---

## Routes à ajouter dans `App.tsx`

```tsx
<Route path="/actus"          element={auth(<ActusPage />)} />
<Route path="/actus/new"      element={auth(<ActuForm />)} />
<Route path="/actus/:id/edit" element={auth(<ActuForm />)} />
```

---

## Arborescence de fichiers à créer

```
src/
  pages/
    ActusPage.tsx       # Liste avec badge brouillon/publié, actions publier/dépublier/supprimer
  components/
    ActuForm.tsx        # Formulaire création/édition avec upload image et deux boutons de soumission
  types.ts              # Ajouter interface Actu (dans le fichier existant)
```

---

## Notes d'implémentation

- Utiliser le client Supabase existant (`src/lib/supabase.ts`)
- Pas de state management global — state local React dans chaque composant
- Réutiliser les patterns de `EventForm.tsx` pour l'upload image (même logique bucket)
- Avant de commencer : exécuter la migration SQL ci-dessus dans le dashboard Supabase

---

## Évolutions futures

- Bouton **"Publier sur Facebook"** dans le formulaire : déclenche un appel à l'API Facebook Graph via une Supabase Edge Function (le Page Access Token reste côté serveur, jamais exposé dans le client)
