import { publicConfig, type Club, type Site } from '../lib/site';

export type Runtime = {
  appEnv: string; deploymentEnv?: string; devSlug?: string; previewHosts: string[];
  supabaseUrl: string; anonKey: string; productionHost?: string;
};
export class SiteError extends Error {
  constructor(public status: number, message: string) { super(message); }
}
const slugPattern = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const reserved = (slug: string) => ['admin', 'www', 'api', 'app'].includes(slug) || slug.startsWith('app-');

export function hostname(authority: string): string {
  if (!/^[a-z0-9.\-[\]:]+$/i.test(authority)) throw new SiteError(404, 'Site introuvable');
  try { return new URL(`https://${authority}`).hostname.toLowerCase().replace(/\.$/, ''); }
  catch { throw new SiteError(404, 'Site introuvable'); }
}
export function canonicalOrigin(club: Club): string {
  if (!slugPattern.test(club.slug) || reserved(club.slug)) throw new SiteError(404, 'Site introuvable');
  // Le domaine personnalisé doit être provisionné et vérifié par la plateforme avant sa saisie.
  const domain = club.custom_domain?.toLowerCase().trim();
  if (domain && (!/^(?:[a-z0-9](?:[a-z0-9-]*[a-z0-9])?\.)+[a-z]{2,}$/.test(domain) ||
      domain.endsWith('.vercel.app') || domain === 'feelike.app' || domain.endsWith('.feelike.app'))) {
    throw new SiteError(503, 'Configuration du domaine indisponible');
  }
  return `https://${domain || `${club.slug}.feelike.app`}`;
}
export function isProduction(runtime: Runtime): boolean {
  return runtime.appEnv === 'production' && runtime.deploymentEnv === 'production';
}

/** Alias technique propre au projet, jamais un repli générique sur vercel.app. */
export function isProductionAlias(authority: string, runtime: Runtime): boolean {
  const host = hostname(authority);
  return runtime.deploymentEnv === 'production' &&
    /^[a-z0-9-]+\.vercel\.app$/.test(host) && host === runtime.productionHost;
}

/** Une lecture jointe : identité, statut et configuration dans le même snapshot SQL. */
export async function loadSite(authority: string, runtime: Runtime, fetcher: typeof fetch = fetch): Promise<Site> {
  const host = hostname(authority);
  const local = !runtime.deploymentEnv && runtime.appEnv === 'development' &&
    ['localhost', '127.0.0.1', '[::1]'].includes(host);
  const preview = runtime.deploymentEnv === 'preview' && runtime.previewHosts.includes(host);
  const match = /^([a-z0-9-]+)\.feelike\.app$/.exec(host);
  let field = 'custom_domain';
  let value = host;
  if (match) {
    if (!slugPattern.test(match[1]) || reserved(match[1])) throw new SiteError(404, 'Site introuvable');
    field = 'slug'; value = match[1];
  } else if (local || preview || isProductionAlias(host, runtime)) {
    if (!runtime.devSlug || !slugPattern.test(runtime.devSlug) || reserved(runtime.devSlug)) {
      throw new SiteError(404, 'Site introuvable');
    }
    field = 'slug'; value = runtime.devSlug;
  } else if (host.endsWith('.vercel.app') || !host.includes('.') || host === 'feelike.app') {
    throw new SiteError(404, 'Site introuvable');
  }
  if (!runtime.supabaseUrl || !runtime.anonKey) throw new SiteError(503, 'Site temporairement indisponible');
  const url = new URL('/rest/v1/clubs', runtime.supabaseUrl);
  url.searchParams.set('select', 'id,slug,name,sport,status,custom_domain,club_settings(config)');
  url.searchParams.set(field, `eq.${value}`);
  let response: Response;
  try {
    response = await fetcher(url, {
      headers: { apikey: runtime.anonKey, Authorization: `Bearer ${runtime.anonKey}` },
      cache: 'no-store', signal: AbortSignal.timeout(8000),
    });
  } catch { throw new SiteError(503, 'Site temporairement indisponible'); }
  if (!response.ok) throw new SiteError(503, 'Site temporairement indisponible');
  const rows = await response.json() as (Club & { club_settings: { config: unknown } | { config: unknown }[] | null })[];
  if (rows.length !== 1 || rows[0].status !== 'active') throw new SiteError(404, 'Site introuvable');
  const { club_settings, ...club } = rows[0];
  const settings = Array.isArray(club_settings) ? club_settings[0] : club_settings;
  // Une relation invisible n'est pas une config vide : migration absente ou RLS en refus.
  if (!settings) throw new SiteError(503, 'Site temporairement indisponible');
  const config = publicConfig(settings.config);
  return { club, config, clubName: config.brand.name || club.name, origin: canonicalOrigin(club), optimizeImages: ['preview', 'production'].includes(runtime.deploymentEnv || '') };
}
