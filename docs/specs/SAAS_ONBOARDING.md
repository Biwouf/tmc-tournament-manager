# SAAS_ONBOARDING.md — Découvrir, essayer, s'installer, payer seul

> Spec vivante du parcours self-serve de feelike.pro. Créée par S2 à partir de
> `docs/briefs/SAAS_00_ROADMAP.md` (décisions) et du cadrage du 05/10/2026 (partiellement
> obsolète : la roadmap prime). Chaque PR S3 → S10 complète la section qui la concerne.
> Socle multi-tenant : `MULTI_TENANT.md`.

## 1. Objectif et décisions

Un club découvre feelike (landing `www.feelike.pro`), crée son club en **essai de 30 jours sans
carte bancaire**, s'installe avec des premiers pas guidés, puis paie seul (**Saison : 250 €/an**,
annuel, Stripe). L'humain n'intervient que pour le call de réassurance.

| Sujet | Décision |
|---|---|
| Essai | 30 jours, sans carte, démarré au premier clic sur le lien magique |
| Création du club | Quand le prospect valide son e-mail dans le tunnel, en `pending`, avec tout ce qu'il a saisi |
| Club jamais confirmé | Purgé après 7 jours : club, fichiers, et compte s'il n'a été créé que pour lui |
| E-mail déjà connu | Le club est rattaché au compte existant, aucun nouveau compte ; réponse identique |
| Fin d'essai sans paiement | Rien n'est supprimé : BO en lecture seule, réactivation possible (S9) |
| Site vitrine | Hors premiers pas ; `noindex` tant que le club n'a pas cliqué « Publier » (S8) |

## 2. Découpage

| PR | Contenu | État |
|---|---|---|
| S0 | Vitrine : texte lisible sur la couleur du club | livrée |
| S1 | Landing `www.feelike.pro` (`landing/`) | en place |
| **S2** | Socle self-serve (ce document §3–§6) : modèle, `slug_available`, `club-signup`, activation, purge | livrée |
| **S3** | Tunnel `admin.feelike.pro/inscription` avec aperçu en direct (§7) | livrée, fermée tant que CGU / confidentialité manquent |
| S4 | Activation par lien magique simplifiée, routage vers les premiers pas | à faire |
| S5–S7 | Premiers pas : première actu, équipes, affiches | à faire |
| S8 | Tableau de bord : bandeau d'essai, checklist, bouton « Publier le site » | à faire |
| S9 | Abonnement Stripe, lecture seule en fin d'essai | à faire |
| S10 | E-mails de cycle de vie, funnel super-admin | à faire |

## 3. Modèle de données (migration `2026102601_club_self_serve.sql`)

Sur `clubs` :

| Colonne | Valeurs | Rôle |
|---|---|---|
| `status` | `active`, `suspended`, **`pending`** | `pending` : inscription non confirmée. Jamais résolu (vitrine 404, PWA écran neutre, BO absent du sélecteur) et **invisible** : `clubs` et `club_settings` ne le montrent ni à `anon`, ni à un compte qui n'en est pas membre (super-admin excepté) |
| `plan` | `internal` (défaut), `trial`, `saison` | Clubs historiques et créés par la console : `internal`, hors facturation. Self-serve : `trial` |
| `trial_ends_at` | `timestamptz` | Posé à l'activation : maintenant + 30 jours |
| `created_via` | `console` (défaut), `self_serve` | Traçabilité |
| `site_published` | `boolean`, défaut `true` | `false` en self-serve : la vitrine est servie en `noindex` (en-tête, balise, sitemap vide, robots sans sitemap) |

Contrainte `clubs_self_serve_lifecycle` : un club `pending` est forcément `self_serve` + `trial`
sans fin d'essai ; un essai qui n'est plus `pending` a forcément une fin d'essai. Elle empêche
la console de réactiver un `pending` et de remettre un club existant (le CAC) en `pending`, que la
purge supprimerait.

**Écritures** : `REVOKE INSERT, UPDATE` table entière pour `authenticated`, puis grants par
colonne — la console n'insère que `name, slug, sport` et ne met à jour que `status` (même leçon
que PR5 §0 : la RLS ne sait pas restreindre une colonne). `plan`, `trial_ends_at`, `created_via`
et `site_published` ne s'écrivent que par le service role et les fonctions `SECURITY DEFINER`.

Table `club_self_serve_attempts` (limite de débit) : `bucket` = `ip:<sha256>` ou
`email:<sha256>`, aucune donnée en clair, aucun droit pour `anon` / `authenticated`, purgée
après 2 jours.

## 4. Règles du slug

Une seule liste : **`shared/clubSlug.mjs`** (`RESERVED_SLUGS`, `isReservedSlug`,
`signupSlugProblem`), importée par le BO et la PWA (`clubHost.ts`), la console
(`SuperAdminPage`), la vitrine (`web/src/server/tenant.ts`), les e-mails d'auth
(`email-template.ts`) et `club-signup`. Ses deux copies SQL — le CHECK `clubs_slug_format`
(PR5) et `club_slug_problem()` (S2) — sont comparées à elle par `tests/club-signup-sql.test.mjs`.

- Réservés : `admin, app, www, api, mail, static, assets, feelike` et tout `app-*`
  (`app-<slug>.feelike.pro` est la PWA du club `<slug>`).
- Self-serve : `^[a-z0-9]([a-z0-9-]{1,30}[a-z0-9])$` (3 à 32 caractères). La console garde la
  règle PR5 (2 à 32).
- `slug_available(slug)` — RPC publique, lecture seule : `{ available, reason }` avec
  `reason` ∈ `format`, `reserved`, `taken` (un club `pending` tient son slug).

## 5. Cycle de vie d'un club self-serve

```
tunnel (S3) ──POST club-signup──▶ pending ──lien magique──▶ active (trial, J+30) ──▶ S9
                                    │
                                    └── 7 jours sans clic ──▶ purgé
```

### 5.1 Création — Edge Function `club-signup` (publique, `verify_jwt = false`)

`POST multipart/form-data` : `name`, `city`, `sport` (`tennis`), `slug`, `color` (`#rrggbb`),
`email`, `turnstile_token`, `logo` et `photo` facultatifs (PNG, JPEG ou WebP reconnus à leur
signature, 5 Mo chacun, pas de SVG).

1. **Turnstile** vérifié côté serveur (`TURNSTILE_SECRET_KEY`) avant toute écriture → `403`.
2. **Limite de débit** `club_self_serve_throttle` : 5 tentatives par heure et par IP, 3 par
   24 h et par adresse ; une tentative refusée n'est pas comptée → `429`.
3. **Validation** (la base revalide tout) → `400` (`reason` pour le slug), `413` pour un fichier.
4. **Compte** : `auth.admin.createUser({ email_confirm: true, app_metadata: { created_via:
   'club_signup' } })`, ou réutilisation si l'adresse existe. Le marqueur permet à la purge de ne
   supprimer qu'un compte né de l'inscription.
5. **Fichiers** dans `content-images/<club_id>/config/<ts>-logo.<ext>` et `…-hero-image.<ext>`
   (même bucket et même convention que la configuration du site ; `club_id` tiré par l'Edge).
6. **`club_self_serve_create`** (une transaction) : club `pending` / `trial` / `self_serve` /
   `site_published = false`, `club_settings` par le trigger PR5 `create_club_settings()`,
   `brand` (nom, ville, sport, couleur, logo) et `home.hero_image`, appartenance **admin**. Les
   URL d'images doivent pointer le dossier `config/` de ce club. Rejouer avec la même adresse et
   le même slug sur un club encore `pending` ne recrée rien (`created: false`) et renvoie le lien.
   Échec → l'Edge supprime les fichiers envoyés et le compte qu'elle vient de créer ; slug pris →
   `409`.
7. **Lien magique** : `signInWithOtp({ shouldCreateUser: false, emailRedirectTo:
   CLUB_SIGNUP_REDIRECT_URL + '?inscription=<slug>' })`. Le hook `send-auth-email` choisit le
   gabarit **« Gardez votre club »** quand ce paramètre désigne un club `pending` dont le
   destinataire est admin (sinon : gabarit « magiclink » ordinaire).

Réponse : `200 { ok: true }`, identique que l'adresse ait déjà un compte ou non. Rien n'est
journalisé de l'adresse, de l'IP, du jeton ni des fichiers.

### 5.2 Activation — RPC `club_self_serve_activate()`, appelée par le BO central

Choix : **RPC appelée au chargement du BO** (`AdminEntry`, avant de lister les clubs du compte),
plutôt qu'un trigger ou un hook d'auth :

- un **trigger** sur `auth.users` (`last_sign_in_at`) vivrait dans le schéma de GoTrue, se
  déclencherait aussi quand un antivirus de messagerie « clique » le lien, et lierait notre
  logique à des détails internes d'Auth ;
- un **hook d'auth** (*Custom Access Token*) s'exécute à chaque émission et rafraîchissement de
  jeton : un effet de bord y est mal placé, et c'est un réglage de plus à poser au dashboard ;
- la **RPC** n'agit que quand le BO s'ouvre vraiment avec une session, est idempotente, et se
  teste en SQL.

Elle passe en `active` (fin d'essai = maintenant + 30 jours) les clubs `pending` dont l'appelant
est admin, **seulement si la session vient d'un lien magique cliqué après la création du club**
(claim `amr` du JWT : méthode `otp` ou `magiclink`, horodatage ≥ `created_at`). Un tiers qui
rattache un club à l'adresse d'un compte existant ne l'active donc pas quand ce compte se
connecte par mot de passe. Un échec de la RPC n'empêche pas d'ouvrir les clubs déjà actifs.

### 5.3 Purge — Edge Function `club-signup-purge`, cron quotidien

`supabase/scripts/club-signup-purge-cron.sql` (03:17, appel seulement s'il y a un club à purger)
→ en-tête `x-club-signup-purge-secret` = `CLUB_SIGNUP_PURGE_SECRET` (≥ 32 caractères).

1. `club_self_serve_purge_begin(50)` : nettoie les tentatives de plus de 2 jours, renvoie les
   clubs `pending` de plus de 7 jours.
2. Fichiers `content-images/<club_id>/config/*` supprimés par l'API Storage (la base refuse un
   `DELETE` direct sur `storage.objects`).
3. `club_self_serve_purge(club)` revérifie l'état, supprime le club (cascade : réglages,
   appartenances) et renvoie les comptes à supprimer : marqués `created_via = club_signup`, sans
   autre appartenance ni demande d'adhésion, pas super-admin. Un compte qui existait avant
   l'inscription n'est jamais supprimé.
4. Comptes supprimés par l'API Auth.

Un échec laisse le club `pending` : le passage suivant reprend. Un club `active`, `suspended`,
`internal` ou `console` n'est jamais candidat.

## 6. Mise en service (opérations hors code)

1. Appliquer `2026102601_club_self_serve.sql` **avant** de déployer le BO et la vitrine de S2
   (ils lisent `site_published` et appellent `club_self_serve_activate`).
2. Cloudflare Turnstile : créer le widget (domaine `admin.feelike.pro`), secret
   `TURNSTILE_SECRET_KEY` côté Edge ; la clé de site servira au tunnel (S3).
3. Déployer `club-signup` (`verify_jwt = false`, déjà dans `config.toml`), `club-signup-purge` et
   `send-auth-email` (gabarit « Gardez votre club »). Variables : `TURNSTILE_SECRET_KEY`,
   `CLUB_SIGNUP_REDIRECT_URL` (défaut `https://admin.feelike.pro/`), `CLUB_SIGNUP_PURGE_SECRET`.
4. Auth : `https://admin.feelike.pro/**` dans les Redirect URLs (PR13) ; inscriptions publiques
   GoTrue toujours désactivées (le compte est créé par le service role).
5. Vault + `supabase/scripts/club-signup-purge-cron.sql`.
6. Recette : inscription, e-mail reçu, clic → club actif et fin d'essai à J+30 (vérifie le claim
   `amr`), vitrine `noindex`.
7. Tunnel S3 : `VITE_TURNSTILE_SITE_KEY`, `VITE_SIGNUP_TERMS_URL`, `VITE_SIGNUP_PRIVACY_URL` sur le
   projet Vercel du BO (§7.5), puis `PUBLIC_SIGNUP_URL=https://admin.feelike.pro/inscription` sur
   la landing.

## 7. Tunnel d'inscription (S3) — `admin.feelike.pro/inscription`

### 7.1 Entrée

`src/components/AdminEntry.tsx` sert `/inscription` **avant** toute résolution du BO central :
aucune lecture de session, aucune activation, aucune liste de clubs, aucun bandeau de compte. Le
chemin est traité quel que soit l'hôte (serveur de dev compris) ; il n'a aucune entrée dans les
routes du BO de club. La page (`src/pages/SignupTunnelPage.tsx`) est un chunk à part : ses
polices et sa feuille ne pèsent pas sur le reste du BO.

### 7.2 Parcours

| Étape | Contenu | Pour continuer |
|---|---|---|
| 1 · Club | Nom (2 à 80), ville (obligatoire : `club-signup` la refuse vide), sport (Tennis seul) | nom + ville |
| 2 · Logo | Logo (PNG, JPEG, WebP — pas de SVG) → palette de 4 teintes au plus, la première choisie ; sans logo : Rouge, Vert, Bleu marine ou « Autre » ; photo facultative | rien (« Passer cette étape ») |
| 3 · Adresse | Slug proposé depuis le nom tant qu'il n'a pas été modifié ; `signupSlugProblem` instantané puis `slug_available` (300 ms) ; si pris : `slug-ville` proposé | adresse disponible, ou vérification impossible (la création revérifie) |
| 4 · Compte | E-mail, case CGU + confidentialité, Turnstile | les trois |
| Confirmation | Adresse rappelée, spams, effacement à 7 jours ; **Renvoyer le lien** (nouveau jeton Turnstile, même e-mail et même slug, sans les images : S2 rejoue sans rien recréer), **Changer d'adresse** (retour à l'étape 4) | — |

Images : réduites à 2400 px de côté et recompressées dans le navigateur (WebP ; repli PNG pour
un logo, JPEG pour une photo si le navigateur n'encode pas le WebP), orientation EXIF appliquée,
refusées au-delà de 5 Mo (`src/lib/signupImage.ts`).

Saisie conservée au rechargement dans `sessionStorage` (`feelike_signup_draft`), images
comprises si chacune tient sous 1,5 Mo encodée ; sinon la saisie est écrite sans elles. La case de
consentement n'est jamais conservée.

### 7.3 Erreurs de `club-signup`

Aucune saisie n'est perdue. Un jeton Turnstile ne sert qu'une fois : il est relancé après toute
réponse du serveur (pas après une coupure réseau, le jeton n'est alors jamais arrivé).

| Code | Message (résumé) | Étape |
|---|---|---|
| `409`, `400` + `reason` | Adresse prise ou refusée, choisir une autre | 3 |
| `413`, `400` image | Image trop lourde ou non reconnue | 2 |
| `403` | Vérification anti-robot relancée | 4 |
| `429` | Trop de tentatives, réessayer dans une heure | 4 |
| `502` | Club enregistré, e-mail non parti, réessayer | 4 |
| autre, `5xx` | Inscription momentanément indisponible | 4 |
| réseau | Vérifier la connexion | 4 |

Limite connue de S2 : « Changer d'adresse » puis renvoi avec le **même slug** donne `409` — le
club `pending` du premier envoi tient le slug pendant 7 jours. Le tunnel le dit explicitement et
propose de revenir à l'e-mail précédent ou de choisir une autre adresse. Le libérer côté serveur
permettrait à un tiers de voler un slug en attente : non fait.

### 7.4 Aperçu en direct

Deux directions, jamais mélangées : le tunnel suit l'identité feelike.pro (nuit / argile / craie,
polices auto-hébergées comme `landing/`), l'aperçu suit le **style réel du produit** (Manrope,
couleur du club). Desktop : site et téléphone superposés ; mobile (< 720 px) : formulaire d'abord,
aperçu replié derrière « Voir l'aperçu », onglets Site / App. Pas d'onglet Affiche avant S7.

**Composants reproduits dans le BO** (`src/components/signup/SignupPreview.tsx`) plutôt
qu'importés de `web/` et `pwa/` : les vrais composants dépendent de leurs contextes
(`SiteContext`, `ContactDrawerContext`, `useClub`, `useAuth`, React Query) et de leur routeur, et
les feuilles Tailwind de la vitrine et du BO donnent des sens différents aux mêmes classes
(`bg-muted`, `bg-card`). Chaque rendu est fait à sa largeur réelle (vitrine 1200 px ou 390 px,
PWA 390 px) puis réduit : tailles et proportions du produit.

**Les couleurs ne sont pas reproduites** : la vitrine reçoit `brandTokens()` de
`shared/brandTokens.mjs` (extrait de `web/src/lib/tokens.ts` sans changer une valeur, vérifié sur
4 096 couleurs), l'app `clubThemeTokens()` de `src/lib/theme.ts` (copie synchronisée de la PWA).

L'aperçu ne montre que ce que le produit rend pour un club qui vient d'être créé : sur le site,
ni menu (aucune page n'a encore de contenu), ni sur-titre, ni « Découvrir le club », ni initiales
sans logo ; dans l'app, l'initiale du club dans l'en-tête et des **rencontres d'exemple**
(libellées comme telles). Il montre aussi les limites actuelles de la PWA : sur une couleur
claire, le texte blanc de la colonne « Au club » et les libellés écrits dans la couleur du club
sont peu lisibles — c'est le rendu réel, à corriger dans la PWA, pas dans l'aperçu.

### 7.5 Configuration

| Variable (BO) | Rôle | Dev |
|---|---|---|
| `VITE_TURNSTILE_SITE_KEY` | Clé de site du widget (`admin.feelike.pro`) | clé de test Cloudflare `1x00000000000000000000AA` |
| `VITE_SIGNUP_TERMS_URL` | CGU (`www.feelike.pro`) | `https://www.feelike.pro/cgu` |
| `VITE_SIGNUP_PRIVACY_URL` | Politique de confidentialité | `https://www.feelike.pro/confidentialite` |

Hors serveur de dev, **le tunnel est fermé** (« Les inscriptions ouvrent bientôt ») tant que l'une
des trois manque : décision du 29/10/2026, pas d'ouverture publique sans pages juridiques.

### 7.6 Tests

`tests/club-signup-tunnel.test.mjs` (dans `npm run test:club-signup`) : `slugify`, saisie et
suggestion d'adresse, palette, codes → messages, formulaire envoyé, persistance, configuration,
tokens de marque partagés (`#e8c547`, `#3a9a5c`), absence de copie de la règle du slug.
`tests/domains.test.mjs` : `/inscription` sans session, sans club, sans bandeau, sur tout hôte.
