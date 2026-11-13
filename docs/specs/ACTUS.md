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
  5. Notification des membres si l'actu est publiée et la case cochée.

  Ces étapes vivent dans `saveActu` (`src/lib/actuWrites.ts`, SaaS S5), partagé avec l'étape « Première actu » des premiers pas (`SAAS_ONBOARDING.md` §9.4) ; la validation d'une image dans `actuImageProblem`. La publication Facebook reste dans `ActuForm`.

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
- **Notification push** (29/10/2026) : au-dessus de Facebook, case « Envoyer une notification aux
  membres du club », **cochée par défaut**, désactivée si l'actu est déjà publiée, ignorée sur
  « Enregistrer en brouillon ». Au clic sur « Publier », après l'enregistrement, appel à la RPC
  `content_push_announce` (sans bloquer en cas d'échec). Voir `docs/CONTENT_PUSH.md`.
- **PR8** — la case reste proposée **même si aucune page n'est connectée** : `club_social_credentials`
  n'est lisible que par un **admin** du club, or un `manager` publie des actus. Le formulaire ne peut
  donc pas savoir si le club est connecté ; c'est l'Edge Function qui le dit, au clic, par un message
  d'erreur nommant l'écran à visiter. Griser la case pour tout le monde demanderait d'ouvrir la lecture
  de la table aux rôles non-admins — le contraire de la décision D10.

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

### Identifiants Facebook — par club (PR8)

Depuis la migration multi-tenant **PR8** (`MULTI_TENANT.md` §6.3, décision **D10**), les
identifiants ne sont plus des secrets globaux d'Edge Function mais une ligne de la table
**`club_social_credentials`**, propre au club de l'actu :

| Colonne | Valeur |
|---|---|
| `page_id` | ID numérique de la page Facebook — **déduit du token**, jamais saisi |
| `page_name` | Nom de la page, pour l'affichage BO seulement |
| `token` | Page Access Token longue durée. **Jamais lisible côté client** (`GRANT` par colonne) |
| `token_expires_at` | Échéance connue du token, ou `NULL` |

Un administrateur du club les renseigne depuis **Admin › Comptes sociaux** (`/admin/social`).
Les secrets `FACEBOOK_PAGE_ID` / `FACEBOOK_PAGE_ACCESS_TOKEN` ne sont **plus lus**, et il
n'existe **aucun repli** sur eux : un club sans page connectée voit sa publication refusée
avec un message explicite, plutôt que de publier sur la page d'un autre club.

### Input (POST body JSON)

```ts
{ actu_id: string; debug: boolean; }
```

### Authentification et autorisation

L'Edge Function vérifie `Authorization: Bearer {supabase_jwt}`. Rejeter avec 401 si absent.

**Audit du 05/09/2026** — le JWT ne suffit plus. L'actu est chargée avec son `club_id` et
son `published`, et la publication exige **quatre** conditions : club **actif**, actualité
**publiée**, appelant **admin ou manager** de ce club (un `member` est refusé — il ne voit
que le Live Score au back-office) **ou** super-admin. Le mode debug ne contourne rien.

**PR8** ne touche pas à ce contrôle — il ne dépendait pas des credentials. Elle en retire en
revanche un cinquième terme, `actu.club_id !== FACEBOOK_CLUB_ID` : ce garde-fou liait les
credentials **globaux** à un club unique faute de pouvoir en avoir plusieurs. Une fois les
credentials en base par club, ce n'est plus une variable d'environnement qui protège, c'est
**l'absence de ligne** — un club sans page connectée ne publie nulle part.

### Algorithme

**1.** Récupérer l'actu, **avec son `club_id`** — c'est lui qui commande l'autorisation
ci-dessus *et* le choix de la page :
```ts
const { data: actu } = await supabaseAdmin
  .from('actus')
  .select('club_id, titre, contenu, image_urls, image_captions')
  .eq('id', actu_id)
  .single();
```

**1 bis.** Charger les identifiants du club (`club_social_credentials`, `platform = 'facebook'`).
Aucune ligne → **400** « Aucune page Facebook n'est connectée pour ce club. »

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
| Token expiré (code 190) | `"Le token Facebook a expiré — un administrateur peut le renouveler depuis Admin → Comptes sociaux."` |
| Aucune page connectée (PR8) | `"Aucune page Facebook n'est connectée pour ce club. Un administrateur peut la connecter depuis Admin → Comptes sociaux."` |
| Actu d'un autre club (PR8) | `"Cette actualité appartient à un autre club."` |
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

## Génération depuis des rencontres (11/11/2026)

Un **administrateur** du club (rôle `admin`, ou super-admin en support — pas les managers ni les
capitaines) génère le titre et le texte d'une actu à partir de rencontres par équipe déjà en
base, puis crée un **brouillon** d'actu avec les visuels et photos des rencontres.

### Parcours — `ActuGeneratePage.tsx` (`/actus/generer`, `adminOnly`)

1. Bouton « Générer depuis des rencontres » sur `/actus` (visible des seuls admins).
2. Choix de la saison, puis des rencontres **jouées** (score saisi), 12 au plus ; celles des
   7 derniers jours sont cochées d'emblée. Pour chaque rencontre cochée : **note** (300 car.) et
   **contexte de classement** (200 car.) facultatifs, **non conservés** en base.
3. **Images de l'actu** (`components/ActuGenerateImages.tsx`) : pour chaque rencontre cochée
   terminée qui a des photos, un visuel **« Esprit d'équipe »** (même rendu que `/medias`,
   `renderResultPoster` modèle `photo`, cadrage centré, partenaires tirés une fois pour la page ;
   choix de la photo du visuel si la rencontre en a plusieurs), puis les photos des rencontres.
   Chaque image a **deux cases indépendantes** : **« À la une »** (galerie en tête de l'actu,
   dans l'ordre affiché) et **« Dans le texte »** (après le paragraphe qui raconte sa
   rencontre). Les deux, l'une, ou aucune (image retirée). Par défaut : visuels dans le texte,
   photos à la une. Un visuel qui ne se rend pas est signalé et écarté. Rien de tout cela
   n'est envoyé à l'IA.
4. Longueur (courte / normale), ton (familial et fun / sérieux), consigne libre (500 car.).
   Aperçu repliable des données envoyées à l'IA (`buildPostFacts`, le même module que la
   fonction : l'aperçu montre exactement ce qui part).
5. Résultat : **avertissements en tête** (encadré « À vérifier avant de publier »), titre et
   texte modifiables, boutons **Copier**, **Plus court**, **Plus sérieux** (régénération à partir
   du texte courant) et **Régénérer avec la consigne**. Chaque régénération consomme le quota ;
   les générations restantes du mois sont affichées.
6. **Créer le brouillon d'actu** (bouton actif une fois les visuels rendus) : `saveActu` (non
   publié, sans notification) avec le texte tel quel (`remark-breaks` garde les retours à la
   ligne partout). Images **« Dans le texte »** : visuels en JPEG, photos copiées, envoyés
   dans `content-images/<club>/inline/` (comme une image insérée depuis l'éditeur) et insérés
   en `![](url)` juste après le paragraphe qui raconte leur rencontre : chaque fait porte un
   repère (`ref` : `R1`, `R2`…), Claude rend le texte paragraphe par paragraphe en citant les
   repères racontés, la fonction en tire `anchors`. Le BO retrouve ce paragraphe tel quel, ou
   par sa ligne la plus longue s'il a été retouché ; à défaut, le premier qui cite
   l'adversaire, puis l'avant-dernier paragraphe (avant le remerciement)
   (`lib/actuInlineImages.ts`, testé). Images **« À la une »** : galerie de l'actu, visuels en
   JPEG, photos **copiées** dans `actu-images` (`clubPhotoForActu`), légendes vides — un humain
   les écrit. `post-to-facebook` publie aussi les images du texte. Ouvre ensuite
   `/actus/:id/edit`. La publication (et Facebook) se fait
   depuis le formulaire, comme toute actu.

### Faits envoyés — `shared/teamPostFacts.mjs`

`buildPostFacts({ rencontres, extras })` rend `{ facts, warnings }`. Par rencontre : libellé
d'équipe (« Messieurs +35 ans (équipe 2) »), `jeunes`, compétition, division, journée/stade,
date (jour et mois, heure de Paris), domicile/extérieur, adversaire, score global, résultat
(victoire/nul/défaite), forfait, matchs (simples d'abord : type, **prénoms** du club, score,
vainqueur, forfait/abandon), note, contexte.

- **Minimisation** : seuls les prénoms des joueurs du club partent — ni nom de famille, ni
  classement, ni joueur adverse, ni identifiant, ni photo. Les mots tout en majuscules sont
  retirés du prénom (un import Ten'Up peut y mettre « Jean DUPONT »).
- **Contrôles en code** (`warnings`) : score global absent ; score global différent de la somme
  des matchs quand tous sont renseignés (points du double selon le format, table
  `FORMAT_POINTS` vérifiée contre `FORMAT_SPECS` par test) ; matchs incomplets ; vainqueur sans
  score ; joueur sans prénom.

### Edge Function `generate-post`

`POST { club_id, rencontre_ids (1–12), extras?, length: 'short'|'normal', tone: 'fun'|'serious', consigne?, previous? }`
→ `{ success: true, titre, text, anchors, warnings, remaining }` ou `{ success: false, error }`.
`anchors` : pour chaque rencontre (id), le paragraphe qui la raconte.

1. JWT obligatoire (401), secret `ANTHROPIC_API_KEY` présent (503), corps valide (400/413).
2. `post_gen_check(club, POST_GEN_GLOBAL_DAILY_LIMIT)` **avant tout appel payant** : 403 si
   l'appelant n'est pas admin du club actif, 429 avec le message SQL si un plafond est atteint.
3. Faits **relus en base** avec le jeton de l'appelant, filtrés par `club_id` : une rencontre
   d'un autre club donne 404, rien de ce que le client affirme sur les résultats n'est cru.
4. `claude-haiku-5-5`, `max_tokens` 4000, réflexion désactivée (ses tokens tronquaient le texte), effort `low`, sortie structurée
   `{ titre, paragraphes: [{ texte, rencontres }], warnings }`, timeout 30 s, une seule relance SDK. Prompt système figé dans
   `supabase/functions/generate-post/prompt.ts` (règles ci-dessous + exemples few-shot).
5. Réponse inexploitable (refus du modèle, troncature, JSON invalide) → 502, **non comptée**.
   Sinon `post_gen_record` (tokens) puis réponse ; avertissements du code d'abord, puis ceux
   du modèle (10 au plus).
6. Erreurs : timeout → 504, API saturée (429/529) → 503, autre → 502 ; jamais de détail
   technique ni de secret dans la réponse.
7. Logs (une ligne JSON) : `club_id`, statut, nombre de rencontres, tokens, latence. **Jamais**
   de texte, de prénom ni d'adversaire.

Règles de rédaction du prompt : français, troisième personne (publié sous le nom du club), pas
de blague interne ni de ton intime, emojis 🟢 / 🟡 / 🔴 / 🎾, fidélité stricte (aucun score,
prénom, résultat ou enjeu inventé ; champ null = inconnu), incohérence ou note vague → neutre
dans le texte + avertissement, jamais de santé ni de blessure, équipe jeunes = prénoms seuls
sans âge ni détail, rencontres d'une même équipe regroupées, sections « Les dames » /
« Les messieurs », remerciement final aux joueurs et supporters, texte brut sans Markdown.
La consigne du club ne peut pas lever ces règles.

⚠️ **Exemples few-shot à fournir** : `prompt.ts` contient trois emplacements
`[À REMPLACER …]` à remplir avec de vraies publications du club avant la mise en service.

### Quota — migration `2026111302_post_generation.sql`

- `clubs.post_gen_monthly_limit` (défaut **30**, modifiable par club en SQL).
- Table `post_generations` (club, auteur, tokens, date) : RLS sans policy ni GRANT, écrite et
  lue par les seules fonctions `SECURITY DEFINER`. Aucun contenu conservé.
- `post_gen_check(p_club, p_global_daily_limit)` : admin du club actif, coupe-circuit global
  (générations de tous les clubs sur 24 h glissantes ≥ limite → `PT429`), puis plafond mensuel
  du club (mois calendaire, heure de Paris → `PT429`). Rend les générations restantes.
- `post_gen_record(p_club, p_input_tokens, p_output_tokens)` : appelée après un appel réussi.
  Deux générations simultanées peuvent dépasser le plafond d'une unité chacune (accepté).

### Déploiement

```bash
supabase db push                                    # migration 2026111302 AVANT la function
supabase secrets set POST_GEN_GLOBAL_DAILY_LIMIT=300  # facultatif (300 par défaut)
supabase functions deploy generate-post
```

`ANTHROPIC_API_KEY` est déjà posé pour `compo-scan` ; sinon
`supabase secrets set ANTHROPIC_API_KEY=…` (jamais dans le repo ni dans `.env.local` du front).
En local : `supabase functions serve generate-post --env-file supabase/.env.local` (fichier
non versionné contenant `ANTHROPIC_API_KEY`). Tests sans service externe :
`npm run test:post-generation`.

### Confidentialité (à reporter dans la politique quand elle sera rédigée)

> Pour aider les administrateurs à rédiger les actualités des rencontres par équipe, feelike
> peut transmettre à Anthropic (sous-traitant, API Claude) les informations strictement
> nécessaires : nom des équipes et des clubs adverses, dates, scores, et **prénoms** des
> joueurs du club — jamais de nom de famille, d'adresse e-mail, d'identifiant ni de photo.
> Le texte généré n'est pas conservé par feelike, sauf si l'administrateur l'enregistre dans
> une actualité. Seul un compteur d'usage (club, date, volume) est conservé pour appliquer les
> quotas.

## Espacement des paragraphes (13/11/2026)

Une ligne vide dans l'éditeur crée un nouveau paragraphe Markdown. Le reset CSS de Tailwind
met les marges des `<p>` à zéro et `.markdown-body` ne les rétablissait pas : dans la PWA (et
l'aperçu du BO), les paragraphes se suivaient sans espace, comme de simples retours à la
ligne. Règle `.markdown-body > * + * { margin-top: 1em }` dans `pwa/src/index.css` et
`src/index.css`, alignée sur `.news-content` de la vitrine, qui espaçait déjà ses paragraphes.

## Évolutions futures

- Republication / suppression d'un post Facebook existant.
- Analytics Facebook.
- Publication automatique sans action manuelle.


## Correctif sécurité — audit du 05/09/2026

Le rendu éditorial utilise `rehype-raw` puis `rehype-sanitize` avec une liste
contrôlée de balises/attributs. Le soulignement `<u>` de l'éditeur est conservé ;
styles, scripts, formulaires et contenus embarqués actifs sont supprimés dans
l'aperçu BO et les détails PWA. Les liens, listes, images et légendes sont conservés.
Le contrat réside dans les deux copies de `src/lib/markdown.ts` (BO et PWA),
validées avec les dépendances propres à chaque application.

`post-to-facebook` exige désormais une actualité publiée, un club actif, et un
appelant admin/manager de ce club ou super-admin. Les credentials Facebook
historiques sont liés à `FACEBOOK_CLUB_ID` : absence ou club différent = refus
avant publication. Le mode debug ne contourne pas ces contrôles. La gestion de
credentials distincts pour plusieurs clubs et l'idempotence restent à livrer.

> **Mise à jour — PR8 (06/09/2026).** Les credentials distincts par club sont livrés :
> table `club_social_credentials`, écran *Admin › Comptes sociaux*, lecture en service role
> par la function. `FACEBOOK_CLUB_ID` n'est **plus lu** et son secret peut être retiré du
> dashboard — il n'avait de sens que pour des credentials globaux. Les quatre conditions
> d'autorisation ci-dessus sont **conservées telles quelles**. **L'idempotence reste à
> livrer** : republier deux fois la même actu crée toujours deux posts.
