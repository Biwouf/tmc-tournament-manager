import type { HomeFeeds } from './feeds';
import { clubConfigSchema, type ClubConfig } from './clubConfig';
import { hasContent } from '../../../shared/siteReadiness.mjs';

export type Club = {
  id: string; slug: string; name: string; sport: string; status: string;
  custom_domain: string | null;
  /** SaaS S2 : `false` pour un club self-serve tant qu'il n'a pas publié son site (noindex). */
  site_published?: boolean;
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
// SaaS S8 : la règle d'indexation vit dans `shared/` (la checklist du BO l'applique aussi).
export { hasContent, isReadyForIndexing } from '../../../shared/siteReadiness.mjs';

export function isPublished(config: ClubConfig, page: Page): boolean {
  return config[page.key].published && hasContent(config, page.key);
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
