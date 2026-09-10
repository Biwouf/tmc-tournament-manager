export type NewsItem = {
  id: string; titre: string; excerpt: string; image: string | null;
  focal: { x: number; y: number } | null; published_at: string | null;
};
export type EventItem = {
  id: string; titre: string; type: string; excerpt: string;
  date_debut: string; date_fin: string | null; prix: number | null;
};
export type HomeFeeds = { news: NewsItem[]; events: EventItem[] };

/** Fuseau explicite : même texte au SSR et à l’hydratation, quel que soit le navigateur. */
export function feedDate(iso: string): string {
  return new Intl.DateTimeFormat('fr-FR', {
    day: 'numeric', month: 'long', year: 'numeric', timeZone: 'Europe/Paris',
  }).format(new Date(iso));
}

/** Les cartes sont des aperçus : ni HTML ni médias incorporés dans les extraits. */
export function feedExcerpt(markdown: string, limit = 180): string {
  const plain = markdown
    .replace(/<[^>]*>/g, '')
    .replace(/!\[[^\]]*\]\([^)]*\)/g, '')
    .replace(/\[([^\]]+)\]\([^)]*\)/g, '$1')
    .replace(/https?:\/\/\S+/g, '')
    .replace(/[#*_`>~|]/g, '')
    .replace(/\s+/g, ' ').trim();
  return plain.length > limit ? `${plain.slice(0, limit).trimEnd()}…` : plain;
}
