// Multi-tenant — PR6a : contrat de `club_settings.config` (MULTI_TENANT.md §6.1).
//
// Source unique du schéma, des défauts et de la lecture. Écrit pour être déplaçable tel quel
// dans un paquet partagé avec l'app `web/` (PR9) : aucun import React, aucun import Supabase.
//
// Trois règles non négociables (brief §5) :
//   1. Tout est optionnel, tout a un défaut. Un club fraîchement provisionné par la console a
//      `config = '{}'` — c'est le cas NOMINAL, pas un cas limite.
//   2. La lecture ne jette jamais. `safeParse` + fusion avec les défauts : une config
//      incomplète ou malformée doit rendre un BO fonctionnel, pas un écran blanc. La
//      validation stricte est pour l'ÉCRITURE (PR6b), pas pour la lecture.
//   3. Les clés inconnues sont TOLÉRÉES et préservées telles quelles (cf. `parseClubConfig`).
//
// Périmètre des groupes : `brand`, `home`, `contact` (PR6a), puis `social`, `partners`,
// `legal`, `settings` (PR6c) — le chrome du site vitrine —, et enfin `club`, `infra`,
// `pricing` (PR6d) — les trois pages de contenu. Les dix groupes du `web_site_brief.md` §5 y
// sont, et PR9 a de quoi rendre la vitrine : LE CONTRAT DE LA VITRINE EST CLOS.
//
// `posters` (PR7) est le onzième groupe, et il est D'UNE AUTRE NATURE : ces deux images ne
// sortent nulle part sur la vitrine, elles servent de fond aux affiches générées par le BO.
// Il est à part plutôt que glissé dans `brand` précisément pour que PR9 n'ait pas à ignorer
// deux clés au milieu de l'identité du club. Chaque ajout de groupe est resté ADDITIF, donc
// sans incrément de version.

import { z } from 'zod';

/** Version de forme du JSONB. Incrémenter uniquement pour un changement non rétro-compatible. */
export const CLUB_CONFIG_VERSION = 1;

const text = z.string().catch('');
const optionalText = z.string().optional().catch(undefined);
/**
 * Un MONTANT, dans l'esprit de `text` et de `flag` — PR6d, `pricing.*` (§5.5).
 *
 * Absent ≠ zéro : un tarif que le club n'a pas renseigné n'est pas gratuit, et `0` s'afficherait
 * comme un prix. La clé est donc omise, et l'écriture l'omet elle aussi plutôt que d'écrire `0`
 * (`clubConfigWrite.ts`, `amountSchema`). Un `"120"` (chaîne) retombe sur `undefined` plutôt que
 * d'être coercé : la vitrine verrait sinon passer un type que le contrat ne décrit pas.
 */
const amount = z.number().optional().catch(undefined);

// ── brand.* — identité & marque (web_site_brief §5.1) ────────────────────────
const brandSchema = z.object({
  name: text,
  short_name: optionalText,
  sport: text,
  city: text,
  region: optionalText,
  /** Clé Storage ou URL publique. L'upload est PR6b, le rendu PR7-bis / PR9. */
  logo: optionalText,
  logo_inverse: optionalText,
  /**
   * Couleur d'accent. Défaut VIDE, volontairement : le brief §3 interdit de toucher aux
   * couleurs en dur du BO et de la PWA (`#C8102E`) — elles restent la propriété de PR7-bis,
   * qui décidera comment cette clé les remplace. Y mettre un défaut ici reviendrait à
   * attribuer une couleur de plateforme que personne n'a arbitrée.
   */
  color: optionalText,
  legal_form: optionalText,
  copyright: optionalText,
});

// ── home.* — page d'accueil vitrine (web_site_brief §5.2) ────────────────────
const statSchema = z.object({ value: text, label: text });
const infraTeaserSchema = z.object({
  label: text,
  detail: optionalText,
  image: optionalText,
});

const homeSchema = z.object({
  hero_image: optionalText,
  hero_eyebrow: optionalText,
  hero_title: text,
  hero_subtitle: text,
  hero_cta_primary: optionalText,
  hero_cta_secondary: optionalText,
  stats: z.array(statSchema).catch([]),
  school_teaser_eyebrow: optionalText,
  school_teaser_title: optionalText,
  school_teaser_text: optionalText,
  school_teaser_cta: optionalText,
  school_teaser_image: optionalText,
  infra_teaser: z.array(infraTeaserSchema).catch([]),
  cta_title: optionalText,
  cta_text: optionalText,
  cta_button: optionalText,
});

// ── club.* — page « Le Club » (web_site_brief §5.3) ──────────────────────────
// Premiers OBJETS IMBRIQUÉS du contrat (`president`, `coach`) et premières LISTES DE SCALAIRES
// (`values`, `methods`, `levels`, `coach.credentials`). Ce sont bien ces formes-là que le JSONB
// porte et que PR9 lira : côté BO, l'état de formulaire reste plat et ne les connaît qu'aux
// deux points qui lisent et écrivent le JSONB (`clubConfigWrite.ts`).
const presidentSchema = z.object({
  name: text,
  role: text,
  photo: optionalText,
  quote: text,
});

const coachSchema = z.object({
  name: text,
  role: text,
  credentials: z.array(text).catch([]),
  bio: text,
  photo: optionalText,
});

const programSchema = z.object({
  name: text,
  age: optionalText,
  frequency: optionalText,
  description: optionalText,
  image: optionalText,
});

const boardMemberSchema = z.object({ name: text, role: text, photo: optionalText });

const clubSchema = z.object({
  page_title: optionalText,
  president: presidentSchema
    .catch(() => presidentSchema.parse({}))
    .default(() => presidentSchema.parse({})),
  values: z.array(text).catch([]),
  coach: coachSchema.catch(() => coachSchema.parse({})).default(() => coachSchema.parse({})),
  methods: z.array(text).catch([]),
  levels: z.array(text).catch([]),
  programs: z.array(programSchema).catch([]),
  board: z.array(boardMemberSchema).catch([]),
});

// ── infra.* — page « Infrastructures » (web_site_brief §5.4) ─────────────────
const courtSchema = z.object({
  count: text,
  label: text,
  detail: optionalText,
  image: optionalText,
});

const clubhouseSchema = z.object({
  title: optionalText,
  text: optionalText,
  /** Liste de scalaires, d'URL cette fois : `list<image>` et non `list<{ url }>`. */
  images: z.array(text).catch([]),
});

const lockerRoomsSchema = z.object({
  title: optionalText,
  text: optionalText,
  image: optionalText,
});

const infraSchema = z.object({
  page_title: optionalText,
  courts: z.array(courtSchema).catch([]),
  clubhouse: clubhouseSchema
    .catch(() => clubhouseSchema.parse({}))
    .default(() => clubhouseSchema.parse({})),
  locker_rooms: lockerRoomsSchema
    .catch(() => lockerRoomsSchema.parse({}))
    .default(() => lockerRoomsSchema.parse({})),
});

// ── pricing.* — page « Tarifs » (web_site_brief §5.5) ────────────────────────
/**
 * ⚠️ DEUX champs `price`, DEUX types, et c'est VOULU (web_site_brief §5.5) :
 *   - `lessons[].price` et `membership[].price` sont des NOMBRES — la vitrine les met en forme
 *     elle-même (séparateur, devise) et peut les comparer ou les trier ;
 *   - `other_fees[].price` est du TEXTE, parce que l'unité y est variable : « 15€ / h », « 8€ ».
 * Ne pas « harmoniser » l'un sur l'autre.
 */
const lessonSchema = z.object({
  name: text,
  subtitle: optionalText,
  frequency: optionalText,
  price: amount,
  eligibility: optionalText,
});

const membershipSchema = z.object({ name: text, subtitle: optionalText, price: amount });

const otherFeeSchema = z.object({ label: text, price: text });

const pricingSchema = z.object({
  page_title: optionalText,
  season: optionalText,
  note: optionalText,
  lessons: z.array(lessonSchema).catch([]),
  membership: z.array(membershipSchema).catch([]),
  other_fees: z.array(otherFeeSchema).catch([]),
  cta_title: optionalText,
  cta_text: optionalText,
  cta_button: optionalText,
});

// ── contact.* — coordonnées (web_site_brief §5.6) ────────────────────────────
const openingHourSchema = z.object({ day: text, time: text });

const contactSchema = z.object({
  page_title: optionalText,
  address_street: optionalText,
  address_postal_code: optionalText,
  address_city: optionalText,
  phone: optionalText,
  email: optionalText,
  maps_url: optionalText,
  opening_hours: z.array(openingHourSchema).catch([]),
});

// ── social.* — réseaux sociaux (web_site_brief §5.7) ─────────────────────────
const socialSchema = z.object({
  facebook_url: optionalText,
  instagram_url: optionalText,
});

// ── partners — « Ils soutiennent le club » (web_site_brief §5.8) ─────────────
// Une LISTE À LA RACINE, et non un objet de champs : c'est la forme que décrit la spec et que
// PR9 lira. L'écriture la produit telle quelle (`clubConfigWrite.ts`, groupe `kind: 'list'`).
const partnerSchema = z.object({ logo: text, name: optionalText, url: optionalText });

// ── legal.* — mentions légales (web_site_brief §5.9) ─────────────────────────
const legalSchema = z.object({
  publication_director: optionalText,
  host_name: optionalText,
  host_address: optionalText,
});

// ── settings.* — drapeaux d'affichage (web_site_brief §5.10) ─────────────────
/**
 * Défaut POSITIF, à l'inverse de tout le reste du contrat où le défaut est vide : le brief
 * §5.10 veut qu'un club qui n'a rien configuré affiche ses blocs. Clé absente et clé à `true`
 * se lisent donc pareil — seul un `false` explicite masque, ce que l'écriture garantit en
 * enregistrant le booléen plutôt qu'en effaçant la clé.
 *
 * Nommé `flag` et non `bool` : c'est un drapeau d'affichage à défaut positif, pas un booléen
 * neutre. Un booléen dont le défaut serait `false` ne doit PAS réutiliser ce helper.
 */
const flag = z.boolean().catch(true).default(true);

const settingsSchema = z.object({
  show_news: flag,
  show_events: flag,
  show_partners: flag,
  show_stats: flag,
});

// ── posters.* — fonds des affiches générées par le BO (PR7) ─────────────────
/**
 * Deux fonds, deux écrans du back-office — PAS de la vitrine (`ProgrammationImagePage` et
 * `TeamMatchImagePreview`). Le seul groupe du contrat dans ce cas, d'où sa place à part.
 *
 * Absent = PAS DE FOND, et c'est le cas NOMINAL (règle 1) : l'affiche se génère sur son aplat
 * uni. Surtout pas de défaut pointant sur `/tmcs_pentecote.png` — ce serait réinstaller
 * l'identité de CAC en dur dans le code, précisément ce que cette migration démonte.
 *
 * ⚠️ Le fond n'est pas un décor : les textes des deux affiches sont écrits en position absolue
 * à des coordonnées FIGÉES. Le gabarit attendu (794 × 1123 et 1414 × 2000) et les zones à
 * laisser libres sont portés par les specs d'écriture, qui les contrôlent avant l'upload.
 */
const postersSchema = z.object({
  /** Clé Storage ou URL publique — même contrat que `brand.logo`. */
  tmc_background: optionalText,
  team_match_background: optionalText,
});

/**
 * Schéma de LECTURE. Chaque groupe a un défaut, donc `{}` est valide et rend l'arbre complet.
 * `.catch()` sur les feuilles : une clé au mauvais type retombe sur son défaut au lieu
 * d'invalider tout le groupe — c'est la règle 2 appliquée feuille par feuille. Une LISTE
 * retombe en revanche sur `[]` en bloc dès qu'une de ses entrées est malformée : la
 * granularité s'arrête au tableau. Acceptable en lecture ; c'est à la validation stricte de
 * PR6b de refuser l'entrée fautive à l'écriture plutôt que de laisser perdre la liste.
 */
export const clubConfigSchema = z.object({
  version: z.number().int().catch(CLUB_CONFIG_VERSION).default(CLUB_CONFIG_VERSION),
  brand: brandSchema.catch(() => brandSchema.parse({})).default(() => brandSchema.parse({})),
  home: homeSchema.catch(() => homeSchema.parse({})).default(() => homeSchema.parse({})),
  club: clubSchema.catch(() => clubSchema.parse({})).default(() => clubSchema.parse({})),
  infra: infraSchema.catch(() => infraSchema.parse({})).default(() => infraSchema.parse({})),
  pricing: pricingSchema
    .catch(() => pricingSchema.parse({}))
    .default(() => pricingSchema.parse({})),
  contact: contactSchema
    .catch(() => contactSchema.parse({}))
    .default(() => contactSchema.parse({})),
  social: socialSchema.catch(() => socialSchema.parse({})).default(() => socialSchema.parse({})),
  partners: z.array(partnerSchema).catch([]),
  legal: legalSchema.catch(() => legalSchema.parse({})).default(() => legalSchema.parse({})),
  settings: settingsSchema
    .catch(() => settingsSchema.parse({}))
    .default(() => settingsSchema.parse({})),
  posters: postersSchema
    .catch(() => postersSchema.parse({}))
    .default(() => postersSchema.parse({})),
});

export type ClubConfig = z.infer<typeof clubConfigSchema>;

/** L'arbre par défaut — ce que rend un club dont `config = '{}'`. */
export function defaultClubConfig(): ClubConfig {
  return clubConfigSchema.parse({});
}

/**
 * Lit un `club_settings.config` brut. **Ne jette jamais** (règle 2).
 *
 * Les clés inconnues du schéma sont préservées à l'identique dans l'objet rendu : PR6b et PR9
 * ajouteront des groupes, et un BO en ancienne version ne doit pas les effacer en réécrivant
 * la ligne. C'est la contrepartie du périmètre restreint ci-dessus.
 */
export function parseClubConfig(raw: unknown): ClubConfig {
  const source = raw && typeof raw === 'object' && !Array.isArray(raw) ? raw : {};
  const result = clubConfigSchema.safeParse(source);
  const parsed = result.success ? result.data : defaultClubConfig();
  return { ...source, ...parsed } as ClubConfig;
}
