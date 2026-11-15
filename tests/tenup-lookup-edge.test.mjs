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
    calls: [], uploads: [], removed: [], workerBodies: [],
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
        w.calls.push('throttle');
        if (w.attempts >= w.limit) return { data: false, error: null };
        w.attempts++; return { data: true, error: null };
      },
      storage: { from: (bucket) => ({
        upload: async (path, bytes, options) => { assert.equal(bucket, 'content-images'); w.uploads.push([path, options.contentType, bytes.length]); return { error: null }; },
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
      w.workerBodies.push(JSON.parse(init.body));
      return w.worker(init);
    }
    if (href.startsWith('https://cmsclub.fft.fr/')) { w.calls.push('image'); return w.image(href); }
    throw new Error(`unexpected fetch ${href}`);
  };
  await import(`${out.href}?${Date.now()}`);
  const ask = (body, ip = '203.0.113.7') => handler(new Request('https://edge.example/functions/v1/tenup-lookup', {
    method: 'POST', headers: { 'x-forwarded-for': ip }, body: JSON.stringify({ turnstile_token: 'ok', ...body }) }));
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
  assert.deepEqual(w.workerBodies, [{ kind: 'club-identity', url: URL_ROOT }], 'any tab is read at the club root');
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

test('tenup-lookup: 20 reads per hour per IP, then 429; not found 404; worker down 504', async () => {
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
