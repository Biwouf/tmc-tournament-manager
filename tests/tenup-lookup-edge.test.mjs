// Onboarding Ten'Up d'abord, P1-back — Edge publique `tenup-lookup` : lien, Turnstile, « déjà sur
// feelike » sans lecture, cache de 24 h (non compté), limite par IP, délai du worker → 504, 404,
// images copiées dans `_lookup/<id>/` et contrôlées, jeton HMAC vérifiable, aucune donnée
// personnelle ni URL Ten'Up dans la réponse, aucun journal.
import test from 'node:test';
import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { mkdir, readFile } from 'node:fs/promises';
import { JSDOM } from 'jsdom';
import { extractTenupClubHome, extractTenupClubIdentity } from '../services/tenup-worker/parse-club-profile.mjs';
import { LOGO_VARIANTS as WORKER_VARIANTS, pimpLogo } from '../services/tenup-worker/pimp-logo.mjs';
import { LOGO_VARIANTS, logoChangesText, readLogoVariants, validateLogoResult } from '../shared/tenupLogo.mjs';

const dir = new URL('../node_modules/.tmp/tenup-lookup-edge/', import.meta.url);
const SECRET = 'h'.repeat(40);
const URL_ROOT = 'https://tenup.fft.fr/club/60820110';
const WEBP = new Uint8Array([0x52, 0x49, 0x46, 0x46, 0, 0, 0, 0, 0x57, 0x45, 0x42, 0x50, 1, 2, 3]);

async function bundle(entry, name) {
  await mkdir(dir, { recursive: true });
  const out = new URL(`${name}.mjs`, dir);
  await build({ entryPoints: [new URL(entry, import.meta.url).pathname], outfile: out.pathname, bundle: true, platform: 'node', format: 'esm',
    plugins: [{ name: 'mock', setup(b) {
      b.onResolve({ filter: /^https:/ }, () => ({ path: 'api', namespace: 'mock' }));
      b.onLoad({ filter: /.*/, namespace: 'mock' }, () => ({ contents: 'export const createClient=(...args)=>globalThis.__lookupApi(...args)' }));
    } }] });
  return out;
}

/** Réponse du worker (`kind: 'club-identity'`) bâtie depuis la page réelle de Moissac. */
async function workerProfile() {
  const document = new JSDOM(await readFile(new URL('./fixtures/tenup-profile/60820110-club.html', import.meta.url), 'utf8')).window.document;
  const { installation: _i, ...club } = extractTenupClubHome(document);
  return { url: URL_ROOT, pages: { club: 'ok', equipe: 'skipped', offres: 'skipped', installation: 'skipped' },
    club: { ...club, installation_image: '', courts_count: extractTenupClubIdentity(document).courts }, board: [], offers: [], courts: [] };
}

async function setup() {
  const out = await bundle('../supabase/functions/tenup-lookup/index.ts', 'edge');
  const tokens = await import((await bundle('../supabase/functions/_shared/lookup-token.ts', 'token')).href);
  const profile = await workerProfile();
  const w = {
    env: { SUPABASE_URL: 'https://project.supabase.co', SUPABASE_SERVICE_ROLE_KEY: 'service', TURNSTILE_SECRET_KEY: 'turnstile',
      LOOKUP_HMAC_SECRET: SECRET, TENUP_WORKER_URL: 'https://worker.example/api/extract', TENUP_WORKER_TOKEN: 'worker-token' },
    turnstile: true, clubs: [], cache: null, attempts: 0, limit: 20,
    worker: async () => Response.json(profile), image: async () => new Response(WEBP, { headers: { 'content-length': String(WEBP.length) } }),
    // W3 : un worker antérieur refuse `kind: 'logo'` (400) ; la carte garde alors l'original.
    logo: async () => Response.json({ error: 'Lien Ten’Up invalide.' }, { status: 400 }), logoTimeouts: [],
    calls: [], uploads: [], removed: [], workerBodies: [], ips: [],
  };
  let handler;
  globalThis.Deno = { serve: (fn) => { handler = fn; }, env: { get: (key) => w.env[key] } };
  globalThis.__lookupApi = (_url, key) => {
    assert.equal(key, 'service');
    return {
      from(table) {
        const q = { filters: {},
          select() { return q; }, eq(k, v) { q.filters[k] = v; return q; },
          limit: async () => { w.calls.push('clubs'); return { data: w.clubs.filter((c) => c.tenup_club_id === q.filters.tenup_club_id), error: null }; },
          maybeSingle: async () => { w.calls.push('cache:read'); return { data: w.cache?.tenup_club_id === q.filters.tenup_club_id ? w.cache : null, error: null }; },
          upsert: async (row) => { w.calls.push('cache:write'); w.cache = row; return { error: null }; },
        };
        assert.ok(['clubs', 'tenup_lookup_cache'].includes(table));
        return q;
      },
      rpc: async (name, args) => {
        assert.equal(name, 'tenup_lookup_throttle'); assert.match(args.p_ip, /^[0-9a-f]{64}$/);
        w.calls.push('throttle'); w.ips.push(args.p_ip);
        if (w.attempts >= w.limit) return { data: false, error: null };
        w.attempts++; return { data: true, error: null };
      },
      storage: { from: (bucket) => ({
        upload: async (path, bytes, options) => {
          assert.equal(bucket, 'content-images');
          if (w.uploadFails?.(path)) return { error: { message: 'storage down' } };
          w.uploads.push([path, options.contentType, bytes.length]); return { error: null };
        },
        remove: async (paths) => { w.removed.push(...paths); return { error: null }; },
        getPublicUrl: (path) => ({ data: { publicUrl: `https://project.supabase.co/storage/v1/object/public/${bucket}/${path}` } }),
      }) },
    };
  };
  globalThis.fetch = async (target, init) => {
    const href = String(target);
    if (href === 'https://challenges.cloudflare.com/turnstile/v0/siteverify') {
      w.calls.push('turnstile');
      return Response.json({ success: w.turnstile && new URLSearchParams(init.body).get('response') === 'ok' });
    }
    if (href === 'https://worker.example/api/extract') {
      w.calls.push('worker');
      assert.equal(init.headers.Authorization, 'Bearer worker-token');
      assert.ok(init.signal, 'client deadline');
      const body = JSON.parse(init.body);
      w.workerBodies.push(body);
      if (body.kind === 'logo') { w.calls.push('logo'); return w.logo(body, init); }
      return w.worker(init);
    }
    if (href.startsWith('https://cmsclub.fft.fr/')) { w.calls.push('image'); return w.image(href); }
    throw new Error(`unexpected fetch ${href}`);
  };
  await import(`${out.href}?${Date.now()}`);
  const ask = (body, ip = '203.0.113.7', extra = {}) => handler(new Request('https://edge.example/functions/v1/tenup-lookup', {
    method: 'POST', headers: { 'x-forwarded-for': ip, ...extra }, body: JSON.stringify({ turnstile_token: 'ok', ...body }) }));
  return { w, ask, tokens };
}

test('tenup-lookup: link, Turnstile and configuration checked before anything else', async () => {
  const { w, ask } = await setup();
  for (const url of ['https://evil.test/club/60820110', 'https://tenup.fft.fr/tournoi/123', 'pas un lien', null]) {
    const res = await ask({ url });
    assert.equal(res.status, 400);
    assert.equal((await res.json()).reason, 'bad_link');
  }
  assert.deepEqual(w.calls, [], 'a refused link makes no request');
  w.turnstile = false;
  assert.equal((await ask({ url: URL_ROOT })).status, 403);
  assert.equal((await ask({ url: URL_ROOT, turnstile_token: '' })).status, 403);
  assert.deepEqual(w.calls, ['turnstile']);
  w.turnstile = true;
  w.env.LOOKUP_HMAC_SECRET = 'short';
  assert.equal((await ask({ url: URL_ROOT })).status, 503);
});

test('tenup-lookup: fresh read of the club page, images copied, signed token, nothing personal', async () => {
  const { w, ask, tokens } = await setup();
  const logs = [];
  const [log, error] = [console.log, console.error];
  console.log = console.error = (...args) => logs.push(args);
  let res;
  try { res = await ask({ url: 'https://tenup.fft.fr/club/60820110/offres' }); } finally { [console.log, console.error] = [log, error]; }
  assert.equal(res.status, 200);
  const body = await res.json();
  assert.deepEqual(w.workerBodies.filter((b) => b.kind !== 'logo'), [{ kind: 'club-identity', url: URL_ROOT }], 'any tab is read at the club root');
  assert.deepEqual({ ...body, logo_url: undefined, banner_url: undefined, read_at: undefined, lookup_token: undefined }, {
    ok: true, tenup_club_id: '60820110', name: 'MOISSAC TENNIS CLUB', street: 'Avenue du Sarlac', postal_code: '82200', city: 'MOISSAC',
    sports: ['Tennis', 'Padel', 'Pickleball'], courts: 7, already_on_feelike: false, cached: false,
    logo_url: undefined, banner_url: undefined, read_at: undefined, lookup_token: undefined,
  });
  assert.match(body.logo_url, /^https:\/\/project\.supabase\.co\/storage\/v1\/object\/public\/content-images\/_lookup\/60820110\/\d+-logo\.webp$/);
  assert.match(body.banner_url, /\/_lookup\/60820110\/\d+-banner\.webp$/);
  const text = JSON.stringify(body) + JSON.stringify(w.cache);
  assert.doesNotMatch(text, /cmsclub|0629334604|gmail|facebook|instagram/, 'no Ten\'Up URL, phone, e-mail or social link');
  assert.deepEqual(w.uploads.map(([path, type]) => [path.replace(/\d{13}/, 'T'), type]), [
    ['_lookup/60820110/T-logo.webp', 'image/webp'], ['_lookup/60820110/T-banner.webp', 'image/webp']]);
  assert.deepEqual(w.cache.images, w.uploads.map(([path]) => path));
  assert.equal(w.attempts, 1);
  assert.deepEqual(await tokens.verifyLookupToken(SECRET, body.lookup_token), { tenup_club_id: '60820110', read_at: body.read_at });
  assert.deepEqual(logs, [], 'nothing logged (IP, link, content)');
});

test('tenup-lookup: cache served for 24 h without counting; older entries read again', async () => {
  const { w, ask, tokens } = await setup();
  const first = await (await ask({ url: URL_ROOT })).json();
  w.calls.length = 0;
  const again = await ask({ url: URL_ROOT });
  const second = await again.json();
  assert.equal(second.cached, true);
  assert.equal(second.read_at, first.read_at, 'date of the original read');
  assert.equal(second.logo_url, first.logo_url);
  assert.deepEqual(w.calls, ['turnstile', 'cache:read', 'clubs'], 'no throttle, no worker');
  assert.deepEqual(await tokens.verifyLookupToken(SECRET, second.lookup_token), { tenup_club_id: '60820110', read_at: first.read_at });
  // 21ᵉ demande servie par le cache : toujours servie (le cache ne compte pas).
  w.attempts = 20;
  assert.equal((await ask({ url: URL_ROOT })).status, 200);
  // Plus de 24 h : relue, anciennes images supprimées.
  w.attempts = 0;
  const previous = [...w.cache.images];
  w.cache.read_at = new Date(Date.now() - 25 * 3600 * 1000).toISOString();
  const fresh = await (await ask({ url: URL_ROOT })).json();
  assert.equal(fresh.cached, false);
  assert.deepEqual(w.removed.sort(), previous.sort());
});

test('tenup-lookup: 20 reads per hour per IP, then 429; not found 404; worker down 504', async (t) => {
  // Worker occupé : l'attente de son tour (M6) est passée sans délai réel.
  t.mock.timers.enable({ apis: ['setTimeout', 'Date'], now: Date.now() });
  const pump = setInterval(() => t.mock.timers.tick(1_000), 1);
  t.after(() => clearInterval(pump));
  const { w, ask } = await setup();
  w.attempts = 20;
  const limited = await ask({ url: URL_ROOT });
  assert.equal(limited.status, 429);
  assert.equal((await limited.json()).reason, 'throttled');
  assert.equal(w.calls.includes('worker'), false);
  w.attempts = 0;

  w.worker = async () => Response.json({ error: 'Club introuvable sur Ten’Up.', reason: 'not_found' }, { status: 404 });
  let res = await ask({ url: URL_ROOT });
  assert.equal(res.status, 404);
  assert.equal((await res.json()).reason, 'not_found');
  for (const worker of [
    async () => Response.json({ error: 'busy' }, { status: 429 }), // une poule en cours de lecture
    async () => Response.json({ error: 'x' }, { status: 502 }),
    async () => Response.json({ url: URL_ROOT, pages: {}, club: {} }), // réponse hors schéma
    async () => { throw new DOMException('The operation was aborted due to timeout', 'TimeoutError'); }, // délai de 10 s
  ]) {
    w.worker = worker;
    res = await ask({ url: URL_ROOT });
    assert.equal(res.status, 504);
    assert.equal((await res.json()).reason, 'tenup_unavailable');
  }
  assert.equal(w.cache, null, 'nothing cached after a failure');
  delete w.env.TENUP_WORKER_URL;
  assert.equal((await ask({ url: URL_ROOT })).status, 504);
});

test('tenup-lookup: club already on feelike answers at once, without reading or exposing it', async () => {
  const { w, ask } = await setup();
  w.clubs.push({ id: 'club-existant', tenup_club_id: '60820110', slug: 'secret-slug' });
  let res = await ask({ url: URL_ROOT });
  assert.equal(res.status, 200);
  assert.deepEqual(await res.json(), { ok: true, tenup_club_id: '60820110', already_on_feelike: true });
  assert.deepEqual(w.calls, ['turnstile', 'cache:read', 'clubs'], 'no read, not counted');
  // Seul le nom Ten'Up déjà lu peut être repris du cache.
  w.cache = { tenup_club_id: '60820110', payload: { name: 'MOISSAC TENNIS CLUB', street: 'Avenue du Sarlac' }, images: [], read_at: new Date().toISOString() };
  res = await ask({ url: URL_ROOT });
  assert.deepEqual(await res.json(), { ok: true, tenup_club_id: '60820110', already_on_feelike: true, name: 'MOISSAC TENNIS CLUB' });
});

test('tenup-lookup: images controlled (host, signature, size); unreadable ones are dropped', async () => {
  const { w, ask } = await setup();
  w.image = async () => new Response(new TextEncoder().encode('<svg onload="alert(1)"/>'));
  let body = await (await ask({ url: URL_ROOT })).json();
  assert.equal(body.logo_url, undefined);
  assert.equal(body.banner_url, undefined);
  assert.equal(w.uploads.length, 0);
  w.cache = null;
  w.image = async () => new Response(WEBP, { headers: { 'content-length': String(6 * 1024 * 1024) } });
  body = await (await ask({ url: URL_ROOT })).json();
  assert.equal(body.logo_url, undefined, 'over 5 MB');
  // Une image hors de cmsclub.fft.fr est refusée dès la validation de la réponse du worker.
  w.cache = null;
  const profile = await workerProfile();
  w.worker = async () => Response.json({ ...profile, club: { ...profile.club, logo: 'https://evil.test/x.png' } });
  assert.equal((await ask({ url: URL_ROOT })).status, 504);
});

test('tenup-lookup: the limit uses the IP rewritten by Cloudflare, not a forged x-forwarded-for', async () => {
  const { w, ask } = await setup();
  const { createHash } = await import('node:crypto');
  const hash = (ip) => createHash('sha256').update(ip).digest('hex');
  // Le client envoie un x-forwarded-for différent à chaque appel ; Cloudflare pose la vraie IP.
  for (const forged of ['1.1.1.1', '2.2.2.2']) {
    w.cache = null;
    await ask({ url: URL_ROOT }, `${forged}, 198.51.100.9`, { 'cf-connecting-ip': '198.51.100.9' });
  }
  assert.deepEqual(w.ips, [hash('198.51.100.9'), hash('198.51.100.9')], 'one bucket for one client');
  // Sans en-tête Cloudflare : repli sur x-forwarded-for (comportement antérieur).
  w.cache = null;
  await ask({ url: URL_ROOT }, '203.0.113.7, 10.0.0.1');
  assert.equal(w.ips.at(-1), hash('203.0.113.7'));
});

// ── W3 : logo retouché (brief §13.4) ──────────────────────────────────────────

const MOISSAC_LOGO = await readFile(new URL('./fixtures/logos/60820110-moissac.jpg', import.meta.url));
const realLogo = async () => Response.json(await pimpLogo(MOISSAC_LOGO));

test('W3 contract: the worker and the Edge share the variant names; malformed results are refused', async () => {
  assert.deepEqual(WORKER_VARIANTS, LOGO_VARIANTS);
  const good = await pimpLogo(MOISSAC_LOGO);
  assert.equal(validateLogoResult(good).verdict, 'cleaned');
  const { [LOGO_VARIANTS[0]]: _drop, ...missing } = good.variants;
  for (const bad of [null, { verdict: 'magic' }, { ...good, variants: missing }, { ...good, variants: { ...good.variants, 'avatar-256': 'PHN2Zz4=' } },
    { ...good, palette: ['red'] }, { ...good, changes: { background: 'pink', trimmed: true, upscaled: false } }, { ...good, source: { width: -1, height: 2, format: 'jpeg' } }]) {
    assert.equal(validateLogoResult(bad), null);
  }
  assert.deepEqual(validateLogoResult({ verdict: 'monogram', reason: 'small' }), { verdict: 'monogram', palette: [] });
  assert.equal(logoChangesText({ background: 'black', trimmed: true, upscaled: true }), 'Fond noir retiré, recadré et net.');
  assert.equal(logoChangesText({ background: 'white', trimmed: true, upscaled: false }), 'Fond blanc retiré et recadré.');
  assert.equal(logoChangesText({ background: null, trimmed: true, upscaled: false }), 'Recadré.');
  const urls = Object.fromEntries(LOGO_VARIANTS.map((n) => [n, `https://x.supabase.co/${n}.png`]));
  assert.deepEqual(readLogoVariants(urls), urls);
  assert.equal(readLogoVariants({ ...urls, 'apple-180': 'javascript:alert(1)' }), null);
  assert.equal(readLogoVariants(undefined), null);
});

test('W3 tenup-lookup: logo cleaned after the identity read, variants stored next to the original, cached', async () => {
  const { w, ask } = await setup();
  w.logo = realLogo;
  const res = await ask({ url: URL_ROOT });
  assert.equal(res.status, 200);
  const body = await res.json();
  assert.deepEqual(w.workerBodies.map((b) => b.kind), ['club-identity', 'logo'], 'one page at a time: identity first');
  assert.match(w.workerBodies[1].url, /^https:\/\/cmsclub\.fft\.fr\//, 'the Ten\'Up logo URL, already validated');
  assert.equal(body.logo_verdict, 'cleaned');
  assert.match(body.logo_url, /\/_lookup\/60820110\/\d+-logo\.webp$/, 'original kept');
  assert.match(body.logo_clean_url, /\/_lookup\/60820110\/\d+-logo-clean-1024\.png$/);
  assert.deepEqual(Object.keys(body.logo_variants), LOGO_VARIANTS);
  for (const [name, url] of Object.entries(body.logo_variants)) assert.match(url, new RegExp(`/_lookup/60820110/\\d+-logo-${name}\\.png$`));
  assert.deepEqual(body.logo_changes, { background: 'black', trimmed: true, upscaled: true });
  assert.deepEqual(body.logo_source, { width: 200, height: 200, format: 'jpeg' });
  assert.equal(body.logo_palette[0], '#f36524');
  assert.ok(!body.logo_palette.includes('#0e1124'));
  const pngs = w.uploads.filter(([path]) => path.endsWith('.png'));
  assert.equal(pngs.length, 7);
  assert.ok(pngs.every(([, type]) => type === 'image/png'));
  assert.equal(w.cache.payload.logo_verdict, 'cleaned');
  assert.equal(w.cache.payload.logo_clean_path, w.cache.payload.logo_variants['clean-1024']);
  assert.equal(w.cache.images.length, 9, 'logo, banner and 7 variants, all purged together');
  assert.doesNotMatch(JSON.stringify(body) + JSON.stringify(w.cache.payload), /cmsclub|base64|iVBOR/);

  // Servi par le cache : mêmes champs, aucun appel au worker.
  w.calls.length = 0;
  const again = await (await ask({ url: URL_ROOT })).json();
  assert.equal(again.cached, true);
  assert.deepEqual([again.logo_verdict, again.logo_clean_url, again.logo_variants, again.logo_changes], [body.logo_verdict, body.logo_clean_url, body.logo_variants, body.logo_changes]);
  assert.equal(w.calls.includes('worker'), false);
});

test('W3 tenup-lookup: never an error — slow, failing, malformed or partly stored logo keeps the original', async () => {
  const { w, ask } = await setup();
  const scenarios = [
    async () => Response.json({ error: 'Logo indisponible.' }, { status: 502 }),
    async () => { throw new DOMException('The operation was aborted due to timeout', 'TimeoutError'); }, // délai de 4 s
    async () => Response.json({ verdict: 'cleaned', variants: {} }),
    async () => new Response('pas du json'),
  ];
  for (const logo of scenarios) {
    w.cache = null; w.logo = logo;
    const res = await ask({ url: URL_ROOT });
    assert.equal(res.status, 200);
    const body = await res.json();
    assert.ok(body.logo_url, 'original');
    for (const key of ['logo_verdict', 'logo_clean_url', 'logo_variants', 'logo_changes']) assert.equal(body[key], undefined, key);
  }
  // Une variante non déposée : les autres sont retirées, l'original reste.
  w.cache = null; w.logo = realLogo; w.removed.length = 0;
  w.uploadFails = (path) => path.endsWith('-logo-apple-180.png');
  let body = await (await ask({ url: URL_ROOT })).json();
  assert.equal(body.logo_verdict, undefined);
  assert.equal(w.removed.filter((p) => /-logo-.+\.png$/.test(p)).length, 6);
  w.uploadFails = undefined;
  // Original illisible : pas de variantes orphelines.
  w.cache = null; w.removed.length = 0;
  w.image = async (href) => href.includes('a4beb186') ? new Response(new TextEncoder().encode('<svg/>')) : new Response(WEBP);
  body = await (await ask({ url: URL_ROOT })).json();
  assert.equal(body.logo_url, undefined);
  assert.equal(body.logo_verdict, undefined);
  assert.equal(w.removed.filter((p) => /-logo-.+\.png$/.test(p)).length, 7);
  // Logo déjà propre, ou trop petit : verdict seul, sans variantes ni ligne avant/après.
  w.image = async () => new Response(WEBP);
  for (const verdict of ['unchanged', 'monogram']) {
    w.cache = null;
    w.logo = async () => Response.json({ verdict, palette: ['#0a238a'], source: { width: 80, height: 80, format: 'png' } });
    body = await (await ask({ url: URL_ROOT })).json();
    assert.equal(body.logo_verdict, verdict);
    assert.equal(body.logo_clean_url, undefined);
    assert.equal(body.logo_variants, undefined);
  }
});

// Onboarding P2 — « N équipes en championnat » sur la carte 02 : page des rencontres lue APRÈS
// l'identité, sur preuve d'une lecture (jeton), seulement si le worker est libre ; jamais bloquant.
const POOL = 'https://tenup.fft.fr/championnat/82000001?division=1&phase=1&poule=1';
const clubPage = (teams) => ({ club: 'MOISSAC TENNIS CLUB', skipped: 0, teams: teams.map(([team, competition], i) => ({
  team, competition, level: 'Départemental', category: 'Seniors', genre: 'Messieurs', dates: ['dim. 29 nov.'],
  pool_url: POOL.replace('poule=1', `poule=${i + 1}`),
})) });

test('P2 tenup-lookup teams: counted from the encounters page, cached 24 h, never blocking', async () => {
  const { w, ask } = await setup();
  const first = await (await ask({ url: URL_ROOT })).json();
  w.worker = async (init) => JSON.parse(init.body).kind === 'club'
    ? Response.json(clubPage([['Moissac TC 1', 'Seniors Messieurs'], ['Moissac TC 2', 'Seniors Messieurs'], ['Moissac TC 1', 'Seniors Dames']]))
    : Response.json({});
  w.calls.length = 0; w.workerBodies.length = 0;
  const teams = (body, ip) => ask({ teams: true, turnstile_token: undefined, ...body }, ip);

  const res = await teams({ lookup_token: first.lookup_token });
  assert.equal(res.status, 200);
  assert.deepEqual(await res.json(), { ok: true, teams: 3, championships: 2, cached: false });
  assert.deepEqual(w.workerBodies, [{ kind: 'club', url: 'https://tenup.fft.fr/club/60820110/competitions/rencontres' }]);
  assert.ok(!w.calls.includes('turnstile'), 'the signed token stands for Turnstile');
  assert.ok(w.calls.includes('throttle'), 'a worker read counts toward the IP limit');
  assert.equal(w.cache.payload.teams_count, 3);

  w.calls.length = 0;
  assert.deepEqual(await (await teams({ lookup_token: first.lookup_token })).json(), { ok: true, teams: 3, championships: 2, cached: true });
  assert.deepEqual(w.calls, ['cache:read'], 'served from the cache: no throttle, no worker');

  // Forged or missing token → 400, nothing read.
  w.calls.length = 0;
  assert.equal((await teams({ lookup_token: `${first.lookup_token}x` })).status, 400);
  assert.equal((await teams({})).status, 400);
  assert.deepEqual(w.calls, []);
});

test('P2 tenup-lookup teams: busy, slow or malformed worker → no line (teams: null); IP limit → 429', async () => {
  const { w, ask } = await setup();
  const { lookup_token } = await (await ask({ url: URL_ROOT })).json();
  const teams = () => ask({ teams: true, lookup_token });
  for (const worker of [
    async () => Response.json({ error: 'Synchronisation en cours.' }, { status: 429 }),
    async () => { throw new DOMException('timeout', 'TimeoutError'); },
    async () => Response.json({ club: 'X', teams: 'nope' }),
  ]) {
    w.worker = worker;
    const res = await teams();
    assert.equal(res.status, 200);
    assert.deepEqual(await res.json(), { ok: true, teams: null });
  }
  assert.equal(w.cache.payload.teams_count, undefined, 'nothing cached');
  w.attempts = w.limit;
  assert.equal((await teams()).status, 429);
});

test('PR #277, M6: a busy worker (someone else’s optional teams read) makes the identity wait its turn; the teams read gives up at once', async () => {
  const { w, ask } = await setup();
  const ready = w.worker;
  let busy = 2;
  w.worker = async (init) => busy-- > 0 ? Response.json({ error: 'Synchronisation en cours.' }, { status: 429 }) : ready(init);
  const started = Date.now();
  const res = await ask({ url: URL_ROOT });
  assert.equal(res.status, 200, 'read once the worker is free');
  assert.ok(Date.now() - started >= 1_900 && Date.now() - started < 9_000);
  assert.equal(w.workerBodies.filter((b) => b.kind === 'club-identity').length, 3);
  assert.equal(w.attempts, 1, 'counted once toward the IP limit');
  const { lookup_token } = await res.json();
  w.worker = async () => Response.json({ error: 'x' }, { status: 429 });
  w.workerBodies.length = 0;
  assert.deepEqual(await (await ask({ teams: true, lookup_token })).json(), { ok: true, teams: null });
  assert.equal(w.workerBodies.length, 1, 'no retry for the optional read');
});
