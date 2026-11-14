// SaaS S8b-bis — ce que Ten'Up ne fournit pas et qui fait vivre le site : le mot du président·e,
// les partenaires (repris par les affiches et l'app) et les chiffres clés. Facultatif : signalé
// après l'import Ten'Up et dans la checklist du tableau de bord, jamais compté ni bloquant.
import type { ClubConfig } from './clubConfig';

export type SiteExtra = { id: 'president_quote' | 'partners' | 'stats'; title: string; detail: string; panel: 'club' | 'partners' | 'home' };

export function missingSiteExtras(config: ClubConfig): SiteExtra[] {
  const extras: SiteExtra[] = [];
  if (!config.club.president.quote.trim()) {
    extras.push({ id: 'president_quote', panel: 'club', title: 'Le mot du président·e', detail: 'Quelques lignes pour accueillir les visiteurs sur la page « Le club ».' });
  }
  if (config.partners.length === 0) {
    extras.push({ id: 'partners', panel: 'partners', title: 'Vos partenaires', detail: 'Leurs logos sur le site, les affiches et l’app : un vrai plus pour vos sponsors.' });
  }
  if (config.home.stats.length === 0) {
    extras.push({ id: 'stats', panel: 'home', title: 'Vos chiffres clés', detail: 'Courts, adhérents, années d’existence : quatre chiffres en tête de l’accueil.' });
  }
  return extras;
}

export const extraPanelPath = (extra: SiteExtra) => `/admin/site#panneau-${extra.panel}`;
