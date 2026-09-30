import { createServer } from 'node:http';
import { timingSafeEqual } from 'node:crypto';
import { chromium } from 'playwright';
import { extractTenupPage } from './parse-page.mjs';

export const validUrl = value => typeof value === 'string' && /^https:\/\/tenup\.fft\.fr\/championnat\/\d+\/division\/\d+\/phase\/\d+\/poule\/\d+\/rencontre\/\d+$/.test(value);
export function createHandler({ token, extract }) {
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
      if (!input || !validUrl(input.url)) return reply(400, { error: 'Lien de rencontre Ten’Up invalide.' });
      const cached = cache.get(input.url);
      if (cached && cached.expires > Date.now()) return reply(200, cached.data);
      if (busy) return reply(429, { error: 'Synchronisation en cours. Réessayez dans une minute.' });
      busy = true;
      try {
        const data = await extract(input.url);
        for (const [key, value] of cache) if (value.expires <= Date.now()) cache.delete(key);
        if (cache.size >= 100) cache.delete(cache.keys().next().value);
        cache.set(input.url, { data, expires: Date.now() + 60_000 });
        reply(200, data);
      } catch {
        reply(502, { error: 'Ten’Up ne fournit pas de feuille complète lisible pour le moment. Réessayez plus tard ou saisissez les résultats manuellement.' });
      } finally { busy = false; }
    } catch { if (!res.headersSent) reply(400, { error: 'Requête interrompue.' }); }
  };
}

export async function extract(url, launchOptions = {}) {
  if (!validUrl(url)) throw new Error('Invalid Tenup URL');
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
    await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 30_000 });
    await page.getByText(/^Simple 1$/, { exact: true }).waitFor({ timeout: 12_000 });
    if (page.url() !== url) throw new Error('Unexpected destination');
    return await page.evaluate(`(${extractTenupPage.toString()})(document)`);
  } finally { clearTimeout(timeout); await browser.close(); }
}

if (process.argv[1] && import.meta.url === new URL(process.argv[1], 'file:').href) {
  const server = createServer(createHandler({ token: process.env.TENUP_WORKER_TOKEN, extract }));
  server.requestTimeout = 55_000;
  server.headersTimeout = 10_000;
  server.listen(Number(process.env.PORT ?? 8788), process.env.HOST ?? '127.0.0.1');
}
