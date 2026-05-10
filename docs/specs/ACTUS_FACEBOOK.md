# Spec — Publication Facebook depuis le module Actus

> Statut : implémenté
> Dernière mise à jour : 2026-05-09

---

## Objectif

Permettre à l'admin de cocher une option dans `ActuForm` pour publier simultanément une actu sur la page Facebook du club, au moment de la publication BO. La publication passe par une Supabase Edge Function — le Page Access Token ne transite jamais dans le client.

---

## Scope

- Nouvelle UI dans `ActuForm.tsx` (checkbox + retour d'état)
- Nouvelle Supabase Edge Function `post-to-facebook`
- Variables d'environnement Supabase (secrets)

Hors scope : publication automatique sans action manuelle, republication / suppression d'un post Facebook existant, analytics Facebook.

---

## Variables d'environnement

À ajouter dans les **Supabase Secrets** (Dashboard → Settings → Edge Functions → Secrets) :

| Clé | Valeur |
|---|---|
| `FACEBOOK_PAGE_ID` | ID numérique de la page Facebook |
| `FACEBOOK_PAGE_ACCESS_TOKEN` | Page Access Token longue durée |

Ces deux valeurs ne sont jamais exposées au client.

---

## Interface back-office — `ActuForm.tsx`

### Nouvelles options de publication

Sous les boutons « Enregistrer en brouillon » / « Publier », ajouter un bloc conditionnel visible **uniquement quand l'utilisateur s'apprête à cliquer sur « Publier »** (i.e. toujours visible dans le formulaire, mais les options ne sont actionnables que dans le contexte de publication).

En pratique : afficher ce bloc en permanence dans le formulaire mais le désactiver si `published` est déjà `true` (l'actu est déjà publiée — on ne re-poste pas automatiquement).

```
☐  Publier aussi sur Facebook
   └─ (visible uniquement si la case ci-dessus est cochée)
      ☐  Mode debug (post caché — visible uniquement par les admins de la page)
```

- Les deux cases sont **décochées par défaut**.
- La case "Mode debug" n'est affichée que si "Publier aussi sur Facebook" est cochée.
- Ces options sont ignorées si l'utilisateur clique sur "Enregistrer en brouillon".

### Flux à la soumission ("Publier")

1. Sauvegarde normale de l'actu (upload images Supabase, upsert en base) — flux existant inchangé.
2. Si "Publier aussi sur Facebook" est coché :
   - Appel à l'Edge Function `post-to-facebook` avec `{ actu_id, debug }`.
   - Afficher un état de chargement inline ("Publication sur Facebook…").
   - **Succès** : afficher un message vert avec un lien vers le post Facebook (`https://www.facebook.com/{page_id}/posts/{post_id}`).
   - **Erreur** : afficher un message rouge avec le détail complet de l'erreur (voir section Gestion des erreurs).
3. La navigation post-publication (`/actus`) ne se fait **qu'après** le retour de l'Edge Function si Facebook est coché (pour permettre d'afficher le résultat).

---

## Supabase Edge Function — `post-to-facebook`

### Fichier

`supabase/functions/post-to-facebook/index.ts`

### Input (POST body JSON)

```ts
{
  actu_id: string;   // UUID de l'actu
  debug: boolean;    // true = post caché (published: false côté Facebook)
}
```

### Authentification

L'Edge Function vérifie que la requête provient d'un utilisateur `authenticated` via le header `Authorization: Bearer {supabase_jwt}`. Rejeter toute requête non authentifiée avec 401.

### Algorithme

**1. Récupérer l'actu**

```ts
const { data: actu } = await supabaseAdmin
  .from('actus')
  .select('titre, contenu, image_urls')
  .eq('id', actu_id)
  .single();
```

**2. Construire le message texte**

Le titre **n'est pas envoyé** à Facebook (l'image principale ou le contexte du post sert de titre visuel).
Seul le contenu de l'actu est posté, dépouillé du Markdown :

- Supprimer les images inline `![alt](url)` (les images sont envoyées séparément).
- Supprimer les balises HTML (`<u>`, `</u>`, etc.).
- Supprimer les marqueurs Markdown (`**`, `*`, `_`, `~~`, `#`, `##`, `###`).
- Conserver les sauts de ligne.

**3. Collecter toutes les images**

Sources d'images, dans l'ordre :
1. `actu.image_urls` (images explicitement uploadées)
2. Images inline extraites du contenu Markdown via la regex `!/\[.*?\]\((https?:\/\/[^)]+)\)/g`

Dédupliquer (conserver l'ordre, supprimer les doublons). Si la liste est vide, créer un post texte uniquement (pas d'`attached_media`).

**4. Uploader les images sur Facebook**

Pour chaque image (URL publique Supabase) :

```
POST https://graph.facebook.com/v19.0/{FACEBOOK_PAGE_ID}/photos
  ?published=false
  &url={image_url}
  &access_token={FACEBOOK_PAGE_ACCESS_TOKEN}
```

Réponse : `{ id: string }` → conserver le `photo_id`.

En cas d'échec sur une image : stopper et renvoyer l'erreur (ne pas créer un post partiel).

**5. Créer le post**

```
POST https://graph.facebook.com/v19.0/{FACEBOOK_PAGE_ID}/feed
Body (JSON) :
{
  "message": "{message texte}",
  "published": !debug,
  "attached_media": [
    { "media_fbid": "{photo_id_1}" },
    { "media_fbid": "{photo_id_2}" },
    ...
  ],
  "access_token": "{FACEBOOK_PAGE_ACCESS_TOKEN}"
}
```

Si aucune image : omettre `attached_media`.

**6. Réponse de l'Edge Function**

Succès :
```json
{ "success": true, "post_id": "...", "post_url": "https://www.facebook.com/{page_id}/posts/{post_id}" }
```

Erreur :
```json
{ "success": false, "error": "...", "detail": { ... } }
```

---

## Gestion des erreurs

Tous les erreurs sont remontées telles quelles au client (pas de masquage). Le client les affiche en rouge dans le formulaire, sous les boutons.

| Cas | Message à afficher |
|---|---|
| Actu introuvable en base | `"Actu introuvable (id: {actu_id})"` |
| Requête non authentifiée | `"Erreur d'authentification — reconnectez-vous."` |
| Échec upload d'une image | `"Erreur lors de l'upload de l'image {url} : {fb_error_message} (code {fb_error_code})"` |
| Échec création du post | `"Erreur lors de la création du post Facebook : {fb_error_message} (code {fb_error_code})"` |
| Token expiré (code Facebook 190) | `"Le token Facebook a expiré — veuillez le renouveler dans les variables d'environnement Supabase."` |
| Erreur réseau / timeout | `"Erreur réseau lors de la communication avec Facebook."` |

Le détail brut de la réponse Facebook est inclus dans `detail` pour faciliter le debug.

---

## Mode debug

Quand `debug = true` :
- Le champ `published` du post Facebook est `false`.
- Le post est créé mais invisible au public — visible uniquement par les admins de la page.
- Le lien retourné dans la réponse de succès pointe vers ce post caché (accessible via le gestionnaire de page Facebook).
- Dans le BO, le message de succès précise : `"Post publié en mode caché (visible uniquement par les admins de la page)."`.

---

## Fichiers à créer / modifier

```
src/
  components/ActuForm.tsx        ← ajouter les checkboxes + gestion du flux Facebook

supabase/
  functions/
    post-to-facebook/
      index.ts                   ← Edge Function (nouveau fichier)
```

---

## Notes d'implémentation

- L'API Graph Facebook utilisée est la version `v19.0` (stable à date). Paramètre à centraliser dans une constante.
- Le `supabaseAdmin` dans l'Edge Function utilise la `SERVICE_ROLE_KEY` (disponible automatiquement dans les Edge Functions Supabase via `Deno.env`).
- Ne pas stocker le `post_id` Facebook en base pour cette v1 (hors scope).
- Si l'actu n'a pas encore d'`id` (création), la sauvegarde doit avoir lieu avant l'appel à l'Edge Function pour disposer de l'UUID.
- Les calls Graph se font sur `/me/photos` et `/me/feed` (pas `/{page_id}/...`) — `/me` résout vers la page elle-même avec un Page Access Token et contourne le bug FB `(#200) Unpublished posts must be posted to a page as the page itself`.

---

## Légendes par photo (caption Facebook)

> Statut : implémenté

### Objectif

Permettre à l'admin de saisir, depuis le BO, une légende par image. Cette légende est transmise à Facebook lors de l'upload de la photo (`caption` du endpoint `/me/photos`). Elle apparaît **uniquement quand la photo est ouverte en plein écran sur Facebook** — pas dans le post lui-même (le post n'a qu'un seul `message`).

**La légende n'est PAS affichée côté PWA** (ni BO en consultation), elle est uniquement métadonnée Facebook.

### Données

Nouvelle colonne sur la table `actus`, parallèle à `image_urls` et `image_focal_points` :

```sql
-- supabase/migrations/YYYYMMDD_actus_image_captions.sql
ALTER TABLE actus
  ADD COLUMN IF NOT EXISTS image_captions TEXT[] NOT NULL DEFAULT '{}';

NOTIFY pgrst, 'reload schema';
```

- Tableau parallèle : `image_captions[i]` correspond à `image_urls[i]`.
- Une chaîne vide `""` ou un index manquant = pas de caption (paramètre `caption` omis dans l'appel FB).
- Mise à jour du type TS `Actu` : `image_captions: string[];` (parallèle à `image_urls`).

### UI back-office (`ActuForm.tsx`)

Sur chaque vignette du composant `FocalPointPreview` (ou juste en dessous), ajouter un `<textarea>` discret, 2-3 lignes max, avec :

- placeholder : « Légende Facebook (optionnelle) »
- petit hint sous le champ : « Visible uniquement quand l'image est ouverte en plein écran sur Facebook ».
- `value` lié à un état parallèle aux focal points (`existingCaptions: string[]` + `newFiles[i].caption: string`).
- À la sauvegarde : envoyer `image_captions: finalCaptions` dans l'`update` Supabase (même endroit que `image_urls` et `image_focal_points`).

Désactiver le champ ou le masquer **uniquement** si on souhaite garder le formulaire allégé pour les actus jamais postées sur FB ? → Non, on l'affiche systématiquement (l'admin sait à quoi ça sert via le hint).

### Edge Function `post-to-facebook`

1. Étendre la requête `select` :
   ```ts
   .select('titre, contenu, image_urls, image_captions')
   ```
2. Construire une `Map<url, caption>` à partir des sources, dans cet ordre de priorité (la première saisie l'emporte) :
   1. `image_captions[i]` pour les URLs venant de `image_urls` (saisie BO).
   2. Texte alternatif des images inline Markdown `![alt](url)` (convention Markdown standard — l'admin tape la légende directement dans le contenu).
3. Lors de l'upload `/me/photos`, ajouter `&caption={encodeURIComponent(caption)}` **si la caption est non vide**. Sinon, omettre le paramètre.

### Légendes des images inline du contenu

Pour les images insérées dans le corps du Markdown (`![](url)`), il n'y a pas de champ dédié dans le BO : la légende Facebook est **le texte alternatif Markdown**. Exemples :

```markdown
![](https://...image1.jpg)              → pas de caption envoyée
![Médaille du tournoi](https://...image2.jpg)  → caption FB = "Médaille du tournoi"
```

Cette convention a aussi un bénéfice accessibilité (le texte alt est lu par les lecteurs d'écran côté PWA).

### Hors scope

- Affichage des légendes dans la PWA (`ActuCard`, `ActuDetailPage`).
- Affichage des légendes dans le BO en mode lecture (page `ActusPage`).
- Synchronisation post-publication d'une légende modifiée a posteriori (l'API Graph permet `POST /{photo_id}?caption=...` mais on ne stocke pas `photo_id` côté DB → hors scope v1).

### Fichiers à créer / modifier

```
supabase/
  migrations/
    YYYYMMDD_actus_image_captions.sql   ← nouveau

src/
  types.ts                                ← ajouter image_captions: string[]
  components/ActuForm.tsx                 ← textarea par image + état + persistence

supabase/
  functions/
    post-to-facebook/
      index.ts                            ← select étendu + caption sur /me/photos
```
