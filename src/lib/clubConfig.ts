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
// Périmètre des groupes : `brand`, `home`, `contact` seulement — ceux que PR9 consommera en
// premier. Le brief §5 interdit explicitement d'inventer les ~80 clés d'un coup : mieux vaut un
// arbre restreint et une règle de tolérance que 80 clés à migrer. Les groupes restants
// (`club`, `infra`, `pricing`, `social`, `partners`, `legal`, `settings`) s'ajouteront quand
// leurs consommateurs existeront, sans casser les configs déjà écrites.

import { z } from 'zod';

/** Version de forme du JSONB. Incrémenter uniquement pour un changement non rétro-compatible. */
export const CLUB_CONFIG_VERSION = 1;

const text = z.string().catch('');
const optionalText = z.string().optional().catch(undefined);

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
  contact: contactSchema
    .catch(() => contactSchema.parse({}))
    .default(() => contactSchema.parse({})),
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
