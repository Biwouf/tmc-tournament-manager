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
    effects: [], accounts: [], deleted: [], uploads: [], removed: [], rpc: [], otp: [],
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
      signInWithOtp: async (params) => { assert.equal(key, 'anon'); w.otp.push(params); w.effects.push('otp'); return { error: null }; },
    },
    storage: { from: (bucket) => ({
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
  globalThis.__client = () => ({
    rpc: async (name, args) => {
      effects.push(`${name}${args.p_club ? `:${args.p_club}` : ''}`);
      if (name === 'club_self_serve_purge_begin') return { data: ['c1', 'c2'], error: null };
      return { data: args.p_club === 'c1' ? ['u1'] : [], error: null };
    },
    storage: { from: () => ({
      list: async (folder) => ({ data: folder === 'c1/config' ? [{ name: 'a-logo.png' }, { name: 'b-hero-image.jpg' }] : [], error: null }),
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
  assert.deepEqual(await response.json(), { purged: 2, accounts: 1, failed: 0 });
  assert.deepEqual(effects, ['club_self_serve_purge_begin', 'remove:c1/config/a-logo.png,c1/config/b-hero-image.jpg',
    'club_self_serve_purge:c1', 'deleteUser:u1', 'club_self_serve_purge:c2']);
  globalThis.__env.CLUB_SIGNUP_PURGE_SECRET = 'short';
  assert.equal((await call('short')).status, 503);
});
