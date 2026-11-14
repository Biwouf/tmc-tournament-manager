// Forme minimale lue par la règle : la `ClubConfig` de la vitrine comme celle du BO la satisfont.
type Text = string | undefined;
export type SiteReadinessConfig = {
  settings: { search_indexing: boolean; show_stats: boolean; show_partners: boolean };
  partners: { logo?: Text }[];
  home: { published: boolean; hero_title?: Text; hero_subtitle?: Text; school_teaser_text?: Text; school_teaser_title?: Text; cta_text?: Text;
    infra_teaser: { label?: Text }[]; stats: { value?: Text; label?: Text }[] };
  club: { president: { name?: Text; quote?: Text }; coach: { name?: Text; bio?: Text }; values: Text[]; methods: Text[]; levels: Text[];
    programs: { name?: Text }[]; board: { name?: Text }[] };
  infra: { courts: { label?: Text }[]; clubhouse: { text?: Text }; locker_rooms: { text?: Text } };
  pricing: { published: boolean; season?: Text; lessons: { name?: Text; price?: number }[]; membership: { name?: Text; price?: number }[];
    other_fees: { label?: Text; price?: Text }[] };
  contact: { published: boolean; address_street?: Text; address_postal_code?: Text; address_city?: Text; phone?: Text; email?: Text;
    maps_url?: Text; opening_hours: { day?: Text; time?: Text }[] };
};
export type SitePageKey = 'home' | 'club' | 'infra' | 'pricing' | 'contact';
export function hasContent(config: SiteReadinessConfig, key: SitePageKey): boolean;
export function siteGaps(config: SiteReadinessConfig): string[];
export function isReadyForIndexing(config: SiteReadinessConfig): boolean;
