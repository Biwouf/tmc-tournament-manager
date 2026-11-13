import { createServer } from 'node:http';
import { timingSafeEqual } from 'node:crypto';
import { chromium } from 'playwright';
import { extractTenupPage } from './parse-page.mjs';
import { extractTenupCompetition } from './parse-competition.mjs';
import { extractTenupClub } from './parse-club.mjs';
import { poolDayButton, readTenupPool } from './read-pool.mjs';
export const validPoolUrl = value => typeof value === 'string' && /^https:\/\/tenup\.fft\.fr\/championnat\/\d+\?division=\d+&phase=\d+&poule=\d+$/.test(value);
export const validClubUrl = value => typeof value === 'string' && /^https:\/\/tenup\.fft\.fr\/club\/\d+\/competitions\/rencontres$/.test(value);
const KINDS = ['rencontre', 'competition', 'pool', 'club'];
const validKindUrl = (kind, url) => kind === 'pool' ? validPoolUrl(url) : kind === 'competition' ? validCompetitionUrl(url) : kind === 'club' ? validClubUrl(url) : validUrl(url);
export const validCompetitionUrl = value => typeof value === 'string' && /^https:\/\/tenup\.fft\.fr\/championnat\/[0-9]+$/.test(value);

export const validUrl = value => typeof value === 'string' && /^https:\/\/tenup\.fft\.fr\/championnat\/\d+\/division\/\d+\/phase\/\d+\/poule\/\d+\/rencontre\/\d+$/.test(value);
/** The club page is server-rendered with Ten'Up's empty state (« Aucun résultat »), then its
 * encounters load client-side (~0.5 s later, 11/11/2026). Wait for the cards; accept the empty
 * state only once that delay is over, for a club with no upcoming encounter. */
export async function waitForClubCards(page, timeout = 12_000) {
  try {
    await page.locator('main [data-slot="card"]').first().waitFor({ timeout });
  } catch {
    await page.getByText('Aucun résultat', { exact: true }).waitFor({ timeout: 1_000 });
  }
}

// An extraction that never settles (Chromium wedged, `browser.close()` hanging on a saturated
// instance) used to keep `busy` set forever: Vercel cut the request at 60 s but kept the instance,
// which then refused every later call in 1 s (11/11/2026). The deadline always frees the lock;
// `onFatal` lets the hosting entry point recycle a polluted instance.
const FATAL = /ERR_INSUFFICIENT_RESOURCES|Target page, context or browser has been closed|browser has disconnected|Extraction deadline/i;

export function createHandler({ token, extract, deadline = 45_000, onFatal = () => {} }) {
  if (!token || token.length < 32) throw new Error('TENUP_WORKER_TOKEN must contain at least 32 characters');
  let busy = false;
  const cache = new Map();
  return async (req, res) => {
    const reply = (status, body) => { res.writeHead(status, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' }); res.end(JSON.stringify(body)); };
    const auth = Buffer.from(req.headers.authorization ?? '');
    const expected = Buffer.from(`Bearer ${token}`);
    if (auth.length !== expected.length || !timingSafeEqual(auth, expected)) return reply(401, { error: 'Accès refusé.' });
    if (req.method !== 'POST' || req.url !== '/extract') return reply(404, { error: 'Route inconnue.' });
    try {
      let body = '';
      if (req.body === undefined) {
        for await (const chunk of req) { body += chunk; if (Buffer.byteLength(body) > 2048) return reply(413, { error: 'Requête trop volumineuse.' }); }
      } else if (Buffer.byteLength(typeof req.body === 'string' ? req.body : JSON.stringify(req.body)) > 2048) {
        return reply(413, { error: 'Requête trop volumineuse.' });
      }
      let input;
      try { input = req.body === undefined ? JSON.parse(body) : (typeof req.body === 'string' ? JSON.parse(req.body) : req.body); } catch { return reply(400, { error: 'Requête invalide.' }); }
      const kind = input?.kind ?? 'rencontre';
      if (!input || !KINDS.includes(kind) || !validKindUrl(kind, input.url)) return reply(400, { error: 'Lien Ten’Up invalide.' });
      const cached = cache.get(`${kind}:${input.url}`);
      if (cached && cached.expires > Date.now()) return reply(200, cached.data);
      if (busy) return reply(429, { error: 'Synchronisation en cours. Réessayez dans une minute.' });
      busy = true;
      try {
        let timer;
        const data = await Promise.race([
          extract(input.url, kind),
          new Promise((_, reject) => { timer = setTimeout(() => reject(new Error('Extraction deadline exceeded')), deadline); }),
        ]).finally(() => clearTimeout(timer));
        for (const [key, value] of cache) if (value.expires <= Date.now()) cache.delete(key);
        if (cache.size >= 100) cache.delete(cache.keys().next().value);
        cache.set(`${kind}:${input.url}`, { data, expires: Date.now() + 60_000 });
        reply(200, data);
      } catch (error) {
        // No request body, credentials or environment values are logged.
        const message = error instanceof Error ? error.message.slice(0, 2000) : 'Unknown extraction error';
        console.error('[tenup-worker] extraction failed', { kind, error: message });
        reply(502, { error: kind === 'competition'
          ? 'La fiche du championnat Ten’Up est indisponible. Réessayez plus tard ou saisissez la compétition manuellement.'
          : kind === 'pool' ? 'Le calendrier de la poule Ten’Up est indisponible. Réessayez plus tard ou créez l’équipe manuellement.'
          : kind === 'club' ? 'La page du club Ten’Up est indisponible. Réessayez plus tard ou ajoutez vos équipes avec le lien de leur poule.'
          : 'Ten’Up ne fournit pas de feuille complète lisible pour le moment. Réessayez plus tard ou saisissez les résultats manuellement.' });
        // After the reply: the caller gets its answer before the instance is recycled. No timer
        // here: Vercel freezes the instance once the reply is sent, so a timer only fired at the
        // start of the next call and killed it (13/11/2026). The entry point decides when to exit.
        if (FATAL.test(message)) onFatal(message);
      } finally { busy = false; }
    } catch { if (!res.headersSent) reply(400, { error: 'Requête interrompue.' }); }
  };
}

export async function extract(url, launchOptions = {}, kind = 'rencontre') {
  if (!KINDS.includes(kind) || !validKindUrl(kind, url)) throw new Error('Invalid Tenup URL');
  const browser = await chromium.launch({ headless: true, chromiumSandbox: true, timeout: 5_000, ...launchOptions });
  const timeout = setTimeout(() => void browser.close(), 40_000);
  try {
    const context = await browser.newContext({ locale: 'fr-FR', serviceWorkers: 'block', acceptDownloads: false });
    // Restrict every outgoing request, including redirects, to FFT and its queue.
    await context.route('**/*', route => {
      const url = new URL(route.request().url());
      const allowed = url.protocol === 'https:' && !url.port && !url.username && !url.password &&
        (url.hostname === 'tenup.fft.fr' || url.hostname === 'tenup.queue-it.net' || url.hostname.endsWith('.queue-it.net'));
      return allowed ? route.continue() : route.abort();
    });
    const page = await context.newPage();
    // Ten'Up's cookie banner (seen October 2026) locks page scroll, leaving the
    // pool's round selector unreachable. Refuse it whenever it gets in the way.
    // Its « Tout refuser » button is not exposed with a button role.
    const refuseCookies = page.locator('#popin_tc_privacy_button');
    await page.addLocatorHandler(refuseCookies, () => refuseCookies.click());
    await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 30_000 });
    if (kind === 'competition') await page.locator('main p').filter({ hasText: /^Nombre de points pour un double\s*:/ }).waitFor({ timeout: 12_000 });
    else if (kind === 'pool') await poolDayButton(page).waitFor({ timeout: 12_000 });
    else if (kind === 'club') await waitForClubCards(page);
    else await page.getByText(/^Simple 1$/, { exact: true }).waitFor({ timeout: 12_000 });
    if (page.url() !== url) throw new Error('Unexpected destination');
    if (kind === 'pool') return await readTenupPool(page);
    const parser = kind === 'competition' ? extractTenupCompetition : kind === 'club' ? extractTenupClub : extractTenupPage;
    return await page.evaluate(`(${parser.toString()})(document)`);
  } finally {
    clearTimeout(timeout);
    // Never wait forever for a wedged browser: the handler's lock depends on this returning.
    await Promise.race([browser.close().catch(() => {}), new Promise((resolve) => setTimeout(resolve, 5_000))]);
  }
}

if (process.argv[1] && import.meta.url === new URL(process.argv[1], 'file:').href) {
  const server = createServer(createHandler({ token: process.env.TENUP_WORKER_TOKEN, extract }));
  server.requestTimeout = 55_000;
  server.headersTimeout = 10_000;
  server.listen(Number(process.env.PORT ?? 8788), process.env.HOST ?? '127.0.0.1');
}
