# WEB_SITE.md — Site vitrine public (`web/`)

> Troisième app du produit, livrée par **PR9** (phase 4 de `MULTI_TENANT.md`).
> Références amont : `docs/briefs/web_site_brief.md` (structure des 5 pages, variables, design
> tokens) et `docs/briefs/struct_web_site.html` (maquette). Ces deux fichiers sont **locaux et
> non versionnés** (`docs/briefs/` est gitignoré) : ce document est la référence versionnée.

---

## 1. Ce que c'est

Un site vitrine **public**, servi sur `<slug>.feelike.app`, **entièrement** rendu depuis
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
vitrine lit *une* ligne au montage et n'a rien à invalider. Police **`Manrope` auto-hébergée**
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
(réutilise `contact.*`). Toute autre URL rend l'accueil — une vitrine n'a pas de 404 utile, et
la page « club inconnu » est PR13.

Les deux boutons du bandeau d’accueil sont fixes : **« Nous contacter »** ouvre le drawer
et **« Découvrir le club »** navigue vers `/club`. Ils apparaissent dès que le bandeau a du
contenu ; leurs libellés ne font pas partie de la configuration. Les anciennes clés
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
que le H1 est le seul des deux à venir de la config — et que `page_title` fait disparaître le H1
sans faire disparaître l'en-tête (§3) : un bandeau réduit au nom de la page n'est pas un bloc
creux, et le sur-titre étant en dur, il ne peut pas manquer. `PageHeader` ne rend jamais `null`.

✅ **Dette fermée par PR9-ter** : le libellé du champ au BO (`/admin/site`) disait « Titre de la
page » — et non « Titre H1 de la page », comme l'annonçaient à tort cette note et le brief
PR9-ter §6 — alors que ce champ est devenu une **accroche**. Il dit désormais **« Accroche de la
page »**, avec une aide nommant le sur-titre en dur de la page concernée. Les clubs déjà
configurés y ont souvent saisi le nom de la page, qui fait alors doublon avec le sur-titre : le
libellé corrigé le leur signale, mais **aucune donnée n'est modifiée**.

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
- Une page dont tout le contenu est vide reste accessible et rend le chrome (header/footer).
  Pas de 404.
- Le nom affiché est `brand.name || clubs.name` : `brand.name` peut être vide, `clubs.name` est
  toujours renseigné (c'est la console qui le crée). Le repli est fait **une fois**, dans
  `SiteContext`.
- Le formulaire de contact fait exception : ses champs sont **fixes** (non configurables), il
  est donc rendu même sur une config vide.
- Le **sur-titre** des pages intérieures fait exception pour la même raison : il est en dur (§2).
  `page_title` vide fait tomber le H1, pas l'en-tête.
- **Seul placeholder toléré de la vitrine** : les **initiales** d'un membre du bureau sans photo
  (`club.board[].photo` est optionnel au contrat). Il ne comble pas une entrée absente — il
  complète une entrée **par ailleurs renseignée**, dont le nom et le rôle s'affichent, et évite
  qu'une photo manquante casse la grille. Un membre sans nom **ni** photo n'affiche aucun carré.

C'est le pendant, côté rendu, de la règle 2 de `clubConfig.ts` (« la lecture ne jette jamais ») :
**le rendu n'affiche jamais de trou**.

---

## 4. Résolution du tenant

`web/src/contexts/SiteContext.tsx` — même patron que `src/contexts/ClubContext.tsx` (BO) et sa
copie PWA, **amputé de tout ce qui suppose une session** :

| Dans le BO | Dans `web/` |
|---|---|
| Override de support `localStorage` | ❌ supprimé (pas de super-admin sur un site public) |
| Requête `clubs` authentifiée | ✅ identique, en `anon` |
| Écran bloquant si club introuvable | ✅ conservé, habillé aux tokens de la vitrine |
| — | ✅ charge **aussi** `club_settings.config` dans la même passe |

```ts
function resolveSlug(): string {
  const host = window.location.hostname;
  const match = host.match(/^([a-z0-9-]+)\.feelike\.app$/);
  if (match) return match[1];
  return (import.meta.env.VITE_DEV_CLUB_SLUG as string | undefined) ?? 'cac-tennis';
}
```

- Le préfixe `app-` (PWA, D9) n'est pas traité : c'est un autre projet Vercel. Un
  `app-<slug>.feelike.app` arrivant ici ne résoudrait aucun slug — comportement correct.
- **Deux round-trips au montage, pas plus** : `clubs` (slug → id, name, sport, status) puis
  `club_settings` (config). `parseClubConfig()` est appelé **une fois**, dans le provider ; les
  pages reçoivent un `ClubConfig` normalisé, jamais du JSON brut, et **ne requêtent rien**.
- Club introuvable ou suspendu → écran bloquant sobre. La vraie page « club inconnu » (design,
  slug dans l'URL) est PR13.
- **Favicon (PR9-ter)** : une fois le club résolu, `SiteContext` pose l'icône d'onglet depuis
  `brand.logo`, dans la **même passe** que `document.title` et les tokens de marque. Même geste
  que `pwa/src/App.tsx` et `src/App.tsx` (BO) : le `<link>` est **remplacé**
  (`cloneNode` + `replaceWith`) et jamais muté — changer `href` en place laisse Safari sur
  l'icône déjà en cache —, l'attribut `type` est **retiré** (rien n'impose que le logo d'un club
  soit un PNG), et l'URL est **absolue**, obtenue par `configImageUrl` qui accepte aussi bien
  une URL publique qu'une clé Storage.
  - `web/index.html` ne porte **aucun** `<link rel="icon">` et il n'existe pas de `web/public/` :
    l'élément est **créé** s'il manque. Poser un lien neutre dans `index.html` aurait exigé un
    fichier de repli, c'est-à-dire une icône de plateforme que personne n'a arbitrée — ou un 404
    visible le temps de la résolution.
  - **`brand.logo` vide ⇒ aucun favicon** : l'onglet garde l'icône par défaut du navigateur. Pas
    de repli sur un fichier de la plateforme (la PWA, elle, se replie sur `/icons/icon-192.png`
    parce qu'elle est installable), et **surtout pas sur un logo de CAC** — ce serait
    réinstaller l'identité d'un club en dur, ce que PR7-bis a précisément retiré.
  - Pas d'`apple-touch-icon` : la vitrine n'est pas installable, il n'y en a pas à mettre à jour.

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
| `main.tsx` | Montage + `BrowserRouter` |
| `App.tsx` | Providers, chrome (header / footer / drawer), routes des 5 pages, remise à zéro du scroll |
| `index.css` | Tokens « conviviale », mapping `@theme inline` vers Tailwind, classes `.shell` / `.section` (+ `--sec-top`) / `.page-end` / `.page-h1` / `.btn` / `.card` / `.card-lift` / `.field` |
| `lib/supabase.ts` | Client `anon`, **`persistSession: false`** (site public, aucune auth) |
| `lib/clubConfig.ts` | **Copie** de `src/lib/clubConfig.ts`, synchronisée manuellement. Ne rien y diverger. |
| `lib/configImage.ts` | Valeur de config → URL affichable. Accepte une URL publique complète (ce qu'écrit le BO) **ou** une clé Storage nue (ce que tolère le contrat). Vide → `null`, et `null` masque le bloc. |
| `lib/focalPoint.ts` | `focalPointStyle(fp)` → `{ objectPosition: 'x% y%' }`, repli `50% 50%`. **3ᵉ copie** de `pwa/src/utils/focalPoint.ts`, synchronisée manuellement comme `lib/clubConfig.ts` — corps identique, seul le type importé diffère (`ClubConfigFocalPoint` ici, `ActuFocalPoint` là-bas). |
| `lib/tokens.ts` | Dérive `--brand` / `--brand-dark` / `--brand-soft` de `brand.color`. Fallback `#e51828` (brief §4) — seule couleur en dur tolérée. |
| `lib/price.ts` | Montant du contrat (nombre) → texte. La **période** n'est pas de son ressort : « / an » est ajouté en dur par les composants de tarifs (§7). |
| `contexts/SiteContext.tsx` | Résolution du tenant + config + application des tokens + `document.title` + **favicon depuis `brand.logo`** (§4). `useSite()` rend `{ club, config, clubName }`. |
| `contexts/ContactDrawerContext.tsx` | Ouverture/fermeture du drawer, appelée depuis le header, le menu mobile, le hero, les bannières CTA et le bouton flottant. |
| `components/layout/` | `Header` (sticky + menu mobile), `Footer`, `ContactDrawer` (bouton flottant + panneau), `PageHeader`, `navItems.ts` |
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

### Point d'intérêt des images (PR9-ter)

Une image de config est rendue en `object-fit: cover` dans un conteneur à ratio fixe : elle est
**recadrée**, et un portrait dont le visage n'est pas au centre est coupé. Le contrat porte donc
une **clé sœur optionnelle** à côté de chaque clé image recadrée — `hero_image_focal` à côté de
`hero_image` — et la vitrine l'applique par `focalPointStyle()`. **Clé absente → `50% 50%`**,
c'est-à-dire le comportement d'avant : aucune config existante ne change d'aspect.

**Les 10 images couvertes** (relevées composant par composant : ce sont exactement celles que la
vitrine rend en `cover`) :

| Champ de config | Composant | Cadre |
|---|---|---|
| `home.hero_image` | `HeroSection` | fond plein du bandeau |
| `home.school_teaser_image` | `SchoolTeaserSection` | moitié de la carte, `min-h-64` |
| `home.infra_teaser[].image` | `InfraTeaserSection` | `4/3` |
| `club.president.photo` | `PresidentSection` | médaillon rond `176×176` |
| `club.coach.photo` | `CoachSection` | `4/5` |
| `club.programs[].image` | `ProgramsSection` | `16/9` |
| `club.board[].photo` | `BoardSection` | carré |
| `infra.courts[].image` | `CourtsSection` | `16/10` |
| `infra.clubhouse.images[]` | `ClubhouseSection` | carré |
| `infra.locker_rooms.image` | `LockerRoomsSection` | `16/10` |

**Exclus, et c'est délibéré** : `brand.logo` / `brand.logo_inverse` (header, footer) et
`partners[].logo` sont rendus en **`object-contain`** — ils ne sont jamais coupés, un point
d'intérêt y serait un réglage sans effet ; les deux listes de `posters` ne sortent pas sur la
vitrine.

⚠️ **`infra.clubhouse.images` est le seul cas particulier** : c'est un `list<image>` dont les
entrées sont des **chaînes**, sans place pour une clé sœur. Son point d'intérêt vit dans un
**tableau parallèle** `clubhouse.images_focal`, indexé comme `images` (le patron
d'`actus.image_focal_points`), `null` tenant la place d'une image non recadrée. `ClubhouseSection`
**apparie image et focal AVANT de filtrer** les valeurs vides — filtrer d'abord décalerait tous
les cadrages suivants d'un cran.

Le sélecteur du BO affiche l’image entière à proportions conservées : le clic et la
pastille utilisent les coordonnées de l’image source. L’aperçu reste immobile lors
de la sélection ; seuls les cadres de la vitrine appliquent le recadrage.

### Bandeau d'inscription de `/tarifs` (PR9-ter)

`pricing.cta_*` est un bandeau **sombre** (`--text`) — dernier appel de la page, il doit trancher
sur le fond : `padding: clamp(32px, 4vw, 52px)`, `flex` `space-between`, `gap:24px`, `flex-wrap`,
h3 `clamp(22px,3vw,30px)/800`, texte 16 px à 78 % de blanc (`margin-top:6px`), bouton
`15px 30px` / 16 px / 700 sur `--brand`, rayon 999 px, survol `--brand-dark`.

⚠️ **À ne pas confondre avec `home.cta_*`** (`home/CtaSection.tsx`), un bloc **différent** et
volontairement plus haut : `padding: clamp(40px, 6vw, 72px)`, centré, avec son cercle décoratif
en `position:absolute` sur un conteneur en `overflow:hidden`. La maquette les distingue ; les
aligner l'un sur l'autre les rendrait interchangeables.

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
| **SEO / Open Graph / `<title>` par page** | **dette ouverte** — seul le titre d'onglet global (nom du club) est posé. Une vitrine publique a besoin du reste ; ce n'est dans aucune PR du plan. |
| Page `/mentions-legales` dédiée | hors périmètre — `legal.*` alimente le footer |
| i18n, mode sombre, analytics | non demandés (une balise tierce est une décision RGPD, pas un détail de scaffold) |

---

## 9. Développement local

```bash
cd web
npm install
cp .env.example .env.local   # puis renseigner les clés du projet Supabase de DEV
npm run dev
```

`VITE_DEV_CLUB_SLUG` choisit le club rendu tant que le wildcard `*.feelike.app` n'existe pas.
Le club visé doit être **actif** et la migration `20260909` appliquée sur l'environnement,
sinon la vitrine rend un site vide (la RLS renvoie une config vide, pas une erreur).

Déploiement : projet Vercel séparé, Root Directory `web/`, build `npm run build`, output `dist`.
Variables : `VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY`, `VITE_ENV` (+ `VITE_DEV_CLUB_SLUG` en
preview). Rien à déployer côté Edge Functions.
