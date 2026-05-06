# Brief — Point de focus sur les images d'actus

> Scope : backoffice (`ActuForm.tsx`) + PWA (`ActuCard`, `ActuDetailPage`)
> Approche : focal point (pas de crop) — stockage de coordonnées x/y, rendu via CSS `object-position`

---

## Problème

Les images uploadées pour les actus sont affichées avec `object-fit: cover` dans la PWA.
Sans indication de point d'intérêt, le navigateur centre l'image par défaut, ce qui tronque
les sujets décalés (visages en bord de cadre, texte en bas, etc.).
Le problème est accentué sur la vue liste où les images sont affichées en miniature (format paysage ou carré).

---

## Approche retenue : focal point CSS

Pas de recadrage de l'image originale. On stocke un point de focus `{ x, y }` (pourcentages 0–100)
par image, et on l'applique côté affichage via `object-position: {x}% {y}%`.

Avantages :
- Aucun re-upload ou traitement d'image côté serveur.
- L'image originale est conservée intacte dans le bucket.
- La PWA applique le point de focus en pur CSS, sans logique supplémentaire.

---

## 1. Migration Supabase

Fichier : `supabase/migrations/20260506_actus_focal_points.sql`

```sql
ALTER TABLE actus
  ADD COLUMN IF NOT EXISTS image_focal_points JSONB NOT NULL DEFAULT '[]';
```

`image_focal_points` est un tableau parallèle à `image_urls` :
- `image_focal_points[i]` correspond à `image_urls[i]`
- Chaque élément est soit `null` (→ centre par défaut, 50/50), soit `{ "x": number, "y": number }` (valeurs 0–100)
- Tableau vide `[]` = pas d'images → aucun focal point à appliquer

---

## 2. Mise à jour des types TypeScript

### `src/types.ts` (BO) et `pwa/src/types.ts` (PWA) — à modifier en parallèle

```ts
export interface ActuFocalPoint {
  x: number; // 0–100
  y: number; // 0–100
}

export interface Actu {
  id: string;
  titre: string;
  contenu: string;
  image_urls: string[];
  image_focal_points: (ActuFocalPoint | null)[]; // parallel array, même longueur que image_urls
  published: boolean;
  published_at: string | null;
  created_at: string;
  updated_at: string;
}
```

---

## 3. Backoffice — `ActuForm.tsx`

### Principe

Chaque image dans la grille d'aperçus dispose d'une **interface de sélection du point de focus**.
L'utilisateur clique sur l'image pour définir le centre d'intérêt.
Un marqueur visuel (croix ou point) indique le focal point actuel.

### État local

Ajouter un état parallèle à la liste d'images :

```ts
// Valeur par défaut à l'ajout d'une image
const DEFAULT_FOCAL_POINT: ActuFocalPoint = { x: 50, y: 50 };
```

Lors du chargement d'une actu existante en édition :
- Si `image_focal_points[i]` est `null` ou absent → initialiser à `{ x: 50, y: 50 }` dans l'état local.

### UI par image dans la grille

Chaque aperçu d'image contient :

1. **L'image elle-même** avec `object-fit: cover` + `object-position: {x}% {y}%` (preview en temps réel du focal point)
2. **Un overlay cliquable** (position absolute, couvrant toute l'image, cursor crosshair)
   - Au clic → calculer `x = (e.offsetX / imgWidth) * 100` et `y = (e.offsetY / imgHeight) * 100`
   - Mettre à jour le focal point de cette image dans l'état local
3. **Un marqueur** (petit cercle blanc avec bordure sombre, 12px, position absolute) positionné aux coordonnées `x%` / `y%`
4. **Label discret** sous ou sur l'image : `"Point de focus"` pour signaler la fonctionnalité

L'overlay ne doit pas interférer avec le bouton "Retirer" existant.

### Soumission

Lors de la sauvegarde (brouillon ou publier), `image_focal_points` est inclus dans l'upsert Supabase.

La liste est reconstruite dans le même ordre que `image_urls` final (après suppression des images retirées et ajout des nouvelles images uploadées). Les nouvelles images reçoivent la valeur saisie dans l'état local (ou `{ x: 50, y: 50 }` si l'utilisateur n'a pas cliqué).

---

## 4. PWA — consommation du focal point

### Helper partagé (à créer dans `pwa/src/`)

```ts
// pwa/src/utils/focalPoint.ts
import { ActuFocalPoint } from '../types';

export function focalPointStyle(fp: ActuFocalPoint | null | undefined): React.CSSProperties {
  if (!fp) return { objectPosition: '50% 50%' };
  return { objectPosition: `${fp.x}% ${fp.y}%` };
}
```

### `ActuCard.tsx` (vue liste — priorité)

L'image de la carte est affichée avec :
```tsx
<img
  src={actu.image_urls[0]}
  style={{ objectFit: 'cover', ...focalPointStyle(actu.image_focal_points?.[0]) }}
  ...
/>
```

### `ActuDetailPage.tsx` (vue détail)

Si l'actu a plusieurs images (galerie ou image principale full-width) :
```tsx
<img
  src={actu.image_urls[i]}
  style={{ objectFit: 'cover', ...focalPointStyle(actu.image_focal_points?.[i]) }}
  ...
/>
```

### Rétrocompatibilité

Les actus existantes n'ont pas de `image_focal_points`. Le `?.` guard + la valeur par défaut `50% 50%`
dans le helper gèrent ce cas sans nécessiter de migration de données.

---

## 5. Fichiers à modifier

| Fichier | Changement |
|---|---|
| `supabase/migrations/20260506_actus_focal_points.sql` | **Nouveau** — `ALTER TABLE actus ADD COLUMN image_focal_points` |
| `src/types.ts` | Ajout `ActuFocalPoint`, mise à jour `Actu` |
| `src/components/ActuForm.tsx` | Ajout état focal points, overlay cliquable, soumission |
| `pwa/src/types.ts` | Même ajout que `src/types.ts` |
| `pwa/src/utils/focalPoint.ts` | **Nouveau** — helper `focalPointStyle()` |
| `pwa/src/components/actus/ActuCard.tsx` | Appliquer `focalPointStyle` sur l'image |
| `pwa/src/pages/ActuDetailPage.tsx` | Appliquer `focalPointStyle` sur les images |

---

## 6. Ce qui est hors scope (v1)

- Crop manuel de l'image (à envisager en v2 si le focal point ne suffit pas).
- Focal point sur les images d'événements (`EventForm`).
- Migration des actus existantes (le fallback `50% 50%` est suffisant).

---

## Contraintes et points d'attention

- `image_focal_points` et `image_urls` doivent rester en sync. Lors du retrait d'une image à l'index `i`, retirer aussi `image_focal_points[i]`. Lors de l'ajout, push `{ x: 50, y: 50 }`.
- L'overlay cliquable doit être désactivé si l'image est en cours de chargement (éviter un clic sur une image non encore rendue à sa taille réelle).
- Le marqueur doit rester visible quel que soit le fond de l'image → utiliser `mix-blend-mode: difference` ou une bordure blanche + sombre.
