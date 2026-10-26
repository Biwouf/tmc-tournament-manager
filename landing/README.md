# Landing `www.feelike.pro`

Site marketing **statique** de la plateforme (brief S1). Astro 7, aucun JavaScript de framework :
trois petits scripts en ligne (score animé, récit d’un match au défilement, menu mobile) et, si configuré,
Plausible. Tout le texte est dans le HTML généré.

Maquette de référence : `docs/briefs/design_handoff_saas_onboarding/Main.dc.html` (non versionnée).
Tokens repris de `tokens/` (palette « Terre battue » seulement) dans `src/styles/tokens.css`.

## Développement

```bash
cd landing
npm ci
npm run dev                    # http://localhost:4321
npm run build && npm test      # astro check + build statique, puis vérification du HTML de dist/
```

Node 22 (Astro 7.3 exige ≥ 22.12).

## Contenu

| Fichier | Rôle |
|---|---|
| `src/pages/index.astro` | Assemble les sections + JSON-LD (`Organization`, `WebSite`, `SoftwareApplication` avec les offres, `FAQPage`) |
| `src/data/content.ts` | Textes des listes (comparatif, surfaces, moments, étapes, tarifs, FAQ) repris de la maquette |
| `src/components/*.astro` | Une section = un composant |
| `src/config.ts` | Lecture des variables `PUBLIC_*` et règle des CTA |
| `src/assets/affiche-resultat.png` | Moitié « Avec feelike.pro » du curseur : affiche de résultat produite par `renderResultPoster()` du BO, données fictives de la rencontre de gauche |
| `src/assets/captures/` | Captures réelles de la section « trois courts » : `site`, `app`, `backoffice` (`.png`, `.jpg` ou `.webp`). Tant qu'un fichier manque, l'emplacement hachuré de la maquette reste affiché |
| `public/` | `robots.txt` (robots IA autorisés), `llms.txt`, `og.png` (1200×630), `favicon.svg`, `logo.png` |
| `src/pages/mentions-legales.astro`, `cgv.astro` | **Contenu à fournir.** Pages en `noindex` et hors sitemap tant qu'elles sont vides |

## Variables d'environnement (Vercel → Settings → Environment Variables)

| Variable | Rôle | Si absente |
|---|---|---|
| `PUBLIC_SIGNUP_URL` | Cible des CTA d'essai (tunnel S3, `https://admin.feelike.pro/inscription`) | Les CTA d'essai deviennent « Demander un accès » et mènent au call |
| `PUBLIC_BOOKING_URL` | Call de 20 min (Cal.com ou agenda Google) | Repli sur `PUBLIC_CONTACT_EMAIL` ; sans les deux, le bouton « Réserver un créneau » est masqué |
| `PUBLIC_ANALYTICS_DOMAIN` | Domaine Plausible (`www.feelike.pro`) | Aucun script chargé |
| `PUBLIC_PRICE_NOTE` | Mention TVA sous le prix Saison | `[mention TVA à confirmer]` |
| `PUBLIC_CONTACT_EMAIL` | Lien « Contact » du pied de page, repli du call | Lien masqué |

Ce sont des variables **de build** : un changement demande un redéploiement.

Événements Plausible (sans cookie) : `cta_trial_click`, `cta_call_click`, `pricing_view`,
`faq_open` (propriété `question`). À déclarer comme *goals* dans Plausible.

## Mise en service — opérations à faire par Maxime

Rien de ceci n'est exécuté par le code.

1. **Vercel** : nouveau projet (4ᵉ) sur ce dépôt, *Root Directory* `landing`, preset **Astro**
   (détecté), Node **22.x**. Renseigner les variables ci-dessus en *Production*.
2. **Domaines du projet** : ajouter `www.feelike.pro` (domaine exact : il prime sur le wildcard
   `*.feelike.pro` de la vitrine, comme `admin`) et `feelike.pro`. `vercel.json` redirige déjà
   l'apex en **301** vers `www` ; on peut aussi le régler dans Vercel (*Redirect to www.feelike.pro*, 301).
3. **DNS OVH** (zone `feelike.pro`) : `www` en CNAME vers la cible indiquée par Vercel ; l'apex
   en A vers l'IP indiquée par Vercel. Conserver les enregistrements MX/SPF/DKIM existants
   (cf. `docs/DOMAINS_DELIVERY.md`).
4. **Indexation** : `vercel.json` pose `X-Robots-Tag: noindex` sur tout hôte autre que
   `www.feelike.pro` (previews, `*.vercel.app`). Après mise en ligne : Search Console et Bing
   Webmaster Tools, soumettre `https://www.feelike.pro/sitemap.xml`.
5. **Avant l'ouverture publique** : contenu des mentions légales et des CGV (obligation légale),
   lien de réservation, mention TVA.
