import { renderToString } from 'react-dom/server';
import { StaticRouter } from 'react-router-dom';
import App from '../App';
import { loadHomeFeeds } from './feeds';
import { isPublished, isReadyForIndexing, pageAt, PAGES } from '../lib/site';
import { escapeHtml, headMarkup, jsonForHtml } from '../lib/seo';
import { brandTokens } from '../lib/tokens';
import { hostname, isProduction, isProductionAlias, loadSite, SiteError, type Runtime } from './tenant';

export type HttpResult = { status: number; headers: Record<string, string>; body: string };
const noCache = {
  'Cache-Control': 'private, no-store, max-age=0',
  'CDN-Cache-Control': 'no-store', 'Vercel-CDN-Cache-Control': 'no-store',
};
export const unavailable = (status: number, title: string): HttpResult => ({
  status,
  headers: { ...noCache, 'Content-Type': 'text/html; charset=utf-8', 'X-Robots-Tag': 'noindex, follow',
    ...(status === 503 ? { 'Retry-After': '60' } : {}) },
  body: `<!doctype html><html lang="fr"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>${escapeHtml(title)}</title><meta name="robots" content="noindex, follow"></head><body style="margin:0;background:#f8fafc;color:#0f172a;font-family:system-ui,sans-serif"><main style="box-sizing:border-box;max-width:32rem;margin:12vh auto;padding:2rem"><p style="font-size:.75rem;letter-spacing:.15em;text-transform:uppercase;color:#64748b">Feelike</p><h1 style="font-size:1.75rem;line-height:1.2">${escapeHtml(title)}</h1><p>${status === 503 ? 'Veuillez réessayer dans quelques instants.' : 'Cette adresse ne correspond à aucune page disponible ou le club est actuellement indisponible. Vérifiez le lien reçu ou contactez votre club.'}</p><p style="margin-top:2rem"><a href="" style="color:inherit">Réessayer</a></p></main></body></html>`,
});

export async function renderRequest(
  request: { url: string; host: string; method?: string }, template: string, runtime: Runtime,
  fetcher: typeof fetch = fetch,
): Promise<HttpResult> {
  try {
    if (!['GET', 'HEAD'].includes(request.method || 'GET')) {
      const result = unavailable(405, 'Méthode non autorisée');
      result.headers.Allow = 'GET, HEAD'; return result;
    }
    // N'utilise ni forwarded-host, ni un paramètre de requête pour résoudre le club.
    if (!request.url.startsWith('/') || request.url.startsWith('//') || request.url.includes('\\')) {
      return unavailable(404, 'Page introuvable');
    }
    const url = new URL(request.url, 'https://request.invalid');
    const rawPath = url.pathname;
    const path = rawPath === '/' ? '/' : rawPath.replace(/\/+$/, '');
    const page = pageAt(path);
    if (!page && !['/robots.txt', '/sitemap.xml'].includes(path)) return unavailable(404, 'Page introuvable');
    const site = await loadSite(request.host, runtime, fetcher);
    // L’alias Vercel sert le site sans indexation ni redirection vers le futur domaine canonique.
    const production = isProduction(runtime) && !isProductionAlias(request.host, runtime);
    const ready = isReadyForIndexing(site.config);
    const headers: Record<string, string> = { ...noCache, 'Content-Type': 'text/html; charset=utf-8' };
    if (!production || !ready) headers['X-Robots-Tag'] = 'noindex, follow';
    // Toute URL de page retirée ou vide garde un vrai 404, y compris sur un alias.
    // L'accueil vide reste un écran d'identité utile, explicitement noindex.
    if (page && (!site.config[page.key].published || (page.key !== 'home' && !isPublished(site.config, page)))) {
      return unavailable(404, 'Page introuvable');
    }
    if ((production && hostname(request.host) !== new URL(site.origin).hostname) || rawPath !== path) {
      return { status: 308, headers: { ...headers, Location: `${production ? site.origin : ''}${path}${url.search}` }, body: '' };
    }
    if (path === '/robots.txt') {
      return { status: 200, headers: { ...headers, 'Content-Type': 'text/plain; charset=utf-8' },
        body: `User-agent: *\nAllow: /\n${production && ready ? `Sitemap: ${site.origin}/sitemap.xml\n` : ''}` };
    }
    if (path === '/sitemap.xml') {
      const pages = production && ready ? PAGES.filter(p => isPublished(site.config, p)) : [];
      return { status: 200, headers: { ...headers, 'Content-Type': 'application/xml; charset=utf-8' },
        body: `<?xml version="1.0" encoding="UTF-8"?><urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">${pages.map(p => `<url><loc>${escapeHtml(site.origin + p.path)}</loc></url>`).join('')}</urlset>` };
    }
    if (path === '/') site.feeds = await loadHomeFeeds(site, runtime, fetcher);
    const markup = renderToString(<StaticRouter location={path}><App site={site} /></StaticRouter>);
    const css = Object.entries(brandTokens(site.config.brand.color)).map(([key, value]) => `${key}:${value}`).join(';');
    const body = template
      .replace('<!--site-head-->', () => headMarkup(site, page!, production && ready && isPublished(site.config, page!)))
      // Plus spécifique que les valeurs :root de repli, quel que soit l’ordre des CSS du build.
      .replace('<!--site-style-->', () => `<style>html:root{${css}}</style>`)
      .replace('<!--site-app-->', () => markup)
      .replace('<!--site-data-->', () => `<script id="site-data" type="application/json">${jsonForHtml(site)}</script>`);
    return { status: 200, headers, body };
  } catch (error) {
    return unavailable(error instanceof SiteError ? error.status : 503,
      error instanceof SiteError ? error.message : 'Site temporairement indisponible');
  }
}
