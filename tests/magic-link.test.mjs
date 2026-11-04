// SaaS S4 — connexion par lien magique, lien expiré, choix du club à l'arrivée.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, statSync, existsSync } from 'node:fs';
import { dirname, resolve, join } from 'node:path';
import { createRequire } from 'node:module';
import vm from 'node:vm';
import ts from 'typescript';
import { JSDOM } from 'jsdom';
const dom = new JSDOM('<div id="root"></div>', { url: 'https://admin.feelike.pro/' });
globalThis.window = dom.window; globalThis.document = dom.window.document;
globalThis.IS_REACT_ACT_ENVIRONMENT = true;
const base = resolve(new URL('..', import.meta.url).pathname);
const req = createRequire(resolve(base, 'package.json'));
const { act, createElement: h } = req('react');
const { createRoot } = req('react-dom/client');
const { MemoryRouter } = req('react-router-dom');

let calls = [], reply = { error: null };
const supabase = { auth: {
  async signInWithOtp(args) { calls.push(['otp', args]); if (reply instanceof Error) throw reply; return reply; },
  async signInWithPassword(args) { calls.push(['password', args]); return { error: null }; },
} };
// Chaque chargement réévalue les modules : `initialLinkError` relit l'URL courante.
function load(relative) {
  const cache = new Map();
  function read(file) {
    if (file.endsWith('/lib/supabase.ts')) return { supabase };
    if (cache.has(file)) return cache.get(file).exports;
    const mod = { exports: {} }; cache.set(file, mod);
    const code = ts.transpileModule(readFileSync(file, 'utf8'), { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX, esModuleInterop: true } }).outputText;
    const require = (name) => {
      if (!name.startsWith('.')) return req(name);
      const p = resolve(dirname(file), name);
      return read([p, `${p}.ts`, `${p}.tsx`].find(existsSync));
    };
    vm.runInThisContext(`(function(require,module,exports){${code}\n})`, { filename: file })(require, mod, mod.exports);
    return mod.exports;
  }
  return read(resolve(base, relative));
}
const at = (url) => { dom.reconfigure({ url }); calls = []; reply = { error: null }; };

test('link helpers: error_code, inscription slug, redirect', () => {
  const { authLinkError, inscriptionSlug, magicLinkRedirect } = load('src/lib/magicLink.ts');
  assert.equal(authLinkError('https://admin.feelike.pro/?inscription=gamma#error=access_denied&error_code=otp_expired&error_description=Email+link+is+invalid'), 'otp_expired');
  assert.equal(authLinkError('https://admin.feelike.pro/?error=access_denied&error_code=flow_state_expired'), 'flow_state_expired');
  assert.equal(authLinkError('https://admin.feelike.pro/#error=server_error'), 'unspecified_code');
  assert.equal(authLinkError('https://admin.feelike.pro/#access_token=x&type=magiclink'), null);
  assert.equal(inscriptionSlug('https://admin.feelike.pro/?inscription=gamma-ville'), 'gamma-ville');
  for (const url of ['https://admin.feelike.pro/', 'https://admin.feelike.pro/?inscription=Gamma', 'https://admin.feelike.pro/?inscription=a&inscription=b', 'https://admin.feelike.pro/?inscription=x%2F..']) {
    assert.equal(inscriptionSlug(url), null, url);
  }
  assert.equal(magicLinkRedirect('https://admin.feelike.pro', 'gamma'), 'https://admin.feelike.pro/?inscription=gamma');
  assert.equal(magicLinkRedirect('https://admin.feelike.pro', null), 'https://admin.feelike.pro/');
});

test('club picked on arrival: inscription first, then saved choice, then the only active club', () => {
  const { pickAdminClub } = load('src/lib/magicLink.ts');
  const a = { id: 'a', slug: 'alpha' }, b = { id: 'b', slug: 'beta' };
  assert.deepEqual(pickAdminClub([a, b], 'a', 'beta'), { club: b, firstSteps: true });
  assert.deepEqual(pickAdminClub([a, b], 'b', null), { club: b, firstSteps: false });
  assert.deepEqual(pickAdminClub([a, b], 'forged', null), { club: undefined, firstSteps: false });
  assert.deepEqual(pickAdminClub([a], null, null), { club: a, firstSteps: false });
  assert.deepEqual(pickAdminClub([a], null, 'unknown'), { club: a, firstSteps: false });
  assert.deepEqual(pickAdminClub([], null, 'alpha'), { club: undefined, firstSteps: false });
});

test('requestMagicLink never creates an account and answers the same for unknown addresses', async () => {
  at('https://admin.feelike.pro/');
  const { requestMagicLink } = load('src/lib/magicLink.ts');
  const warn = console.warn; console.warn = () => {};
  try {
    assert.equal(await requestMagicLink(supabase, ' fondateur@example.com ', 'https://admin.feelike.pro/'), 'sent');
    assert.deepEqual(calls[0][1], { email: 'fondateur@example.com', options: { shouldCreateUser: false, emailRedirectTo: 'https://admin.feelike.pro/' } });
    reply = { error: { status: 422, code: 'otp_disabled' } };
    assert.equal(await requestMagicLink(supabase, 'inconnu@example.com', 'https://admin.feelike.pro/'), 'sent');
    reply = { error: { status: 429, code: 'over_email_send_rate_limit' } };
    assert.equal(await requestMagicLink(supabase, 'a@example.com', 'https://admin.feelike.pro/'), 'rate_limited');
    reply = { error: { status: 500, code: 'unexpected_failure' } };
    assert.equal(await requestMagicLink(supabase, 'a@example.com', 'https://admin.feelike.pro/'), 'failed');
    reply = new Error('offline');
    assert.equal(await requestMagicLink(supabase, 'a@example.com', 'https://admin.feelike.pro/'), 'failed');
  } finally { console.warn = warn; }
});

async function mountLogin() {
  const Page = load('src/pages/LoginPage.tsx').default;
  const root = createRoot(document.getElementById('root'));
  await act(async () => root.render(h(MemoryRouter, null, h(Page))));
  return {
    async change(id, value) { const el = document.getElementById(id); assert.ok(el, id); await act(async () => el[Object.keys(el).find(k => k.startsWith('__reactProps'))].onChange({ target: { value } })); },
    async submit() { await act(async () => document.querySelector('form').dispatchEvent(new window.Event('submit', { bubbles: true, cancelable: true }))); },
    async click(text) { const b = [...document.querySelectorAll('button')].find(x => x.textContent === text); assert.ok(b, text); await act(async () => b.click()); },
    close: () => act(async () => root.unmount()),
  };
}

test('LoginPage: password unchanged, magic link offered to every account', async () => {
  at('https://admin.feelike.pro/');
  const page = await mountLogin();
  assert.match(document.body.textContent, /Administration club/);
  await page.change('login-email', 'membre@example.com'); await page.change('login-password', 'secret');
  await page.submit();
  assert.deepEqual(calls, [['password', { email: 'membre@example.com', password: 'secret' }]]);
  assert.match(document.body.textContent, /Mot de passe oublié/);
  calls = [];
  await page.click('Recevoir un lien de connexion');
  assert.equal(document.getElementById('login-password'), null);
  await page.submit();
  assert.deepEqual(calls, [['otp', { email: 'membre@example.com', options: { shouldCreateUser: false, emailRedirectTo: 'https://admin.feelike.pro/' } }]]);
  assert.match(document.body.textContent, /Si un compte correspond à cette adresse/);
  await page.close();
});

test('LoginPage: expired link explained, new link keeps the signup club, no account disclosure', async () => {
  for (const known of [true, false]) {
    at('https://admin.feelike.pro/?inscription=gamma#error=access_denied&error_code=otp_expired&error_description=Email+link+is+invalid+or+has+expired');
    if (!known) reply = { error: { status: 422, code: 'otp_disabled' } };
    const warn = console.warn; console.warn = () => {};
    const page = await mountLogin();
    try {
      assert.match(document.body.textContent, /Ce lien a expiré/);
      assert.equal(window.location.hash, '', 'erreur retirée de l’URL');
      assert.equal(window.location.search, '?inscription=gamma');
      assert.equal(document.getElementById('login-password'), null);
      await page.change('login-email', 'fondateur@example.com'); await page.click('Recevoir un nouveau lien');
      assert.deepEqual(calls[0][1].options, { shouldCreateUser: false, emailRedirectTo: 'https://admin.feelike.pro/?inscription=gamma' });
      assert.match(document.body.textContent, /Si un compte correspond à cette adresse/, known ? 'connu' : 'inconnu');
    } finally { console.warn = warn; await page.close(); }
  }
});

test('every signInWithOtp call sets shouldCreateUser: false', () => {
  const files = [];
  const walk = (dir) => { for (const name of readdirSync(dir)) { const p = join(dir, name); if (statSync(p).isDirectory()) walk(p); else if (/\.(ts|tsx|mjs|js)$/.test(name)) files.push(p); } };
  for (const dir of ['src', 'pwa/src', 'web/src', 'supabase/functions', 'shared']) if (existsSync(resolve(base, dir))) walk(resolve(base, dir));
  let found = 0;
  for (const file of files) {
    const source = readFileSync(file, 'utf8');
    for (const match of source.matchAll(/signInWithOtp\(/g)) {
      found++;
      const call = source.slice(match.index, source.indexOf(')', source.indexOf('}', match.index)) + 1);
      assert.match(call, /shouldCreateUser:\s*false/, file);
    }
  }
  assert.ok(found >= 2, 'club-signup et magicLink');
});
