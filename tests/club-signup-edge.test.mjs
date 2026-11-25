import test from 'node:test';
import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { mkdir, rm } from 'node:fs/promises';

// Bundle une Edge Function réelle ; les imports https (supabase-js, standardwebhooks) sont
// remplacés par des doubles pilotés depuis le test.
const dir = new URL('../node_modules/.tmp/club-signup-edge/', import.meta.url);
const realFetch = globalThis.fetch;
async function load(name) {
  await mkdir(dir, { recursive: true });
  const out = new URL(`${name}.mjs`, dir);
  await build({ entryPoints: [new URL(`../supabase/functions/${name}/index.ts`, import.meta.url).pathname], outfile: out.pathname,
    bundle: true, platform: 'node', format: 'esm', plugins: [{ name: 'mocks', setup(b) {
      b.onResolve({ filter: /^https:/ }, (args) => ({ path: args.path.includes('standardwebhooks') ? 'webhooks' : 'supabase', namespace: 'mock' }));
      b.onLoad({ filter: /^supabase$/, namespace: 'mock' }, () => ({ contents: 'export const createClient=(...args)=>globalThis.__client(...args);' }));
      b.onLoad({ filter: /^webhooks$/, namespace: 'mock' }, () => ({ contents: 'export class Webhook { verify(body){ return JSON.parse(body); } }' }));
    } }] });
  let handler;
  globalThis.Deno = { serve: (fn) => { handler = fn; }, env: { get: (key) => globalThis.__env[key] } };
  await import(`${out.href}?${Date.now()}`);
  return handler;
}
test.after(async () => { delete globalThis.Deno; globalThis.fetch = realFetch; await rm(dir, { recursive: true, force: true }); });

const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3]);
const JPEG = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0, 0x10]);

function world() {
  const w = {
    env: { SUPABASE_URL: 'https://project.supabase.co', SUPABASE_SERVICE_ROLE_KEY: 'service', SUPABASE_ANON_KEY: 'anon', TURNSTILE_SECRET_KEY: 'turnstile-secret' },
    turnstile: true, throttle: true, known: new Set(['deja@example.test']), createError: null,
    effects: [], accounts: [], deleted: [], uploads: [], removed: [], rpc: [], otp: [], copies: [], cache: {},
  };
  globalThis.__env = w.env;
  globalThis.fetch = async (url, init) => {
    assert.equal(url, 'https://challenges.cloudflare.com/turnstile/v0/siteverify');
    const body = new URLSearchParams(init.body);
    assert.equal(body.get('secret'), 'turnstile-secret');
    w.effects.push(`turnstile:${body.get('remoteip')}`);
    return Response.json({ success: w.turnstile && body.get('response') === 'ok' });
  };
  globalThis.__client = (_url, key) => ({
    rpc: async (name, args) => {
      w.rpc.push({ name, args }); w.effects.push(name);
      if (name === 'club_self_serve_throttle') {
        assert.match(args.p_ip, /^[0-9a-f]{64}$/); assert.match(args.p_email, /^[0-9a-f]{64}$/);
        return { data: w.throttle, error: null };
      }
      if (name === 'club_self_serve_create') return w.createError ? { data: null, error: w.createError } : { data: { club_id: args.p_club, created: true }, error: null };
      if (name === 'club_self_serve_change_email') return w.changeError ? { data: null, error: w.changeError } : { data: w.orphans ?? [], error: null };
      throw new Error(`unexpected rpc ${name}`);
    },
    auth: {
      admin: {
        createUser: async ({ email, email_confirm, app_metadata }) => {
          assert.equal(key, 'service'); assert.equal(email_confirm, true); assert.deepEqual(app_metadata, { created_via: 'club_signup' });
          w.effects.push('createUser');
          if (w.known.has(email)) return { data: { user: null }, error: { status: 422, code: 'email_exists', message: 'exists' } };
          w.known.add(email); w.accounts.push(email);
          return { data: { user: { id: `user-${email}` } }, error: null };
        },
        deleteUser: async (id) => { w.deleted.push(id); return { error: null }; },
      },
      signInWithOtp: async (params) => { assert.equal(key, 'anon'); w.otp.push(params); w.effects.push('otp'); return { error: w.otpError ?? null }; },
    },
    // Onboarding Ten'Up d'abord : cache des lectures `tenup-lookup` et copies `_lookup/` → `config/`.
    from: (table) => {
      assert.equal(table, 'tenup_lookup_cache'); assert.equal(key, 'service');
      const q = { select: () => q, eq: (k, v) => { q.id = v; return q; },
        maybeSingle: async () => ({ data: w.cache[q.id] ? { payload: w.cache[q.id] } : null, error: null }) };
      return q;
    },
    storage: { from: (bucket) => ({
      copy: async (from, to) => { w.copies.push([from, to]); return { error: w.copyError ?? (w.copyFails?.(from) ? { message: 'x' } : null) }; },
      upload: async (path, data, options) => { assert.equal(bucket, 'content-images'); w.uploads.push({ path, type: options.contentType, size: data.length }); return { error: null }; },
      remove: async (paths) => { w.removed.push(...paths); return { error: null }; },
      getPublicUrl: (path) => ({ data: { publicUrl: `https://project.supabase.co/storage/v1/object/public/${bucket}/${path}` } }),
    }) },
  });
  return w;
}

function form(overrides = {}) {
  const fields = { name: 'TC Nouveau', city: 'Moissac', sport: 'tennis', slug: 'tc-nouveau', color: '#1D4ED8',
    email: 'Nouveau@Example.test', turnstile_token: 'ok', logo: new Blob([PNG], { type: 'image/png' }),
    photo: new Blob([JPEG], { type: 'image/jpeg' }), ...overrides };
  const body = new FormData();
  for (const [key, value] of Object.entries(fields)) if (value !== undefined) body.set(key, value, ...(value instanceof Blob ? ['file.bin'] : []));
  return new Request('https://edge.example/functions/v1/club-signup', { method: 'POST', body,
    headers: { 'x-forwarded-for': '203.0.113.7, 10.0.0.1' } });
}

test('club-signup: Turnstile, throttle and file checks refuse before any account or upload', async () => {
  const handler = await load('club-signup');
  let w = world();
  delete w.env.TURNSTILE_SECRET_KEY;
  assert.equal((await handler(form())).status, 503);

  w = world(); w.turnstile = false;
  assert.equal((await handler(form())).status, 403);
  assert.equal((await handler(form({ turnstile_token: undefined }))).status, 403);
  assert.deepEqual(w.effects, ['turnstile:203.0.113.7'], 'nothing after a failed Turnstile');

  w = world(); w.throttle = false;
  const limited = await handler(form());
  assert.equal(limited.status, 429);
  assert.deepEqual(w.effects, ['turnstile:203.0.113.7', 'club_self_serve_throttle']);

  for (const [file, status] of [
    [new Blob(['<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>'], { type: 'image/png' }), 400],
    [new Blob([new Uint8Array([0x47, 0x49, 0x46, 0x38, 0x39, 0x61])], { type: 'image/gif' }), 400],
    [new Blob([PNG, new Uint8Array(5 * 1024 * 1024)], { type: 'image/png' }), 413],
  ]) {
    w = world();
    assert.equal((await handler(form({ logo: file }))).status, status);
    assert.equal(w.accounts.length + w.uploads.length + w.otp.length, 0);
    assert.equal(w.rpc.some(r => r.name === 'club_self_serve_create'), false);
  }
  w = world();
  assert.equal((await handler(form({ slug: 'app-tennis' }))).status, 400);
  assert.equal((await handler(form({ sport: 'padel' }))).status, 400);
  assert.equal((await handler(form({ color: 'red' }))).status, 400);
  assert.equal(w.accounts.length, 0);
});

test('club-signup: creates the account, uploads into the club config folder and sends the magic link', async () => {
  const handler = await load('club-signup');
  const w = world();
  const response = await handler(form());
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { ok: true });
  assert.deepEqual(w.accounts, ['nouveau@example.test']);
  const create = w.rpc.find(r => r.name === 'club_self_serve_create').args;
  assert.match(create.p_club, /^[0-9a-f-]{36}$/);
  assert.deepEqual(w.uploads.map(u => [u.path.replace(/\d{13}/, 'T'), u.type]), [
    [`${create.p_club}/config/T-logo.png`, 'image/png'], [`${create.p_club}/config/T-hero-image.jpg`, 'image/jpeg']]);
  assert.equal(create.p_logo, `https://project.supabase.co/storage/v1/object/public/content-images/${w.uploads[0].path}`);
  assert.equal(create.p_hero_image, `https://project.supabase.co/storage/v1/object/public/content-images/${w.uploads[1].path}`);
  assert.deepEqual({ ...create, p_club: undefined, p_logo: undefined, p_hero_image: undefined }, { p_club: undefined, p_email: 'nouveau@example.test',
    p_name: 'TC Nouveau', p_city: 'Moissac', p_sport: 'tennis', p_slug: 'tc-nouveau', p_color: '#1D4ED8', p_logo: undefined, p_hero_image: undefined });
  assert.deepEqual(w.otp, [{ email: 'nouveau@example.test', options: { shouldCreateUser: false, emailRedirectTo: 'https://admin.feelike.pro/?inscription=tc-nouveau' } }]);
  assert.deepEqual(w.effects.slice(-3), ['createUser', 'club_self_serve_create', 'otp']);

  // Sans fichiers : aucune image, aucun upload.
  const bare = world();
  assert.equal((await handler(form({ email: 'bare@example.test', logo: undefined, photo: undefined }))).status, 200);
  const args = bare.rpc.find(r => r.name === 'club_self_serve_create').args;
  assert.equal(args.p_logo, null); assert.equal(args.p_hero_image, null); assert.equal(bare.uploads.length, 0);
});

test('club-signup: a known email is attached without a new account, with the same response', async () => {
  const handler = await load('club-signup');
  const unknown = world();
  const first = await handler(form({ email: 'inconnu@example.test' }));
  const known = world();
  const second = await handler(form({ email: 'deja@example.test', slug: 'tc-autre' }));
  assert.equal(first.status, second.status);
  assert.deepEqual(await first.json(), await second.json());
  assert.deepEqual([...first.headers], [...second.headers]);
  assert.deepEqual(unknown.accounts, ['inconnu@example.test']);
  assert.deepEqual(known.accounts, [], 'no new account for a known email');
  assert.equal(known.rpc.find(r => r.name === 'club_self_serve_create').args.p_email, 'deja@example.test');
  assert.equal(known.otp.length, 1);
});

test('club-signup: a failed creation rolls back the new account and the uploaded files', async () => {
  const handler = await load('club-signup');
  let w = world(); w.createError = { code: 'PT409', message: 'SLUG_UNAVAILABLE' };
  const taken = await handler(form());
  assert.equal(taken.status, 409);
  assert.deepEqual(await taken.json(), { error: 'Cette adresse est déjà prise.', reason: 'taken' });
  assert.deepEqual(w.deleted, ['user-nouveau@example.test']);
  assert.deepEqual(w.removed, w.uploads.map(u => u.path));
  assert.equal(w.otp.length, 0);

  w = world(); w.createError = { code: 'PT409', message: 'SLUG_UNAVAILABLE' };
  assert.equal((await handler(form({ email: 'deja@example.test' }))).status, 409);
  assert.deepEqual(w.deleted, [], 'an existing account is never deleted');
  w = world(); w.createError = { code: 'XX000', message: 'secret detail' };
  const failed = await handler(form());
  assert.equal(failed.status, 500);
  assert.equal((await failed.text()).includes('secret detail'), false);
});

test('send-auth-email: « Gardez votre club » only for the admin of a pending club', async () => {
  const handler = await load('send-auth-email');
  globalThis.__env = { SEND_EMAIL_HOOK_SECRET: 'v1,whsec_x', BREVO_API_KEY: 'brevo', AUTH_FROM_EMAIL: 'no-reply@feelike.pro',
    SUPABASE_URL: 'https://project.supabase.co', SUPABASE_SERVICE_ROLE_KEY: 'service' };
  const clubs = [{ id: 'c1', slug: 'tc-nouveau', name: 'TC <Nouveau>', status: 'pending' }, { id: 'c2', slug: 'cac-tennis', name: 'CAC', status: 'active' }];
  const members = [{ club_id: 'c1', user_id: 'u1', role: 'admin' }, { club_id: 'c2', user_id: 'u2', role: 'admin' }];
  globalThis.__client = () => ({ from: (table) => {
    const filters = [];
    const q = { select: () => q, eq: (k, v) => { filters.push(r => r[k] === v); return q; },
      maybeSingle: async () => ({ data: (table === 'clubs' ? clubs : table === 'club_members' ? members : []).find(r => filters.every(f => f(r))) ?? null, error: null }) };
    return q;
  } });
  const sent = [];
  globalThis.fetch = async (_url, init) => { sent.push(JSON.parse(init.body)); return new Response('{}'); };
  const send = (user, slug) => handler(new Request('https://edge.example', { method: 'POST', body: JSON.stringify({
    user: { id: user, email: 'x@example.test' },
    email_data: { email_action_type: 'magiclink', token_hash: 'h', redirect_to: `https://admin.feelike.pro/?inscription=${slug}` } }) }));
  assert.equal((await send('u1', 'tc-nouveau')).status, 200);
  assert.equal(sent.at(-1).subject, 'Feelike — Gardez votre club');
  assert.match(sent.at(-1).textContent, /TC <Nouveau>.*tc-nouveau\.feelike\.pro/s);
  assert.doesNotMatch(sent.at(-1).htmlContent, /<Nouveau>/, 'club name is escaped');
  for (const [user, slug] of [['u2', 'tc-nouveau'], ['u2', 'cac-tennis'], ['u1', 'inconnu']]) {
    assert.equal((await send(user, slug)).status, 200);
    assert.equal(sent.at(-1).subject, 'Feelike — Connectez-vous à votre espace', `${user} ${slug}`);
  }
});

test('club-signup-purge: secret required, files removed before the club, only returned accounts deleted', async () => {
  const handler = await load('club-signup-purge');
  const secret = 's'.repeat(32);
  globalThis.__env = { CLUB_SIGNUP_PURGE_SECRET: secret, SUPABASE_URL: 'https://project.supabase.co', SUPABASE_SERVICE_ROLE_KEY: 'service' };
  const effects = [];
  // Cache Ten'Up (onboarding Ten'Up d'abord) : une lecture de plus de 48 h, avec une image ancienne
  // et une image d'une relecture récente (gardée).
  const old = Date.now() - 3 * 24 * 3600 * 1000, recent = Date.now();
  globalThis.__client = () => ({
    from: (table) => {
      assert.equal(table, 'tenup_lookup_cache');
      const q = { filters: [], op: 'select',
        select() { return q; }, delete() { q.op = 'delete'; return q; },
        eq(k, v) { q.filters.push(`${k}=${v}`); return q; },
        lt(k, v) { assert.equal(k, 'read_at'); assert.ok(Date.parse(v) < Date.now() - 47 * 3600 * 1000); q.filters.push(`${k}<cutoff`); return q; },
        limit: async () => ({ data: [{ tenup_club_id: '60820110' }], error: null }),
        then(done) { effects.push(`cache:${q.op}:${q.filters.join('&')}`); done({ error: null }); } };
      return q;
    },
    rpc: async (name, args) => {
      effects.push(`${name}${args.p_club ? `:${args.p_club}` : ''}`);
      if (name === 'club_self_serve_purge_begin') return { data: ['c1', 'c2'], error: null };
      return { data: args.p_club === 'c1' ? ['u1'] : [], error: null };
    },
    storage: { from: () => ({
      list: async (folder) => ({ data: folder === 'c1/config' ? [{ name: 'a-logo.png' }, { name: 'b-hero-image.jpg' }]
        : folder === '_lookup/60820110' ? [{ name: `${old}-logo.webp` }, { name: `${recent}-logo.webp` }] : [], error: null }),
      remove: async (paths) => { effects.push(`remove:${paths.join(',')}`); return { error: null }; },
    }) },
    auth: { admin: { deleteUser: async (id) => { effects.push(`deleteUser:${id}`); return { error: null }; } } },
  });
  const call = (header) => handler(new Request('https://edge.example', { method: 'POST', headers: header ? { 'x-club-signup-purge-secret': header } : {} }));
  assert.equal((await call()).status, 401);
  assert.equal((await call('wrong')).status, 401);
  assert.deepEqual(effects, []);
  const response = await call(secret);
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { purged: 2, accounts: 1, lookups: 1, failed: 0 });
  assert.deepEqual(effects, ['club_self_serve_purge_begin', 'remove:c1/config/a-logo.png,c1/config/b-hero-image.jpg',
    'club_self_serve_purge:c1', 'deleteUser:u1', 'club_self_serve_purge:c2',
    `remove:_lookup/60820110/${old}-logo.webp`, 'cache:delete:tenup_club_id=60820110&read_at<cutoff']);
  globalThis.__env.CLUB_SIGNUP_PURGE_SECRET = 'short';
  assert.equal((await call('short')).status, 503);
});

// ── Onboarding Ten'Up d'abord (P1-back) ─────────────────────────────────────────────────────────
const LOOKUP_SECRET = 'l'.repeat(40);
async function lookupTokens() {
  const out = new URL('lookup-token.mjs', dir);
  await mkdir(dir, { recursive: true });
  await build({ entryPoints: [new URL('../supabase/functions/_shared/lookup-token.ts', import.meta.url).pathname], outfile: out.pathname, bundle: true, platform: 'node', format: 'esm' });
  return import(`${out.href}?${Date.now()}`);
}

test('lookup token: HMAC signed, 2 hours, any change refused', async () => {
  const { signLookupToken, verifyLookupToken } = await lookupTokens();
  const now = Date.now();
  const token = await signLookupToken(LOOKUP_SECRET, '60820110', '2026-11-15T10:00:00.000Z', now);
  assert.deepEqual(await verifyLookupToken(LOOKUP_SECRET, token, now), { tenup_club_id: '60820110', read_at: '2026-11-15T10:00:00.000Z' });
  assert.equal(await verifyLookupToken(LOOKUP_SECRET, token, now + 2 * 3600 * 1000 + 1), null, 'expired');
  assert.equal(await verifyLookupToken('x'.repeat(40), token, now), null, 'other secret');
  const [body, sig] = token.split('.');
  const forged = Buffer.from(JSON.stringify({ id: '57950125', read_at: 'x', exp: now + 3600_000 })).toString('base64url');
  assert.equal(await verifyLookupToken(LOOKUP_SECRET, `${forged}.${sig}`, now), null, 'other club id');
  for (const bad of [`${body}.`, body, `${body}.${sig}.x`, '', 42, null]) assert.equal(await verifyLookupToken(LOOKUP_SECRET, bad, now), null);
});

test('club-signup: lookup token → Ten\'Up id, short name, images copied from the cache', async () => {
  const handler = await load('club-signup');
  const { signLookupToken } = await lookupTokens();
  const token = await signLookupToken(LOOKUP_SECRET, '60820110', new Date().toISOString());
  let w = world(); w.env.LOOKUP_HMAC_SECRET = LOOKUP_SECRET;
  w.cache['60820110'] = { name: 'MOISSAC TENNIS CLUB', logo_path: '_lookup/60820110/1-logo.webp', banner_path: '_lookup/60820110/1-banner.jpg' };
  const response = await handler(form({ lookup_token: token, short_name: 'Moissac TC', logo: undefined, photo: undefined, name: 'Moissac Tennis Club', slug: 'moissac-tc' }));
  assert.equal(response.status, 200);
  const create = w.rpc.find(r => r.name === 'club_self_serve_create').args;
  assert.equal(create.p_tenup_club_id, '60820110');
  assert.equal(create.p_short_name, 'Moissac TC');
  assert.equal(create.p_name, 'Moissac Tennis Club', 'the form values stay');
  assert.deepEqual(w.copies.map(([from, to]) => [from, to.replace(/\d{13}/, 'T')]), [
    ['_lookup/60820110/1-logo.webp', `${create.p_club}/config/T-logo.webp`],
    ['_lookup/60820110/1-banner.jpg', `${create.p_club}/config/T-hero-image.jpg`]]);
  assert.match(create.p_logo, new RegExp(`/content-images/${create.p_club}/config/\\d+-logo\\.webp$`));
  assert.match(create.p_hero_image, /-hero-image\.jpg$/);
  assert.equal(w.uploads.length, 0, 'no upload from the browser');

  // Un fichier envoyé l'emporte ; un chemin hors `_lookup/<id>/` n'est jamais copié.
  w = world(); w.env.LOOKUP_HMAC_SECRET = LOOKUP_SECRET;
  w.cache['60820110'] = { logo_path: '_lookup/60820110/1-logo.webp', banner_path: '57950125/config/x.jpg' };
  assert.equal((await handler(form({ lookup_token: token, photo: undefined }))).status, 200);
  assert.deepEqual(w.copies, []);
  assert.equal(w.uploads.length, 1);

  // Sans cache (purgé) ou copie impossible : inscription sans image, identifiant gardé.
  w = world(); w.env.LOOKUP_HMAC_SECRET = LOOKUP_SECRET; w.copyError = { message: 'x' };
  w.cache['60820110'] = { logo_path: '_lookup/60820110/1-logo.webp', banner_path: null };
  assert.equal((await handler(form({ lookup_token: token, logo: undefined, photo: undefined }))).status, 200);
  const bare = w.rpc.find(r => r.name === 'club_self_serve_create').args;
  assert.equal(bare.p_logo, null); assert.equal(bare.p_tenup_club_id, '60820110');
  assert.equal('p_short_name' in bare, false, 'absent fields are not sent');

  // Parcours manuel : appel S2 inchangé, nom court accepté seul.
  w = world();
  assert.equal((await handler(form({ short_name: 'TC Nouveau' }))).status, 200);
  const manual = w.rpc.find(r => r.name === 'club_self_serve_create').args;
  assert.equal(manual.p_short_name, 'TC Nouveau');
  assert.equal('p_tenup_club_id' in manual, false);
});

test('club-signup: bad or expired token and long short name refused before any account', async () => {
  const handler = await load('club-signup');
  const { signLookupToken } = await lookupTokens();
  const expired = await signLookupToken(LOOKUP_SECRET, '60820110', 'x', Date.now() - 3 * 3600 * 1000);
  for (const [fields, env] of [[{ lookup_token: expired }, true], [{ lookup_token: 'forged.token' }, true],
    [{ lookup_token: await signLookupToken(LOOKUP_SECRET, '60820110', 'x') }, false]]) {
    const w = world(); if (env) w.env.LOOKUP_HMAC_SECRET = LOOKUP_SECRET;
    const response = await handler(form(fields));
    assert.equal(response.status, 400);
    assert.equal((await response.json()).reason, 'lookup_expired');
    assert.equal(w.accounts.length + w.uploads.length + w.copies.length, 0);
  }
  const w = world();
  assert.equal((await handler(form({ short_name: 'Castelsarrasin' }))).status, 400);
  assert.equal(w.accounts.length, 0);
});

test('club-signup: a club already on feelike (PT410) → 409 already_on_feelike, rolled back', async () => {
  const handler = await load('club-signup');
  const { signLookupToken } = await lookupTokens();
  const w = world(); w.env.LOOKUP_HMAC_SECRET = LOOKUP_SECRET;
  w.cache['60820110'] = { logo_path: '_lookup/60820110/1-logo.webp' };
  w.createError = { code: 'PT410', message: 'ALREADY_ON_FEELIKE' };
  const response = await handler(form({ lookup_token: await signLookupToken(LOOKUP_SECRET, '60820110', 'x'), logo: undefined, photo: undefined }));
  assert.equal(response.status, 409);
  assert.deepEqual(await response.json(), { error: 'Ce club a déjà son espace feelike.', reason: 'already_on_feelike' });
  assert.deepEqual(w.deleted, ['user-nouveau@example.test']);
  assert.deepEqual(w.removed, w.copies.map(([, to]) => to), 'copied files removed');
  assert.equal(w.otp.length, 0);
});

test('club-signup: Turnstile and the limit use cf-connecting-ip over a forged x-forwarded-for', async () => {
  const handler = await load('club-signup');
  const { createHash } = await import('node:crypto');
  const w = world();
  const request = form();
  const forged = new Request(request.url, { method: 'POST', body: await request.formData(),
    headers: { 'x-forwarded-for': '1.1.1.1, 198.51.100.9', 'cf-connecting-ip': '198.51.100.9' } });
  assert.equal((await handler(forged)).status, 200);
  assert.equal(w.effects[0], 'turnstile:198.51.100.9');
  assert.equal(w.rpc.find(r => r.name === 'club_self_serve_throttle').args.p_ip, createHash('sha256').update('198.51.100.9').digest('hex'));
});

// ── W3 : logo retouché (brief SAAS_11 §13.4) ─────────────────────────────────
const W3_VARIANTS = ['clean-1024', 'avatar-256', 'maskable-512', 'maskable-192', 'any-512', 'apple-180', 'email-128'];
const cleanedCache = () => ({ name: 'MOISSAC TENNIS CLUB', logo_path: '_lookup/60820110/1-logo.jpg', banner_path: null, logo_verdict: 'cleaned',
  logo_variants: Object.fromEntries(W3_VARIANTS.map((n) => [n, `_lookup/60820110/1-logo-${n}.png`])) });

test('club-signup W3: retouched logo by default, original kept, variants copied to config/logo/, logo_choice', async () => {
  const handler = await load('club-signup');
  const { signLookupToken } = await lookupTokens();
  const token = await signLookupToken(LOOKUP_SECRET, '60820110', new Date().toISOString());
  const signup = async (fields = {}, cache = cleanedCache(), setup = () => {}) => {
    const w = world(); w.env.LOOKUP_HMAC_SECRET = LOOKUP_SECRET; w.cache['60820110'] = cache; setup(w);
    const response = await handler(form({ lookup_token: token, logo: undefined, photo: undefined, ...fields }));
    return { w, status: response.status, create: w.rpc.find(r => r.name === 'club_self_serve_create')?.args };
  };

  let { w, status, create } = await signup();
  assert.equal(status, 200);
  const club = create.p_club;
  assert.deepEqual(w.copies.map(([from, to]) => [from, to.replace(/\d{13}/, 'T')]), [
    ['_lookup/60820110/1-logo.jpg', `${club}/config/T-logo.jpg`],
    ...W3_VARIANTS.map((n) => [`_lookup/60820110/1-logo-${n}.png`, `${club}/config/logo/T-${n}.png`])]);
  assert.match(create.p_logo, new RegExp(`/${club}/config/logo/\\d+-clean-1024\\.png$`), 'retouched by default');
  assert.match(create.p_logo_original, new RegExp(`/${club}/config/\\d+-logo\\.jpg$`));
  assert.deepEqual(Object.keys(create.p_logo_variants), W3_VARIANTS);
  assert.deepEqual(create.p_logo_choice, { verdict: 'cleaned', choice: 'clean' });

  ({ create } = await signup({ logo_variant: 'original' }));
  assert.equal(create.p_logo, create.p_logo_original, 'original chosen');
  assert.deepEqual(create.p_logo_choice, { verdict: 'cleaned', choice: 'original' });
  assert.ok(create.p_logo_variants, 'variants kept to switch back later');

  // Une variante non copiée : les autres retirées, l'original comme avant, sans événement.
  ({ w, create } = await signup({}, cleanedCache(), (w) => { w.copyFails = (from) => from.endsWith('-apple-180.png'); }));
  assert.match(create.p_logo, /\d+-logo\.jpg$/);
  for (const key of ['p_logo_original', 'p_logo_variants', 'p_logo_choice']) assert.equal(key in create, false, key);
  assert.equal(w.removed.filter((p) => p.includes('/config/logo/')).length, 5);

  // Monogramme : pas de logo posé, l'original reste restaurable.
  ({ create } = await signup({}, { ...cleanedCache(), logo_verdict: 'monogram', logo_variants: undefined }));
  assert.equal(create.p_logo, null);
  assert.match(create.p_logo_original, /\d+-logo\.jpg$/);
  assert.deepEqual(create.p_logo_choice, { verdict: 'monogram', choice: 'monogram' });
  // Logo déjà propre : comme avant, avec l'événement.
  ({ create } = await signup({}, { ...cleanedCache(), logo_verdict: 'unchanged', logo_variants: undefined }));
  assert.match(create.p_logo, /\d+-logo\.jpg$/);
  assert.deepEqual(create.p_logo_choice, { verdict: 'unchanged', choice: 'original' });
  // Lecture d'avant W3 (pas de verdict) : appel de P1 inchangé.
  ({ create } = await signup({}, { logo_path: '_lookup/60820110/1-logo.jpg' }));
  for (const key of ['p_logo_original', 'p_logo_variants', 'p_logo_choice']) assert.equal(key in create, false, key);
  // Variantes hors du dossier de la lecture : jamais copiées.
  ({ w, create } = await signup({}, { ...cleanedCache(), logo_variants: { ...cleanedCache().logo_variants, 'email-128': '57950125/config/x.png' } }));
  assert.equal(w.copies.length, 1);
  assert.equal('p_logo_variants' in create, false);
  // Logo envoyé par le formulaire : il l'emporte, rien de W3.
  ({ w, create } = await signup({ logo: new Blob([PNG], { type: 'image/png' }) }));
  assert.equal(w.copies.length, 0);
  assert.equal('p_logo_choice' in create, false);
  // Valeur inconnue : refusée avant tout compte.
  ({ w, status } = await signup({ logo_variant: 'ia' }));
  assert.equal(status, 400);
  assert.equal(w.accounts.length, 0);
});

// Retours PR #277, B1 — corriger son e-mail : jeton signé remis à la création seulement.
const RESUME_SECRET = 'r'.repeat(40);
const resumeForm = (fields) => {
  const body = new FormData();
  for (const [key, value] of Object.entries({ turnstile_token: 'ok', ...fields })) if (value !== undefined) body.set(key, value);
  return new Request('https://edge.example/functions/v1/club-signup', { method: 'POST', body, headers: { 'x-forwarded-for': '203.0.113.7' } });
};
async function resumeLib() {
  const out = new URL('resume-token.mjs', dir);
  await build({ entryPoints: [new URL('../supabase/functions/_shared/resume-token.ts', import.meta.url).pathname], outfile: out.pathname, bundle: true, platform: 'node', format: 'esm' });
  return import(`${out.href}?${Date.now()}`);
}

test('resume token: signed, 2 hours, never interchangeable with a lookup token', async () => {
  await load('club-signup');
  const { signResumeToken, verifyResumeToken, RESUME_TOKEN_TTL_MS } = await resumeLib();
  const club = '11111111-1111-4111-8111-111111111111';
  const token = await signResumeToken(RESUME_SECRET, club, 'tc-nouveau', 1000);
  assert.deepEqual(await verifyResumeToken(RESUME_SECRET, token, 2000), { club, slug: 'tc-nouveau' });
  assert.equal(await verifyResumeToken(RESUME_SECRET, token, 1000 + RESUME_TOKEN_TTL_MS), null, 'expired');
  assert.equal(await verifyResumeToken('x'.repeat(40), token, 2000), null);
  const forged = btoa(JSON.stringify({ club, slug: 'autre', exp: 9e15 })).replace(/=+$/, '') + '.' + token.split('.')[1];
  for (const bad of [forged, `${token}x`, 'a.b', '', null]) assert.equal(await verifyResumeToken(RESUME_SECRET, bad, 2000), null);
});

test('club-signup (B1): the resume token is given at creation only, never on a replay', async () => {
  const handler = await load('club-signup');
  const { verifyResumeToken } = await resumeLib();
  let w = world(); w.env.LOOKUP_HMAC_SECRET = RESUME_SECRET;
  const created = await (await handler(form())).json();
  const club = w.rpc.find(r => r.name === 'club_self_serve_create').args.p_club;
  assert.deepEqual(await verifyResumeToken(RESUME_SECRET, created.resume_token), { club, slug: 'tc-nouveau' });
  // E-mail non parti : le club existe, le jeton est quand même remis (adresse peut-être fausse).
  w = world(); w.env.LOOKUP_HMAC_SECRET = RESUME_SECRET; w.otpError = { status: 500 };
  const unsent = await handler(form());
  assert.equal(unsent.status, 502);
  assert.ok((await unsent.json()).resume_token);
  // Rejeu (même adresse, même slug — connus d'un tiers) : pas de jeton.
  w = world(); w.env.LOOKUP_HMAC_SECRET = RESUME_SECRET;
  const client = globalThis.__client;
  globalThis.__client = (...args) => { const c = client(...args); const rpc = c.rpc; c.rpc = async (name, a) => name === 'club_self_serve_create' ? { data: { club_id: a.p_club, created: false }, error: null } : rpc(name, a); return c; };
  assert.deepEqual(await (await handler(form())).json(), { ok: true });
});

test('club-signup (B1): with the token, a corrected address replaces the admin, deletes the orphan account and gets the code', async () => {
  const handler = await load('club-signup');
  const { signResumeToken } = await resumeLib();
  const club = '11111111-1111-4111-8111-111111111111';
  const w = world(); w.env.LOOKUP_HMAC_SECRET = RESUME_SECRET; w.orphans = ['user-faute'];
  const token = await signResumeToken(RESUME_SECRET, club, 'tc-nouveau');
  const response = await handler(resumeForm({ resume_token: token, email: 'Juste@Example.test' }));
  assert.equal(response.status, 200);
  assert.ok((await response.json()).resume_token, 'a fresh token, for another correction');
  assert.deepEqual(w.effects, ['turnstile:203.0.113.7', 'club_self_serve_throttle', 'createUser', 'club_self_serve_change_email', 'otp'], 'Turnstile and throttle first, no second club');
  assert.deepEqual(w.rpc.at(-1).args, { p_club: club, p_slug: 'tc-nouveau', p_email: 'juste@example.test' });
  assert.deepEqual(w.deleted, ['user-faute']);
  assert.deepEqual(w.otp, [{ email: 'juste@example.test', options: { shouldCreateUser: false, emailRedirectTo: 'https://admin.feelike.pro/?inscription=tc-nouveau' } }]);
});

test('club-signup (B1): forged or expired token, or club already activated → refused, nothing left behind', async () => {
  const handler = await load('club-signup');
  const { signResumeToken, RESUME_TOKEN_TTL_MS } = await resumeLib();
  const club = '11111111-1111-4111-8111-111111111111';
  for (const token of ['faux.jeton', await signResumeToken('x'.repeat(40), club, 'tc-nouveau'), await signResumeToken(RESUME_SECRET, club, 'tc-nouveau', Date.now() - RESUME_TOKEN_TTL_MS)]) {
    const w = world(); w.env.LOOKUP_HMAC_SECRET = RESUME_SECRET;
    const response = await handler(resumeForm({ resume_token: token, email: 'voleur@example.test' }));
    assert.equal(response.status, 400);
    assert.equal((await response.json()).reason, 'resume_expired');
    assert.equal(w.accounts.length + w.otp.length, 0);
  }
  const w = world(); w.env.LOOKUP_HMAC_SECRET = RESUME_SECRET; w.changeError = { code: 'PT409' };
  const late = await handler(resumeForm({ resume_token: await signResumeToken(RESUME_SECRET, club, 'tc-nouveau'), email: 'juste@example.test' }));
  assert.equal(late.status, 409);
  assert.equal((await late.json()).reason, 'not_pending');
  assert.deepEqual(w.deleted, ['user-juste@example.test'], 'the account just created is rolled back');
  assert.equal(w.otp.length, 0);
});
