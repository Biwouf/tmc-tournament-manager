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
| **S4** | Activation par lien magique simplifiée, routage vers les premiers pas (§8) | livrée |
| **S5** | Premiers pas : cadre, fil d'Ariane, première actu, écran final (§9) | livrée |
| **S6** | Premiers pas : vos équipes depuis un lien de poule Ten'Up, plafond Ten'Up d'essai (§10) | livrée (#207) |
| **S6b** | Vos équipes : toutes les équipes du club depuis la page de ses rencontres (§10.6) | en revue (migration, Edge et worker à déployer avant merge) |
| **S7** | Premiers pas : vos affiches, fond « Aux couleurs du club » (§11) | en revue |
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
Ce qui suit l'activation (choix du club, premiers pas, lien expiré) : §8.

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

## 8. Activation et connexion par lien magique (S4)

Décisions du 31/10/2026 : connexion par lien magique **pour tous les comptes** ; **aucun mot de
passe** demandé dans le parcours (« Choisir un mot de passe » ira dans la checklist de S8) ;
club **sélectionné d'office** quand le compte n'en a qu'un actif, pour tous les comptes.

### 8.1 Arrivée sur `admin.feelike.pro` (`src/components/AdminEntry.tsx`)

Après `club_self_serve_activate` (§5.2), le BO central lit les clubs `active` et `pending` du
compte (un club `pending` n'est visible que de ses membres), puis, dans cet ordre :

| Situation | Résultat |
|---|---|
| Super-admin en mode support | Le club de support, inchangé (prime sur tout) |
| `?inscription=<slug>` désigne un club **actif** du compte | Club sélectionné (clé `sessionStorage` `feelike_admin_club:<user>`), `navigate('/premiers-pas', { replace: true })` : le paramètre quitte l'URL |
| `?inscription=<slug>` désigne un club encore **`pending`** (claim `amr` refusé : connexion par mot de passe) | « Ouvrez le lien reçu par e-mail pour activer votre club », bouton **Recevoir un nouveau lien** (vers `?inscription=<slug>`, gabarit « Gardez votre club ») ; les autres clubs actifs restent proposés |
| Choix déjà fait dans la session | Ce club |
| Un seul club actif | Ce club, sans sélecteur (CAC compris) |
| Aucun club actif mais un club `pending` | Le message d'activation ci-dessus, pas un sélecteur vide |
| Sinon | Sélecteur « Choisir un club », inchangé |

`/premiers-pas` : les premiers pas de S5 (§9). Rouvrir le lien d'un club déjà actif y ramène
aussi, puis au tableau de bord s'ils sont terminés ou reportés.

### 8.2 Lien expiré ou déjà utilisé

GoTrue redirige vers `redirect_to#error=access_denied&error_code=otp_expired&…` (la requête,
donc `?inscription`, est conservée) ; supabase-js laisse l'erreur dans l'URL et garde une session
existante. `src/lib/magicLink.ts` lit `error_code` (fragment, ou requête en PKCE) **au chargement
du module**, avant qu'une redirection du routeur vers `/login` ne perde le fragment. Sans session,
`LoginPage` s'ouvre alors en « Ce lien a expiré » : champ e-mail, **Recevoir un nouveau lien**
(retour `https://admin.feelike.pro/?inscription=<slug>` si le slug est connu, sinon la racine),
erreur retirée du fragment. Le hook `send-auth-email` choisit le gabarit « Gardez votre club » si
le club est encore `pending`.

### 8.3 Revenir sans mot de passe

`LoginPage` propose **Recevoir un lien de connexion** (et « Se connecter avec un mot de passe »
pour revenir) ; le mot de passe et « Mot de passe oublié » sont inchangés. Retour du lien :
l'origine courante.

Tous les envois passent par `requestMagicLink` : `signInWithOtp({ shouldCreateUser: false })`,
le BO reste sur invitation et aucun compte n'est créé. GoTrue refuse une adresse inconnue en
`422` : toute réponse `4xx` (hors `429`) donne le même message neutre que l'envoi réussi
(« Si un compte correspond à cette adresse… »). `429` → « Trop de demandes » ; `5xx` ou réseau
→ réessayer. Aucune adresse n'est journalisée.

Type `Club` du BO : `plan`, `trial_ends_at` (S4) et `created_via` (S5) ajoutés (lecture seule) à
`CLUB_FIELDS`, lu par `ClubContext` et `AdminEntry`, pour S5 et S8.

### 8.4 Tests et recette

`tests/magic-link.test.mjs` : lecture de `error_code`, slug d'inscription, choix du club,
réponse neutre et `shouldCreateUser: false` (y compris un balayage de tous les appels
`signInWithOtp` du dépôt), `LoginPage` en mot de passe, en lien et en lien expiré.
`tests/domains.test.mjs` : routage `?inscription` vers `/premiers-pas`, club unique, message
d'activation, support et multi-club inchangés.

Recette locale : le lien envoyé depuis `localhost` revient sur `localhost`, qui sert le BO du
club de dev, pas le BO central. Pour le parcours complet, faire pointer `admin.feelike.pro` sur
`127.0.0.1` dans `/etc/hosts` et lancer Vite avec
`__VITE_ADDITIONAL_SERVER_ALLOWED_HOSTS=admin.feelike.pro`.

Aucune opération hors code : pas de migration, pas d'Edge Function. La Redirect URL
`https://admin.feelike.pro/**` (PR13) couvre `?inscription`.

## 9. Premiers pas (S5) — `/premiers-pas`

### 9.1 Qui les voit

`eligibleForFirstSteps` : `plan = trial`, `created_via = self_serve`, rôle `admin`, hors mode
support. `firstStepsPending` : ni terminés ni reportés. `FirstStepsGate`, autour du tableau de bord
seulement, y renvoie tant que les deux sont vrais ; les autres pages restent accessibles (les liens
« à découvrir » y mènent). Un club `internal` ne fait aucune lecture de plus. Hors de ces conditions,
`/premiers-pas` renvoie au tableau de bord : le parcours ne revient pas de lui-même une fois reporté,
la checklist de S8 prend le relais.

### 9.2 Avancement — clé `onboarding` de `club_settings.config`

```json
{ "completed_steps": ["actu"], "skipped_steps": ["equipes"], "postponed_at": "…", "finished_at": "…" }
```

`skipped_steps` (S6) : étapes écartées par « Passer cette étape ». Reportées, pas terminées : la
reprise les saute, le récapitulatif final ne les compte pas, S8 pourra les reproposer. Terminer
une étape la retire de cette liste.

État explicite, jamais déduit des données : une actu supprimée ne rouvre rien. Choisi plutôt
qu'une table dédiée parce que la ligne existe pour chaque club, que la RLS réserve déjà l'écriture
aux admins du club et au super-admin, et qu'il n'y a ainsi ni migration ni droit à poser. Le groupe
est additif (`CLUB_CONFIG_VERSION` inchangée, copie `web/src/lib/clubConfig.ts` synchronisée).

Limites : `config` étant lisible par `anon`, ces dates et identifiants d'étapes le sont aussi (rien
de sensible) ; l'écriture relit puis réécrit la ligne (`updateClubConfigKey`, extrait de
`saveClubConfigGroup`), comme les panneaux de `/admin/site` : deux écritures simultanées peuvent en
perdre une. Une table sera préférable si l'avancement doit un jour être requêté entre clubs (S10).

### 9.3 Le cadre et la liste d'étapes

`FIRST_STEPS` (`src/components/firstSteps/steps.ts`) : `id`, `label`, `duration`, `isDone(state)`,
`Component`, `Preview`, `Below`, `recap`, `final`. **Ajouter une étape = une entrée** : le fil
d'Ariane, « Étape X sur N » (l'écran `final` n'est pas compté), la barre, la reprise (première étape
ni terminée ni passée) et le récapitulatif de l'écran final en découlent. `FirstStepsFlow` ne nomme aucune
étape. Depuis S7, `StepProps.goTo(id)` ouvre une autre étape de la liste (lien « Ajouter une
équipe » de l'étape affiches).

Style réel du produit : Manrope, `brandTokens()` de `shared/`. L'aperçu reprend le téléphone du
tunnel (`PhoneFrame` de `SignupPreview`) et lit les actus publiées du club avec la requête de la
PWA : il montre ce que verront les adhérents, y compris « Aucune actualité ». Mobile (< 720 px) :
l'étape d'abord, aperçu derrière « Voir l'aperçu ». « Passer à la saison » : absent jusqu'à S9.

### 9.4 Étape « Première actu »

Titre et texte préremplis, publiés par `saveActu` (`src/lib/actuWrites.ts`), le chemin d'`ActuForm` :
notification comprise, sans Facebook. Une relance après un échec reprend l'actu déjà créée.

Sans photo choisie, `clubPhotoForActu` **copie** `home.hero_image` dans `actu-images` : `SiteConfigPanel`
supprime l'ancienne photo quand on la remplace, et une référence laisserait l'actu avec une image
cassée. La copie part avec l'actu si on la supprime. Copie impossible : l'URL d'origine. Sans photo du
club : actu sans image.

### 9.5 Écran final

`app-<slug>.feelike.pro`, « Copier le lien », QR code réel en SVG (`uqr` : aucune dépendance, 27 Ko
non compressés, chunk de la page uniquement ; écrire l'encodage et sa correction d'erreurs ici
aurait fait plus de code à maintenir pour le même résultat). « Aller au tableau de bord » pose `finished_at`. Les cartes « à découvrir »
sont en pleine largeur sous l'étape et le téléphone, le brief demandant les deux là où la maquette
remplace le téléphone par les cartes.

### 9.6 Tests et recette

`tests/first-steps.test.mjs` (dans `npm run test:club-signup`) : condition d'affichage, garde,
reprise, étape ajoutée par une entrée, publication par le chemin partagé, image par défaut, relance,
QR code, report et fin. Aucune opération hors code : pas de migration, pas d'Edge Function.

## 10. Vos équipes (S6)

Entrée `equipes` de `FIRST_STEPS`, entre `actu` et `fin` (« Étape 2 sur 2 · 1 minute par équipe »).
Le cadre n'est pas retouché : la reprise qui saute les étapes passées est dans `currentStepIndex`
(`lib/firstSteps.ts`), et l'aperçu se relit à chaque équipe ajoutée par un signal propre à l'étape
(`teamsSignal.ts`), le cadre ne le relançant qu'à la complétion.

### 10.1 Parcours

1. **Lien de la poule** : validé à la frappe par `normalizeTenupPoolUrl` (le lien d'un championnat
   sans poule est refusé avec son message). Aide « Où trouver ce lien ? ». Pas de lien d'exemple.
2. **Lecture**, trois lignes branchées sur les vraies étapes (`role="status"`, `aria-live`) :
   - **saison** (`ensureSeason`) : l'active ; sinon celle de l'année sportive en cours
     (septembre → août, « 2026/2027 » au 07/11/2026), activée si elle existe, créée active sinon ;
   - **compétition** (`prepareCompetition`) : retrouvée **sans lecture** si le club a déjà ce
     championnat dans la saison (même clé que l'index unique : lien sans `?division…`) ; sinon fiche
     lue par `previewTenupCompetition` (1 lecture) puis créée avec les déductions du §10.2. Une
     création qui heurte l'index unique (autre onglet, essai précédent) reprend la ligne existante ;
   - **poule** (`readPool` : `previewTenupPool`, 1 lecture) puis `clubTeamCandidates`.
3. **Confirmation légère** : équipe reconnue, compétition, division, nombre de rencontres
   (journées exemptes exclues). Rien de reconnu, ou plusieurs équipes du club : la liste de la poule
   (boutons radio, équipes déjà importées désactivées), la troisième ligne dit « à choisir ».
4. **« Ajouter l'équipe »** → `team_equipe_create` (numéro = `nextTeamNumber`). L'équipe rejoint la
   liste « nom · genre catégorie · division · N rencontres », le téléphone montre ses rencontres.
5. « Suivant » (« C'est bon pour l'instant » à partir de deux équipes) termine l'étape ; il est
   actif dès une équipe dans la saison, y compris après rechargement. **« Passer cette étape »**,
   proposé tant qu'aucune équipe n'existe, écrit `skipped_steps` (§9.2) et passe à la suite.

Échecs, toujours avec le lien conservé : message du serveur tel quel (quota par minute, plafond
d'essai, worker indisponible, calendrier incomplet refusé par `validateTenupPool`). Aperçu expiré
(15 min) à la création : « Relire la poule » relit la seule poule. Équipe déjà importée (même poule
collée deux fois, ou erreur « déjà ajoutée » de la RPC) : « « X » est déjà dans vos équipes ».
Une compétition créée puis une poule en échec n'est pas une erreur visible : elle est reprise au
prochain essai, sans nouvelle lecture du championnat.

Coût : 2 lectures pour une équipe d'un championnat nouveau, 1 pour une autre poule du même.

### 10.2 Déductions (`deduceCompetition`, `teamMatchLabels.ts`)

| Champ | Source | Si échec |
|---|---|---|
| `nom`, `tenup_url` | fiche Ten'Up, lien de la poule normalisé | — |
| `categorie` | `inferCategorie(nom)` | `Seniors` (modifiable dans l'admin) |
| `type` | `inferType` : `jeunes` pour une tranche d'âge jeunes, sinon `adultes` | — |
| `genre` | `inferGenre(nom, type)` : Messieurs/Hommes/Masculin, Dames/Femmes/Féminin, Mixte, Garçons, Filles | demandé en ligne (2 ou 3 boutons selon le type) |
| `format`, `singles_set3_format` | fiche Ten'Up | demandés en ligne (liste des formats ; set classique / super tie-break) |

Le genre ne se déduit **que du nom du championnat** (décision du 07/11/2026) : la poule ne peut se
lire qu'une fois la compétition créée, et le genre est obligatoire pour la créer. Les champs
manquants sont donc demandés **avant** la création de la compétition et la lecture de la poule :
rien n'est créé sans eux. `inferGenre` rend null s'il ne trouve aucun mot, s'il en trouve de deux
genres, ou si le genre ne convient pas au type (« Messieurs » en 17/18 ans).

### 10.3 Plafond d'essai (migration `2026110820_tenup_trial_cap.sql`)

`team_tenup_competition_begin` (appelée aussi par `team_tenup_pool_begin`) compte désormais les
lectures par club (`team_tenup_competition_requests.club_id`) : un club `plan = 'trial'` est limité
à **20 lectures par 24 heures glissantes** (**40** depuis S6b, §10.6), tous comptes confondus, après le quota existant de 3 par
minute et par compte. Message : « Limite de l'essai atteinte : 20 lectures Ten'Up par 24 heures… ».
Une lecture refusée ne compte pas. `internal` (le CAC) et `saison` : aucun changement, pas même un
verrou de plus. Pas de SQLSTATE 40001 (exception par défaut, HTTP 400 par `tenup-sync`).

### 10.4 Aperçu

`EquipesPreview` : `MatchesScreen` (extrait de l'aperçu du tunnel, mêmes classes que
`MatchEquipeCell`) avec les rencontres à venir de la saison active, lues comme la PWA (« à venir » :
ni WO ni confirmée, jusqu'à la fin de son jour). Avant la première équipe : « Vos rencontres
arrivent ici », et la saison qui sera créée.

### 10.5 Tests et recette

`tests/team-onboarding-client.test.mjs` (déductions sur des noms Ten'Up réels, choix de la saison,
enchaînement saison → compétition → poule → équipe, compétition réutilisée, doublon, quota,
plafond, poule invalide, aperçu expiré), `tests/first-steps.test.mjs` (l'étape dans le vrai cadre :
parcours complet, équipe non reconnue, champ manquant, erreurs, report persisté et reprise),
`tests/team-onboarding-sql.test.mjs` (plafond, PGlite : essai partagé entre admins, fenêtre
glissante, refus non compté, `internal` et `saison` non plafonnés). Tous dans `npm run test:club-signup`.

Opération hors code : appliquer `2026110820_tenup_trial_cap.sql` en prod **avant** le merge. Le
worker Ten'Up n'est ni modifié ni redéployé.

### 10.6 Toutes les équipes du club (S6b, brief `SAAS_07b_import_club.md`)

Entrée principale de l'étape depuis le 09/11/2026 : le lien des **rencontres du club** sur Ten'Up
(`/club/<id>/competitions/rencontres` ; `/club/<id>` et `/club/<id>/competitions` sont ramenés à
cette forme). Aide affichée : « Espace club › Les équipes de mon club ». Le lien d'une poule reste en repli, replié sous « Une équipe manque ? ».

Parcours (`ClubImport`, logique `clubImport.ts`) :
1. **Lecture de la page** (1 lecture, `team_tenup_club_begin`) après `ensureSeason`. Le worker
   (`parse-club.mjs`) rend une entrée par équipe du club et par poule : lien de poule, nom du
   championnat, nom Ten'Up exact (`<nom du club> <n>`, à domicile comme à l'extérieur), badges
   niveau / catégorie / genre, dates à venir. Les cartes sans équipe du club ou sans lien de poule
   sont comptées (`skipped`), pas importées.
2. **Choix** : équipes par championnat, toutes cochées, décochables ; celles déjà importées (même
   poule, même nom dans la compétition existante) désactivées. Rien n'est lu avant « Importer ».
   Estimation affichée : une lecture par équipe et par championnat nouveau.
3. **Compétitions** : existante → sans lecture ; sinon fiche lue et déduite (`deduceCompetition`
   avec les badges : **genre du badge** « Femme / Homme / Mixte » d'abord, puis le nom ; catégorie
   du nom, puis du badge « Senior »). Champs encore manquants (format, 3e set, genre) demandés par
   championnat avant toute création. Un championnat illisible n'échoue que pour ses équipes.
4. **Import** : compétitions créées, puis une poule à la fois (le worker n'extrait qu'une page à la fois : en parallèle, 6 lectures sur 7 revenaient en 502 le 11/11/2026) : lecture, équipe de la poule au
   **nom exact** (`poolTeamId`), `team_equipe_create` avec le numéro du nom Ten'Up (« … 2 » → 2,
   aussi pour le lien de poule depuis S6b). Progression par équipe (`aria-live`). « Trop de
   demandes » : réessayé deux fois après 30 s ; worker occupé (« indisponible ») : deux fois après 5 s. Équipe absente de la poule, ou autre échec : listée
   avec son message, « Réessayer les équipes en échec » (les réussies passent « déjà ajoutées »).

Résultats : l'import crée le calendrier, pas les résultats (une feuille de rencontre = une lecture).
Après un import réussi, une note renvoie à `/team-matches` › « Autres actions » › « Synchroniser Ten’Up »
(`TenupBatchSync`, une feuille toutes les 21 s) — décision du 11/11/2026.

Quotas (migration `2026110920_tenup_club_import.sql`, décisions du 09/11/2026) : la lecture de la
page ouvre pour ce compte et ce club une fenêtre de 10 minutes à **15 lectures / minute** (3 sinon) ;
plafond d'essai **40 / 24 h** ; 5 imports de club par compte et par jour. Comptage commun dans
`team_tenup_read_begin`, interne. `internal` et `saison` : pas de plafond journalier (inchangé).
Coût du CAC au 09/11/2026 : 1 + 3 championnats + 8 poules = 12 lectures.

Limites connues : la page ne montre que les **rencontres à venir** (une équipe dont la phase est
finie n'apparaît pas) et 30 cartes ont été vues sans pagination visible (une limite côté Ten'Up
n'est pas exclue) : le lien de poule couvre ces cas.

Tests : `tests/tenup-club-worker.test.mjs` (fixture réelle `tests/fixtures/tenup-club.html`,
extrait de 7 cartes), `tests/tenup-club-edge.test.mjs`, `tests/tenup-club-import-sql.test.mjs`,
`tests/team-onboarding-client.test.mjs` et `tests/first-steps.test.mjs` (parcours dans le cadre).

Opérations avant le merge : appliquer la migration, déployer l'Edge `tenup-sync`, redéployer le
worker Ten'Up (`kind: 'club'`). Sans le worker à jour, la lecture de la page échoue avec un message
renvoyant au lien de poule, qui reste fonctionnel.

## 11. Vos affiches (S7, brief `SAAS_08_S7_affiches.md`)

Entrée `affiches` de `FIRST_STEPS`, entre `equipes` et `fin` (« Étape 3 sur 3 · 1 minute »). Le
fondateur génère la vraie affiche des rencontres (`TeamMatchImagePreview`, rendu inchangé) sans
avoir fourni de fond, puis la télécharge ou la publie en actu.

### 11.1 Fond « Aux couleurs du club » (décision 1 du 13/11/2026)

Un club neuf n'a aucun fond, et la génération est refusée sans fond (règle PR7, `postersSchema`).
Plutôt qu'un rendu spécial sans fond, l'étape **crée un vrai fond** et l'enregistre comme les
autres :

- **Dessin** (`lib/clubPosterBackground.ts`, canvas 1414 × 2000, PNG) : en-tête de 0 à 245 px
  sur `--brand-fill` (pastille blanche avec le logo, sinon initiales cerclées ; « Les rencontres
  du week-end » ; nom du club, réduit puis coupé s'il est long ; filet), texte en
  `--brand-foreground` (≥ 4,5:1, tokens `brandTokens` de `shared/`). En dessous, aucun texte :
  dégradé de `--brand-fill` vers la même teinte à 78 % de luminosité, lignes d'un court de double
  à 9 % d'opacité, pour que le fond ne soit pas un aplat. Zones libres : cartes de 245 à 1720 px
  (marges de 60 px), partenaires à partir de 1760 px. Logo chargé en CORS ; illisible → initiales.
- **Enregistrement** (`lib/defaultPosterBackground.ts`) : téléversé par `uploadConfigImage` (même
  bucket et même dossier `content-images/<club_id>/config/` que « Configuration du site ›
  Affiches »), inscrit dans `posters.team_match_backgrounds` sous le nom « Aux couleurs du club ».
  Le club le garde, le supprime ou en ajoute d'autres depuis cet écran.
- **Quand** : à chaque entrée dans l'étape, mais **seulement si la liste est vide** (relue en
  base, puis relue dans l'écriture : un fond ajouté entre-temps l'emporte et l'image en trop est
  supprimée), **jamais pour un club `internal`**. Recharger ou revenir à l'étape ne crée donc pas
  de second fond ; un club qui l'a supprimé et revient à l'étape en reçoit un nouveau, la liste
  étant de nouveau vide. Appels simultanés dans un onglet : une seule promesse par club.
- Clubs existants sans fond : rien d'automatique (décision 3) ; S8 pourra proposer le générateur.

### 11.2 Parcours

1. **Rencontres à annoncer** : la sélection de `PosterPanel`, extraite dans
   `teamMatches/poster/posterSelection.ts` (semaine courante présélectionnée, 8 au plus, semaine
   suivante puis « Plus tard », « Tout prendre »), saison retenue par `useTeamSaisons`, rencontres
   lues par `useTeamSeasonGrid`. Carte : « Hommes Seniors 1 · vs adversaire / date · au club ».
2. **Fond de l'affiche** : « Couleurs du club » sélectionné ; les autres fonds du club, s'il en a,
   par leur nom. Pas de « Votre propre fond » (décision 2). Échec de préparation : message et
   « Réessayer » ; sans fond, « Générer l'affiche » reste désactivé.
3. **« Générer l'affiche »** : `exportPosterJpeg` (export de `PosterPanel`) sur le nœud hors
   viewport, partenaires tirés comme dans le panneau. L'étape est **terminée** dès l'affiche
   générée (décision 4). Toute nouvelle coche ou un autre fond invalide l'affiche.
4. **Après génération** : « Publier en actu » (facultatif, `saveActu` : titre « Les rencontres du
   week-end », une ligne par rencontre, image JPEG dans `actu-images`, notification ; une relance
   reprend l'actu créée), « Télécharger » (`affiche-rencontres-<samedi>.jpg`), « Terminer → ».
5. Sans équipe : « Ajoutez d'abord une équipe », bouton vers l'étape équipes, « Passer cette
   étape ». Équipes sans rencontre à venir : message, « Passer cette étape ». Le report passe par
   `skipFirstStep` (§9.2). Récapitulatif final : « Affiche du week-end prête / à générer ».

Aperçu (`AffichesPreview`) : l'affiche réelle, mise à l'échelle de sa boîte (440 px, 400 px à côté
du téléphone, pleine largeur sur mobile), à la place du téléphone ; après génération, le téléphone
revient avec l'onglet Actu, relu à chaque publication. Étape et aperçu partagent leur état par
`posterSignal.ts`, comme `teamsSignal.ts` en S6.

Limite connue (rendu `TeamMatchImagePreview`, inchangé) : sur une couleur claire (`#e8c547`), le
jour, l'heure et « Au club » des cartes sont écrits dans la couleur du club et peu lisibles.

### 11.3 Tests et recette

`tests/first-steps.test.mjs` (`npm run test:club-signup`) : dessin du fond (dimensions, couleur,
contraste du titre ≥ 4,5:1 pour `#e8c547`, `#3a9a5c`, `#1d3f8f`, texte limité à l'en-tête, logo ou
initiales, pas un aplat), idempotence de la création (appels simultanés, liste non vide, `internal`,
fond ajouté entre-temps, échec), sélection partagée avec `PosterPanel`, parcours complet dans le
cadre (création, aperçu, génération = complétion, téléchargement, publication, rechargement sans
second fond), états sans équipe et sans rencontre, report persisté, échec du fond et relance.
Contrôle visuel fait sur 1, 4 et 8 rencontres, avec et sans partenaires, avec et sans logo, pour
les trois couleurs, en desktop et à 390 px.

Aucune opération hors code : pas de migration, pas d'Edge Function. Le bucket `content-images` et
ses policies (`20260822_config_storage_tenant.sql`) servent déjà aux fonds.
