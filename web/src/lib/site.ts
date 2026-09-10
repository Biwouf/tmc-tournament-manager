import type { HomeFeeds } from './feeds';
import { clubConfigSchema, type ClubConfig } from './clubConfig';

export type Club = {
  id: string; slug: string; name: string; sport: string; status: string;
  custom_domain: string | null;
};
export type Site = { club: Club; config: ClubConfig; clubName: string; origin: string; optimizeImages?: boolean; feeds?: HomeFeeds };
export const PAGES = [
  { path: '/', key: 'home', label: 'Accueil' },
  { path: '/club', key: 'club', label: 'Le Club' },
  { path: '/infrastructures', key: 'infra', label: 'Infrastructures' },
  { path: '/tarifs', key: 'pricing', label: 'Tarifs' },
  { path: '/contact', key: 'contact', label: 'Contact' },
] as const;
export type Page = typeof PAGES[number];
export const pageAt = (path: string) => PAGES.find((page) => page.path === path);
const text = (value?: string) => Boolean(value?.trim());

/** Titres, photos seules et boutons ne suffisent pas à publier une page intérieure. */
export function hasContent(config: ClubConfig, key: Page['key']): boolean {
  const { home, club, infra, pricing, contact } = config;
  switch (key) {
    case 'home': return [home.hero_title, home.hero_subtitle, home.school_teaser_text,
      home.school_teaser_title, home.cta_text].some(text) || home.infra_teaser.some(x => text(x.label)) ||
      (config.settings.show_stats && home.stats.some(x => text(x.value) && text(x.label))) ||
      (config.settings.show_partners && config.partners.some(x => text(x.logo)));
    case 'club': return [club.president.name, club.president.quote, club.coach.name, club.coach.bio,
      ...club.values, ...club.methods, ...club.levels].some(text) ||
      club.programs.some(x => text(x.name)) || club.board.some(x => text(x.name));
    case 'infra': return infra.courts.some(x => text(x.label)) ||
      [infra.clubhouse.text, infra.locker_rooms.text].some(text);
    case 'pricing': return pricing.lessons.some(x => text(x.name)) ||
      pricing.membership.some(x => text(x.name)) || pricing.other_fees.some(x => text(x.label));
    case 'contact': return [contact.address_street, contact.address_city, contact.phone, contact.email,
      contact.maps_url].some(text) || contact.opening_hours.some(x => text(x.day) && text(x.time));
  }
}
export function isPublished(config: ClubConfig, page: Page): boolean {
  return config[page.key].published && hasContent(config, page.key);
}

/** Pas d'ouverture automatique à l'indexation pendant la saisie des informations pratiques. */
export function isReadyForIndexing(config: ClubConfig): boolean {
  const { pricing, contact } = config;
  const prices = [...pricing.lessons, ...pricing.membership];
  return config.settings.search_indexing && config.home.published && hasContent(config, 'home') &&
    pricing.published && hasContent(config, 'pricing') && text(pricing.season) &&
    prices.every(x => text(x.name) && x.price !== undefined && Number.isFinite(x.price) && x.price >= 0) &&
    pricing.other_fees.every(x => text(x.label) && text(x.price)) &&
    contact.published && text(contact.address_street) && text(contact.address_postal_code) &&
    text(contact.address_city) && (text(contact.phone) || text(contact.email));
}

/** Ne sérialise ni les clés inconnues, ni les fonds BO, ni le contenu des pages retirées. */
export function publicConfig(raw: unknown): ClubConfig {
  const config = clubConfigSchema.parse(raw && typeof raw === 'object' && !Array.isArray(raw) ? raw : {});
  const defaults = clubConfigSchema.parse({});
  config.posters = defaults.posters;
  for (const { key } of PAGES) {
    if (!config[key].published) Object.assign(config, { [key]: { ...defaults[key], published: false } });
  }
  return config;
}
export function pageHeading(site: Site, page: Page): string {
  const group = site.config[page.key];
  if ('page_title' in group && group.page_title?.trim()) return group.page_title;
  if (page.key === 'home') return site.config.home.hero_title || site.clubName;
  return `${page.label} — ${site.clubName}`;
}
