import { z } from 'zod';
import type { Site } from '../lib/site';
import { feedExcerpt, type HomeFeeds } from '../lib/feeds';
import type { Runtime } from './tenant';

const date = z.string().refine(value => Number.isFinite(Date.parse(value)));
const image = z.string().url().refine(value => /^https?:\/\//.test(value));
const focal = z.object({ x: z.number().min(0).max(100), y: z.number().min(0).max(100) });
const newsSchema = z.object({
  id: z.string(), club_id: z.string(), titre: z.string().trim().min(1), contenu: z.string(),
  published: z.literal(true), published_at: date.nullable(),
  image_urls: z.array(image.nullable().catch(null)).catch([]),
  image_focal_points: z.array(focal.nullable().catch(null)).catch([]),
});
const eventSchema = z.object({
  id: z.string(), club_id: z.string(), titre: z.string().trim().min(1), type: z.string(),
  description: z.string(), date_debut: date, date_fin: date.nullable(),
  prix: z.number().nonnegative().nullable(),
});

/** Lectures anon bornées, après résolution du club et uniquement sur l’accueil rendu. */
export async function loadHomeFeeds(
  site: Site, runtime: Runtime, fetcher: typeof fetch = fetch, now = new Date(),
): Promise<HomeFeeds> {
  const timestamp = now.toISOString();
  async function read(table: string, params: Record<string, string>): Promise<unknown[]> {
    const url = new URL(`/rest/v1/${table}`, runtime.supabaseUrl);
    for (const [key, value] of Object.entries({ ...params, club_id: `eq.${site.club.id}` })) {
      url.searchParams.set(key, value);
    }
    try {
      const response = await fetcher(url, {
        headers: { apikey: runtime.anonKey, Authorization: `Bearer ${runtime.anonKey}` },
        cache: 'no-store', signal: AbortSignal.timeout(4000),
      });
      if (!response.ok) throw new Error('Feed unavailable');
      const rows: unknown = await response.json();
      if (!Array.isArray(rows)) throw new Error('Invalid feed');
      return rows;
    } catch {
      // Pas de données, URL, clé ou contenu de réponse dans les logs.
      console.warn(`[vitrine] Flux ${table} indisponible`);
      return [];
    }
  }
  const [newsRows, eventRows] = await Promise.all([
    site.config.settings.show_news ? read('actus', {
      select: 'id,club_id,titre,contenu,image_urls,image_focal_points,published,published_at',
      published: 'eq.true', order: 'published_at.desc.nullslast,id.asc', limit: '2',
    }) : [],
    site.config.settings.show_events ? read('events', {
      select: 'id,club_id,titre,type,description,date_debut,date_fin,prix',
      or: `(date_fin.gte.${timestamp},and(date_fin.is.null,date_debut.gte.${timestamp}))`,
      order: 'date_debut.asc,id.asc', limit: '3',
    }) : [],
  ]);
  return {
    news: newsRows.flatMap(row => {
      const parsed = newsSchema.safeParse(row);
      if (!parsed.success || parsed.data.club_id !== site.club.id) return [];
      const n = parsed.data;
      return [{ id: n.id, titre: n.titre, excerpt: feedExcerpt(n.contenu),
        content: n.contenu, images: n.image_urls.filter((url): url is string => url !== null),
        image: n.image_urls[0] || null, focal: n.image_focal_points[0] || null,
        published_at: n.published_at }];
    }).slice(0, 2),
    events: eventRows.flatMap(row => {
      const parsed = eventSchema.safeParse(row);
      if (!parsed.success || parsed.data.club_id !== site.club.id) return [];
      const e = parsed.data;
      if (Date.parse(e.date_fin || e.date_debut) < now.getTime()) return [];
      return [{ id: e.id, titre: e.titre, type: e.type, excerpt: feedExcerpt(e.description),
        date_debut: e.date_debut, date_fin: e.date_fin, prix: e.prix }];
    }).slice(0, 3),
  };
}
