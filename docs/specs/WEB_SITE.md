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
| `index.css` | Tokens « conviviale », mapping `@theme inline` vers Tailwind, classes `.shell` / `.section` / `.btn` / `.card` / `.field` |
| `lib/supabase.ts` | Client `anon`, **`persistSession: false`** (site public, aucune auth) |
| `lib/clubConfig.ts` | **Copie** de `src/lib/clubConfig.ts`, synchronisée manuellement. Ne rien y diverger. |
| `lib/configImage.ts` | Valeur de config → URL affichable. Accepte une URL publique complète (ce qu'écrit le BO) **ou** une clé Storage nue (ce que tolère le contrat). Vide → `null`, et `null` masque le bloc. |
| `lib/tokens.ts` | Dérive `--brand` / `--brand-dark` / `--brand-soft` de `brand.color`. Fallback `#e51828` (brief §4) — seule couleur en dur tolérée. |
| `lib/price.ts` | Montant du contrat (nombre) → texte. Aucune période ajoutée : le contrat n'en porte pas. |
| `contexts/SiteContext.tsx` | Résolution du tenant + config + application des tokens + `document.title`. `useSite()` rend `{ club, config, clubName }`. |
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
