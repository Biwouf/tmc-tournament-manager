# WEB_SITE.md — Site vitrine public (`web/`)

> Troisième app du produit, livrée par **PR9** (phase 4 de `MULTI_TENANT.md`).
> Références amont : `docs/briefs/web_site_brief.md` (structure des 5 pages, variables, design
> tokens) et `docs/briefs/struct_web_site.html` (maquette). Ces deux fichiers sont **locaux et
> non versionnés** (`docs/briefs/` est gitignoré) : ce document est la référence versionnée.

---

## 1. Ce que c'est

Un site vitrine **public**, servi sur `<slug>.feelike.app`, **entièrement** rendu côté serveur depuis
`club_settings.config` du club résolu par sous-domaine. Aucun contenu n'est écrit en dur : deux
clubs différents donnent deux sites différents avec le même bundle.

| | |
|---|---|
| Dossier | `web/` (projet Vite autonome, Root Directory Vercel = `web/`) |
| Audience | public — **aucune authentification**, rôle Supabase `anon` |
| Domaine cible | `<slug>.feelike.app` (wildcard = PR13) |
| Source du contenu | `clubs` (identité) + `club_settings.config` (tout le reste) |
| Stack | React 19, TypeScript, Vite, Tailwind CSS v4 (`@tailwindcss/vite`), React Router v7, `@supabase/supabase-js`, `zod` |

**Pas de** `vite-plugin-pwa` (l'app installable est `pwa/`), **pas de** TanStack Query : la
vitrine lit une jointure par requête HTTP et ne conserve aucun cache de contenu. Police **`Manrope` auto-hébergée**
(`@fontsource-variable/manrope`) et non Google Fonts — un site public français ne doit pas
appeler `fonts.gstatic.com` à chaque visite (même raisonnement RGPD que le choix de Brevo, D7).

---

## 2. Les 5 pages

| Route | Page | Groupes de config lus |
|---|---|---|
| `/` | Accueil | `home.*`, `partners`, `settings.*`, `brand.*` |
| `/club` | Le Club | `club.*` |
| `/infrastructures` | Infrastructures | `infra.*` |
| `/tarifs` | Tarifs | `pricing.*` |
| `/contact` | Contact | `contact.*` |

Transverses : header sticky (logo + nom + ville + nav + CTA), menu mobile, footer
(`brand.*` + `contact.*` + `social.*` + `legal.*`), bouton flottant et drawer de contact
(réutilise `contact.*`). Toute autre URL retourne une vraie réponse HTTP 404.

Le menu mobile couvre tout le viewport avec un fond opaque, y compris le bouton flottant
de contact. Il est rendu hors du header flouté : le `backdrop-filter` du header ferait
sinon de celui-ci le bloc contenant du menu `fixed`. Le menu défile indépendamment
si sa hauteur dépasse celle de l’écran.

Les deux boutons du bandeau d’accueil sont fixes : **« Nous contacter »** ouvre le drawer
et le lien **« Découvrir le club »** navigue vers `/club` si cette page est publiée.
Leurs libellés ne font pas partie de la configuration. Les anciennes clés
`home.hero_cta_primary` et `home.hero_cta_secondary` sont ignorées à la lecture et ne sont
plus proposées dans le BO. Sur une image, le bouton secondaire reprend le fond blanc
translucide (14 %, 24 % au survol), la bordure blanche à 40 % et le flou de 6 px de la maquette.
Sans image, il conserve un contour et un texte foncé lisibles sur le fond clair.

### En-tête des pages intérieures

Les quatre pages intérieures ouvrent sur **deux niveaux** (`components/layout/PageHeader.tsx`) :
un **sur-titre EN DUR**, puis `*.page_title` en H1 sous lui.

| Page | Sur-titre (en dur) | H1 |
|---|---|---|
| `/club` | `Le club` | `club.page_title` — `max-width:18ch` |
| `/infrastructures` | `Les infrastructures` | `infra.page_title` |
| `/tarifs` | `Tarifs`, suivi de ` · Saison {pricing.season}` **si** `season` est renseignée | `pricing.page_title`, puis `pricing.note` en mention sous le H1 |
| `/contact` | `Contact` | `contact.page_title` |

Le sur-titre **nomme la page** ; le H1 porte **l'accroche** que le club a écrite. C'est pour ça
que le H1 reprend la config lorsqu’elle est renseignée. Si `page_title` est vide, le rendu
serveur fournit un H1 de repli dérivé de la page et du club (§3), en conservant le sur-titre
et la mise en forme. `PageHeader` ne rend jamais `null`.

⚠️ **Dette** : le libellé du champ au BO (`/admin/site`) dit encore « Titre H1 de la page »
alors que ce champ est devenu une accroche. Le corriger touche `src/` — c'est repris dans
`PR9ter`. Les clubs déjà configurés y ont souvent saisi le nom de la page, qui fait alors
doublon avec le sur-titre.

L'accueil n'est pas concerné : son bandeau a sa propre structure.

**Drapeaux `settings.*`** (défaut positif) : `show_stats` masque la bande chiffres clés,
`show_partners` la bande partenaires. `show_news` / `show_events` sont lus par le contrat mais
ne commandent rien tant que PR10 n'a pas branché les flux.

---

## 3. LA règle de rendu : `config = '{}'` est le cas NOMINAL

Un club fraîchement provisionné par la console super-admin a une config **vide**. C'est le
premier écran que voit un nouveau client, pas un cas limite.

> **Une valeur absente masque son bloc. Elle ne rend jamais un bloc vide.**

- Pas de titre de section suivi du néant, pas de `<img>` sans `src`, pas d'`alt` fantôme.
- Pas de « Lorem », pas de placeholder gris, **aucune valeur d'exemple d'un club existant en
  repli**.
- Une liste vide (`stats`, `partners`, `courts`, `programs`, `board`…) → section entière absente.
- Une page intérieure sans contenu utile, ou retirée (`published: false`), retourne 404 et
  disparaît de la navigation et du sitemap. Un titre, une photo ou un bouton seuls ne suffisent
  pas. L’accueil vide reste accessible avec le nom du club en H1, en `noindex`.
- Le nom affiché est `brand.name || clubs.name` : `brand.name` peut être vide, `clubs.name` est
  toujours renseigné (c'est la console qui le crée). Le repli est fait **une fois**, dans
  le chargement serveur, puis transmis à `SiteContext`.
- Le formulaire de contact fait exception : ses champs sont **fixes** (non configurables), il
  reste disponible dans le drawer même sur une config vide ; la page Contact exige des coordonnées.
- Le **sur-titre** des pages intérieures fait exception pour la même raison : il est en dur (§2).
  `page_title` vide utilise le H1 de repli.
- **Seul placeholder toléré de la vitrine** : les **initiales** d'un membre du bureau sans photo
  (`club.board[].photo` est optionnel au contrat). Il ne comble pas une entrée absente — il
  complète une entrée **par ailleurs renseignée**, dont le nom et le rôle s'affichent, et évite
  qu'une photo manquante casse la grille. Un membre sans nom **ni** photo n'affiche aucun carré.

C'est le pendant, côté rendu, de la règle 2 de `clubConfig.ts` (« la lecture ne jette jamais ») :
**le rendu n'affiche jamais de trou**.

---

## 4. Rendu serveur et résolution du tenant

**Vite + React conservés**, sans changement de framework. `server/tenant.ts` résout le club
sur chaque requête HTTP, puis `server/render.tsx` rend les composants dans un `StaticRouter`.
Une lecture REST `clubs?select=…,club_settings(config)` filtre **le slug ou le domaine exact** :
statut, identité et configuration proviennent du même snapshot SQL. Le rôle reste `anon`.

- `<slug>.feelike.app` : résolution du slug, sans repli ; `admin`, `www`, `api`, `app` et
  `app-*` sont réservés.
- Domaine personnalisé : correspondance exacte avec `clubs.custom_domain`. Cette colonne
  n’est à remplir qu’après vérification et rattachement DNS/Vercel par la plateforme ; la PR
  ne provisionne aucun domaine et n’ajoute pas d’UI custom domain.
- Localhost / loopback : `VITE_DEV_CLUB_SLUG` explicite, **uniquement** avec
  `VITE_ENV=development` et sans `VERCEL_ENV`.
- Preview : repli explicite seulement sur les hôtes `VERCEL_URL` et `VERCEL_BRANCH_URL`, avec
  `VERCEL_ENV=preview`. Aucun repli générique sur `*.vercel.app`.
- Club absent ou suspendu : 404 sans contenu du club. Erreur réseau, DB ou relation
  `club_settings` invisible : 503 + `Retry-After: 60`, jamais un faux site vide.

L’origine canonique vient de la fiche du club : `https://<slug>.feelike.app`, ou son
`custom_domain`. Elle n’est jamais construite aveuglément à partir du Host. En production,
le sous-domaine est redirigé en 308 vers le domaine personnalisé, les slashs finaux sont
normalisés. Les paramètres de suivi ne sont pas dans la canonical et ne changent pas le club.
Les headers forwarded et les paramètres de requête ne choisissent jamais un tenant.

**Actualisation : aucun cache HTML, de données ou CDN**, `Cache-Control: private, no-store,
max-age=0`, `CDN-Cache-Control: no-store`, `Vercel-CDN-Cache-Control: no-store`. Une sauvegarde BO
ou suspension est visible à la requête suivante ; aucune purge ou webhook nécessaire. Aucun
état de club mutable au niveau du module serveur. Le coût est une lecture Supabase et un rendu
par requête ; mesurer la latence avant d’ajouter un cache. Un éventuel cache futur devra être
indexé par origine + club + route + version et purgé aussi lors des suspensions.

`SiteContext` ne charge plus de données : il reçoit le snapshot assaini, sérialisé avec
échappement dans `#site-data`. Les fonds d’affiches BO, les clés inconnues et les groupes de
pages explicitement retirées n’y sont pas inclus. Cette projection n’est **pas** un contrôle
RLS de confidentialité : la configuration source reste publique selon les règles existantes.

`hydrateRoot` réutilise exactement ce snapshot. Les liens React Router portent
`reloadDocument` : chaque navigation actualise le contenu, les métadonnées et les statuts
ensemble. Le retour depuis le cache de navigation navigateur provoque aussi un rechargement.
Une page déjà ouverte n’est pas un abonnement temps réel : les mises à jour prennent effet au
prochain chargement/navigation. Le drawer reste interactif sans requête supplémentaire.

La feuille `src/index.css` est liée directement dans le head de `index.html`, sans import
JavaScript : le navigateur attend les styles avant de peindre le contenu SSR, en dev comme
en production. Vite transforme ce lien en asset CSS au build. Les tokens de marque rendus
par le serveur utilisent `html:root` pour primer sur les valeurs `:root` de repli, même si
Vite déplace la feuille CSS après le style de marque.

---

## 5. RLS — ce que la vitrine a le droit de lire

| Table / bucket | Accès `anon` | Posé par |
|---|---|---|
| `clubs` | `SELECT` `USING (true)` + GRANT | `20260629_multi_tenant_socle.sql` (PR1) |
| `club_settings` | `SELECT` `USING (true)` + GRANT | **`20260909_club_settings_public_read.sql` (PR9)** |
| bucket `content-images` | lecture publique | `20260822_config_storage_tenant.sql` (PR6a) |

Trois propriétés à connaître avant de toucher à cette migration :

1. **`USING (true)` n'est pas une fuite** : la policy RESTRICTIVE `active_club_access`
   (`20260905_audit_content_permissions.sql`) couvre déjà `club_settings` pour `anon` et exige
   `clubs.status = 'active'`. Les deux se composent en ET — un club **suspendu** est invisible
   depuis la vitrine, et la policy de PR9 n'a ni à refaire ni à contredire ce contrôle.
2. **Le cloisonnement par club n'est pas assuré par la RLS pour `anon`** — ici comme sur
   `actus` / `events` : c'est l'app qui filtre (`.eq('club_id', clubId)`). La config d'un autre
   club actif est lisible par qui connaît son `club_id`. Assumé : ce sont les données d'un site
   public.
3. **Le groupe `posters` devient public par ricochet** (`config` est une colonne unique, la RLS
   ne restreint pas une clé de JSONB). Ce sont des fonds d'affiche stockés dans un bucket déjà
   public : rien de sensible. Les vrais secrets (token de Page Facebook) vivent dans
   `club_social_credentials` (PR8) — c'est précisément ce que D10 anticipait.

---

## 6. Structure `web/src/`

| Fichier | Rôle |
|---|---|
| `main.tsx` | Hydratation du snapshot SSR + `BrowserRouter` |
| `App.tsx` | Snapshot en prop, providers, chrome, routes des 5 pages et garde de publication |
| `index.css` | Tokens « conviviale », mapping `@theme inline` vers Tailwind, classes `.shell` / `.section` (+ `--sec-top`) / `.page-end` / `.page-h1` / `.btn` / `.card` / `.card-lift` / `.field` |
| `lib/supabase.ts` | Client `anon`, **`persistSession: false`** (site public, aucune auth) |
| `lib/clubConfig.ts` | **Copie** de `src/lib/clubConfig.ts`, synchronisée manuellement. Ne rien y diverger. |
| `lib/configImage.ts` | Valeur de config → URL affichable. Accepte une URL publique complète (ce qu'écrit le BO) **ou** une clé Storage nue (ce que tolère le contrat). Vide → `null`, et `null` masque le bloc. |
| `lib/tokens.ts` | Dérive `--brand` / `--brand-dark` / `--brand-soft` de `brand.color`. Fallback `#e51828` (brief §4) — seule couleur en dur tolérée. |
| `lib/price.ts` | Montant du contrat (nombre) → texte. La **période** n'est pas de son ressort : « / an » est ajouté en dur par les composants de tarifs (§7). |
| `contexts/SiteContext.tsx` | Provider du snapshot serveur ; `useSite()` rend `{ club, config, clubName, origin, optimizeImages }`. |
| `contexts/ContactDrawerContext.tsx` | Ouverture/fermeture du drawer, appelée depuis le header, le menu mobile, le hero, les bannières CTA et le bouton flottant. |
| `components/layout/` | `Header` (sticky + menu mobile), `Footer`, `ContactDrawer` (bouton flottant + panneau), `PageHeader` (H1 de repli) ; navigation dérivée de `lib/site.ts` |
| `components/home/` | `HeroSection`, `StatsSection`, `SchoolTeaserSection`, `InfraTeaserSection`, `PartnersSection`, `CtaSection` |
| `components/club/` | `PresidentSection`, `ValuesSection`, `CoachSection`, `ProgramsSection`, `BoardSection` |
| `components/infra/` | `CourtsSection`, `ClubhouseSection`, `LockerRoomsSection` |
| `components/pricing/` | `LessonsSection`, `MembershipSection`, `OtherFeesSection`, `PricingCtaSection` |
| `components/contact/` | `ContactForm`, `ContactDetailsSection`, `OpeningHoursSection` |
| `pages/` | `HomePage`, `ClubPage`, `InfraPage`, `PricingPage`, `ContactPage` — assemblage seul, aucune logique |

**Une section = un composant = un fichier.** PR10, PR11 et PR12 partent toutes les trois de
`web/` et seront développées en parallèle : la granularité décide de la quantité de conflits.

---

## 7. Design tokens « conviviale »

Posés en custom properties sur `:root` (`index.css`), exposés à Tailwind via `@theme inline`
(`bg-brand`, `text-muted`, `rounded-card`, `shadow-soft`…).

| Token | Source |
|---|---|
| `--brand` | `config.brand.color`, **fallback `#e51828`** |
| `--brand-dark` | dérivé : luminosité × 0,84 (−16 % **relatifs** — retrancher 16 points écraserait une couleur déjà sombre) |
| `--brand-soft` | dérivé : même teinte à 10 % d'opacité |
| `--bg` `#f7f2ec` · `--bg2` `#efe6db` · `--card` `#ffffff` · `--text` `#2a201f` · `--muted` `#8a7d77` · `--line` `#e8ddd0` | fixes |
| `--radius` `20px` · `--radius-sm` `13px` · `--shadow` `0 16px 44px rgba(70,35,20,.10)` | fixes |

- Boutons pleinement arrondis (`999px`), pastilles rondes, badges « pill ».
- La direction « premium » de la maquette **n'est pas retenue** — ni implémentée, ni derrière un
  flag.
- La vitrine n'utilise **que** `brand.color`. `color_secondary` / `color_accent` existent au
  contrat mais pilotent le thème du BO et de la PWA (`src/lib/theme.ts`) : aucun usage n'est
  inventé ici.

### Rythme vertical

Le gabarit de la maquette est `max-width:1200px; margin:0 auto; padding:<haut> 40px <bas>` :
chaque section ne porte **que son écart au bloc du dessus**, jamais de padding bas. La classe
`.section` applique donc `padding-top: var(--sec-top, 70px); padding-bottom: 0`, et chaque
composant pose sa propre valeur (`[--sec-top:84px]`), relevée section par section dans la
maquette — le rythme est délibérément différent d'une page à l'autre, il n'y a **pas** de valeur
unique.

| Contexte | Valeur |
|---|---|
| En-tête de page | `64px` (`.shell pt-16`) |
| Accueil | `84px` partout |
| `/club` | président `54` · valeurs `70` · encadrement `84` · programmes `48` · bureau `84` |
| `/infrastructures` | courts `48` · club house `74` · vestiaires `74` |
| `/tarifs` | cours `44` · adhésion + frais `64` · bannière `54` |
| `/contact` | `40` |

La respiration avant le footer (`90px` dans la maquette, portée par la dernière section) est
posée **une seule fois sur `<main>`** (`.page-end`) : sur un club à config partielle, la
dernière section rendue n'est pas toujours la même, et l'accrocher à un composant donné la
ferait disparaître avec lui.

### « / an » sur les prix

`pricing.lessons[].price` et `pricing.membership[].price` s'affichent suivis de **« / an » en
dur**. Le contrat ne porte **aucune** périodicité (c'est un simple nombre) : c'est une décision
produit assumée, pas un oubli — ne pas la remplacer par une clé de config sans arbitrage.

- **Jamais sur `pricing.other_fees[]`** : son `price` est du **texte** parce que l'unité y est
  variable (« 15 € / h », « 8 € ») ; y coller « / an » produirait « 15 € / h / an ».
- Une entrée **sans prix** (clé omise — absent ≠ zéro) ne rend **ni** le prix **ni** « / an ».

### Élévation au survol

Les **cartes** — un bloc `--card` + `--shadow` qui se lit comme un objet : tarifs, programmes,
teasers d'infrastructures, courts, membres du bureau — montent de `4px` au survol (`.card-lift`,
`transition: transform .2s`). Les **pastilles de valeurs** en sont exclues : ce sont des
étiquettes. Les boutons montent de `2px` (`.btn-light`, `.btn-lift` du bouton flottant).

L'animation d'**entrée** de la maquette (`cacFadeUp`) n'est pas reprise — survol seul. Tout est
neutralisé sous `@media (prefers-reduced-motion: reduce)`.

---

## 8. Ce qui n'est pas encore là

| Sujet | Livraison |
|---|---|
| Blocs « Dernières actualités » et « Prochains rendez-vous » de l'accueil | **PR10** — emplacements marqués `// PR10` dans `HomePage.tsx`, **rien n'est rendu** en attendant (pas de cadre vide, pas de « bientôt ») |
| Envoi du formulaire de contact | **PR11** — le markup est complet (c'est du design), la **soumission est désactivée** : un bouton inerte vaut mieux qu'un formulaire qui perd les messages d'un vrai visiteur |
| Bannière d'installation PWA | **PR12** |
| Wildcard DNS, page « club inconnu » soignée | **PR13** |
| SEO / GEO technique | Socle implémenté : voir §10 et `docs/SEO_GEO_AUDIT_WEB.md`. Validation du domaine public après déploiement à effectuer. |
| Page `/mentions-legales` dédiée | hors périmètre — `legal.*` alimente le footer |
| i18n, mode sombre, analytics | non demandés (une balise tierce est une décision RGPD, pas un détail de scaffold) |

---

## 9. Développement, tests et déploiement

Projets npm séparés : `npm ci` à la racine pour le BO, puis `npm --prefix web ci` pour la vitrine.
Node **22.x**. Ne pas lancer le serveur Vite seul : il ne sert pas le contrat HTTP SSR.

```bash
cd web
cp .env.example .env.local   # seulement si absent ; clés Supabase DEV
npm run dev -- --port 0     # port libre affiché dans le terminal
npm test                   # fixtures locales, aucune écriture Supabase
npm run build              # client + bundle SSR + Build Output API
npm run check:build         # exécute la fonction empaquetée avec données simulées
npm run preview -- --port 0 # serveur du build, port libre
npm run check:http -- http://127.0.0.1:PORT
```

`check:http` accepte seulement un serveur local et `VITE_ENV=development` ; il contrôle les
routes puis lit au plus deux clubs actifs de dev pour comparer leurs snapshots. L’absence de
second club est signalée ; les tests concurrents sur deux fixtures ne dépendent pas de la base.
Aucun de ces scripts n’enregistre de contenu. Le dev refuse de démarrer si `VITE_ENV` n’est
pas `development`. La preview locale d’un build de dev conserve le `noindex`.

**Vercel** : projet séparé, Root Directory **`web/`**, preset **Other** (`framework: null`),
Node 22.x, installation `npm ci`, build `npm run build`. Retirer l’ancien override Output
Directory `dist` et le rewrite SPA vers `index.html`. Le build produit
**`.vercel/output/config.json` + `functions/site.func/` + `static/assets/`**. Aucun `index.html`
public statique ; il est uniquement le template privé de la fonction. Le manifest Node, le
bundle autonome et son template sont vérifiés par `check:build`.

Variables build : `VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY`, `VITE_ENV`, et
`VITE_DEV_CLUB_SLUG` en local/preview. Variables système Vercel à exposer au runtime :
`VERCEL_ENV`, `VERCEL_URL`, `VERCEL_BRANCH_URL`. Production : `VITE_ENV=production` sur la base
prod ; preview : base dev et `VITE_ENV=development`. Les variables VITE sont intégrées au
build : tout changement de projet Supabase nécessite un rebuild. Aucune clé service role.
La migration `20260909` déjà appliquée en production reste requise ; aucune nouvelle migration
ni Edge Function dans cette PR.

Avant d’ouvrir à l’indexation : rattacher le domaine canonique et HTTPS (wildcard PR13),
vérifier la protection des previews, puis contrôler **sur Vercel** les 200/404/503, les
redirections et les en-têtes sans JS. Tester aussi `/_vercel/image` et la taille effectivement
servie sur mobile. Le test local du bundle ne simule pas le CDN ou l’optimiseur Vercel.
Aucun déploiement n’a été effectué dans cette tâche.

## 10. Publication, SEO / GEO et images

`lib/site.ts` porte les cinq routes, les titres H1 de repli, la disponibilité et la préparation
à l’indexation. `lib/seo.ts` génère titre, description, canonical absolue, Open Graph et JSON-LD
dès le HTML initial. Les descriptions résument les textes de la page ; elles n’ajoutent pas de
prestations ou d’informations locales. Les horaires libres ne deviennent pas des heures structurées.

**Configuration automatique** : aucun champ SEO obligatoire, aucune saisie de canonical ou de
JSON-LD. Chaque groupe de page dispose de `published` (défaut `true`) et de `seo_title` /
`seo_description` facultatifs, repliés dans le BO. Un titre SEO saisi ne publie pas une page
vide. `settings.search_indexing` (défaut `true`) permet de suspendre globalement l’indexation.
Contrat JSONB additif, version 1 inchangée, copies BO/vitrine synchronisées.

L’indexation exige **toutes** les conditions suivantes :

- `VERCEL_ENV=production` et `VITE_ENV=production` ;
- accueil accessible et avec contenu, `settings.search_indexing` actif ;
- tarifs accessibles : saison, au moins une formule/prestation, nom et montant de chaque
  formule, libellé/prix de chaque autre frais (zéro est un prix valide) ;
- contact accessible : rue, code postal, ville, et téléphone ou email.

Sinon les pages accessibles restent en `noindex, follow`. Cela ne remplace pas une validation
éditoriale : textes de test, orthographe, exactitude des horaires et saison sont à contrôler
par le club. Une page intérieure vide ou retirée retourne 404. Le sitemap ne contient que les
pages publiées d’un site prêt à indexer en production ; il est vide en dev/preview et pendant
la préparation. `robots.txt` reste explorable (`Allow: /`) pour que les moteurs puissent lire
`noindex` ; il annonce le sitemap seulement en production prête. Un `Disallow` ne remplace pas
la directive d’exclusion. Les erreurs ont également `X-Robots-Tag: noindex, follow`.

Le JSON-LD relie une entité `SportsClub` stable (`origine/#club`) à chaque `WebPage`. Nom,
logo, adresse, téléphone, email et profils officiels proviennent exclusivement des données
également visibles. Aucun avis, note, coordonnée GPS, statut officiel ou horaire précis inventé.
Pas de priorité à `llms.txt`, pas de promesse de classement, résultat enrichi ou citation IA.

**Images** : `ConfigImage` conserve les originaux et les ratios CSS, réserve les dimensions
des logos, diffère les images sous le bandeau et donne la priorité au hero. Les alternatives
informatives viennent des libellés existants. Sur Vercel seulement, les photos raster du bucket
`content-images/<club_id>/…` utilisent `srcset` / `sizes` et l’optimiseur natif (WebP négocié,
qualité 75, six largeurs bornées). Les URL externes, SVG et GIF restent inchangées. Le build
limite l’optimiseur au bucket public du projet Supabase configuré ; les URLs contiennent le
club et le chemin complet. Un échec d’optimisation revient à la source originale après
hydratation. Le BO donne un nouveau chemin à chaque upload, ce qui renouvelle aussi le cache
image. Une suspension retire les pages, **pas** les fichiers du bucket déjà public.
L’optimisation consomme le quota du projet Vercel ; aucune transformation n’est simulée en local.

Choix techniques : [SSR Vite](https://vite.dev/guide/ssr.html),
[Build Output API Vercel](https://vercel.com/docs/build-output-api/configuration),
[fonctions Node](https://vercel.com/docs/build-output-api/primitives),
[noindex Google](https://developers.google.com/search/docs/crawling-indexing/block-indexing).
