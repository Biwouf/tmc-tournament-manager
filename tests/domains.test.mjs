import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import { createRequire } from 'node:module';
import { resolve, dirname } from 'node:path';
import test from 'node:test';
import vm from 'node:vm';
import ts from 'typescript';
import { JSDOM } from 'jsdom';
import { domainRoutes } from '../web/scripts/domain-routes.mjs';
const require = createRequire(import.meta.url);
const React = require('react');
const { act, createElement: h } = React;
const { createRoot } = require('react-dom/client');
const dom = new JSDOM('<div id="root"></div>', { url: 'https://admin.feelike.pro/' });
globalThis.window = dom.window; globalThis.document = dom.window.document;
globalThis.localStorage = dom.window.localStorage; globalThis.sessionStorage = dom.window.sessionStorage;
globalThis.IS_REACT_ACT_ENVIRONMENT = true;
let user = { id: 'u1' }, pathname = '/', listeners = new Set(), fail = false;
const alpha = { id: 'a', slug: 'alpha', name: 'Alpha Tennis', sport: 'tennis', status: 'active' };
const beta = { ...alpha, id: 'b', slug: 'beta', name: 'Beta Tennis' };
let rows = {}, calls = [];
const supabase = {
  auth: {
    getSession: async () => ({ data: { session: user ? { user } : null } }),
    onAuthStateChange: cb => { listeners.add(cb); return { data: { subscription: { unsubscribe: () => listeners.delete(cb) } } }; },
    signOut: async () => { user = null; for (const cb of listeners) cb('SIGNED_OUT', null); },
  },
  from(table) {
    let filters = [];
    const q = {
      select() { return q; }, order() { return q; },
      eq(key, value) { filters.push(row => row[key] === value); return q; },
      in(key, values) { filters.push(row => values.includes(row[key])); return q; },
      maybeSingle() { q.single = true; return q; },
      then(done, reject) {
        calls.push(table);
        const data = (rows[table] || []).filter(row => filters.every(f => f(row)));
        return Promise.resolve({ data: q.single ? data[0] || null : data, error: fail ? new Error('offline') : null }).then(done, reject);
      },
    }; return q;
  },
};
function load(relative, env = {}) {
  const cache = new Map();
  function read(file) {
    if (cache.has(file)) return cache.get(file).exports;
    const mod = { exports: {} }; cache.set(file, mod);
    const input = readFileSync(file, 'utf8').replaceAll('import.meta.env', JSON.stringify(env));
    const code = ts.transpileModule(input, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX, esModuleInterop: true } }).outputText;
    function req(name) {
      if (name.endsWith('/supabase')) return { supabase };
      if (name === 'react-router-dom') return { useLocation: () => ({ pathname }), useNavigate: () => path => { pathname = path; } };
      if (name.includes('/pages/')) return { __esModule: true, default: () => h('p', null, name.split('/').at(-1)) };
      if (!name.startsWith('.')) return require(name);
      const base = resolve(dirname(file), name);
      return read([base, base + '.ts', base + '.tsx'].find(existsSync));
    }
    vm.runInThisContext('(function(require,module,exports){' + code + '\n})', { filename: file })(req, mod, mod.exports);
    return mod.exports;
  }
  return read(resolve(relative));
}
const { resolveClubSlug } = load('src/lib/clubHost.ts');
test('hostname resolution isolates surfaces and never falls back on arbitrary hosts', () => {
  assert.equal(readFileSync('src/lib/clubHost.ts', 'utf8'), readFileSync('pwa/src/lib/clubHost.ts', 'utf8'));
  assert.equal(resolveClubSlug('app-alpha.feelike.pro', 'pwa', {}), 'alpha');
  assert.equal(resolveClubSlug('APP-BETA.FEELIKE.PRO.', 'pwa', {}), 'beta');
  for (const host of ['alpha.feelike.pro', 'admin.feelike.pro', 'app-admin.feelike.pro', 'app-app-alpha.feelike.pro', 'app--alpha.feelike.pro', 'evil.example', 'unknown.vercel.app', 'app-alpha.feelike.app']) {
    assert.equal(resolveClubSlug(host, 'pwa', { VITE_DEV_CLUB_SLUG: 'cac-tennis' }), null, host);
  }
  assert.equal(resolveClubSlug('localhost', 'pwa', { DEV: true, VITE_DEV_CLUB_SLUG: 'alpha' }), 'alpha');
  assert.equal(resolveClubSlug('localhost', 'pwa', { DEV: true, VITE_ENV: 'production', VITE_DEV_CLUB_SLUG: 'alpha' }), null);
  assert.equal(resolveClubSlug('preview.vercel.app', 'bo', { VITE_ALLOWED_HOSTS: 'preview.vercel.app', VITE_DEV_CLUB_SLUG: 'beta' }), 'beta');
  assert.equal(resolveClubSlug('admin.feelike.pro', 'bo', { VITE_ALLOWED_HOSTS: 'admin.feelike.pro', VITE_DEV_CLUB_SLUG: 'alpha' }), null);
});
test('wildcard routes PWA paths before storefront assets, without redirect', () => {
  const [route] = domainRoutes('https://pwa-fixture.vercel.app');
  const host = new RegExp(route.has[0].value);
  for (const name of ['app-alpha.feelike.pro', 'app-beta-tennis.feelike.pro']) assert.ok(host.test(name));
  for (const name of ['alpha.feelike.pro', 'admin.feelike.pro', 'app-alpha.feelike.pro.evil.com']) assert.ok(!host.test(name));
  for (const path of ['/sw.js', '/assets/app.js', '/courses', '/manifest.webmanifest']) {
    assert.equal(path.replace(new RegExp(route.src), route.dest), 'https://pwa-fixture.vercel.app' + path);
  }
  assert.equal(route.status, undefined);
  assert.deepEqual(domainRoutes(''), []);
  for (const origin of ['http://pwa.vercel.app', 'https://app-alpha.feelike.pro', 'https://pwa.vercel.app/x', 'https://user@pwa.vercel.app']) assert.throws(() => domainRoutes(origin));
});
async function mount(component, children) {
  const root = createRoot(document.getElementById('root'));
  await act(async () => { root.render(h(component, null, children)); });
  return root;
}
async function click(text) {
  const button = [...document.querySelectorAll('button')].find(b => b.textContent === text);
  assert.ok(button, text); await act(async () => button.click());
}
function reset() {
  localStorage.clear(); sessionStorage.clear(); pathname = '/'; user = { id: 'u1' }; fail = false; calls = [];
  rows = { club_members: [{ user_id: 'u1', club_id: 'a' }, { user_id: 'u1', club_id: 'b' }], profiles: [{ id: 'u1', is_super_admin: false }], clubs: [alpha, beta] };
}
test('central BO: choose, change, forged choice, signout and account isolation', async () => {
  reset(); sessionStorage.setItem('feelike_admin_club:u1', 'forged');
  const Admin = load('src/components/AdminEntry.tsx').default;
  const root = await mount(Admin, club => h('p', null, 'CONTENU ' + club.id));
  assert.match(document.body.textContent, /Choisir un club/);
  await click('Alpha Tennis'); assert.match(document.body.textContent, /CONTENU a/);
  await click('Changer de club'); assert.doesNotMatch(document.body.textContent, /CONTENU/);
  await click('Beta Tennis'); assert.match(document.body.textContent, /CONTENU b/);
  await click('Se déconnecter'); assert.match(document.body.textContent, /LoginPage/);
  await act(async () => { user = { id: 'u2' }; for (const cb of listeners) cb('SIGNED_IN', { user }); });
  assert.match(document.body.textContent, /Aucun club actif/); assert.doesNotMatch(document.body.textContent, /CONTENU/);
  await act(async () => root.unmount());
});
test('central BO: suspended memberships hidden, support restricted to superadmin', async () => {
  reset(); rows.clubs = [{ ...alpha, status: 'suspended' }];
  localStorage.setItem('feelike_support_club', 'a');
  const Admin = load('src/components/AdminEntry.tsx').default;
  let root = await mount(Admin, club => h('p', null, 'CONTENU ' + club.id));
  assert.match(document.body.textContent, /Aucun club actif/);
  assert.equal(localStorage.getItem('feelike_support_club'), null);
  await act(async () => root.unmount());
  rows.profiles[0].is_super_admin = true; localStorage.setItem('feelike_support_club', 'a');
  root = await mount(Admin, (club, support) => h('p', null, 'SUPPORT ' + club.id + ' ' + support));
  assert.match(document.body.textContent, /SUPPORT a true/);
  await act(async () => root.unmount());
});
test('central BO: no club required for activation/recovery/platform console', async () => {
  for (const [path, expected] of [['/accept-invite', 'AcceptInvitePage'], ['/reset-password', 'PasswordRecoveryPage'], ['/forgot-password', 'PasswordRecoveryPage'], ['/super-admin', 'SuperAdminPage']]) {
    reset(); rows.club_members = []; rows.profiles[0].is_super_admin = true; pathname = path;
    const Admin = load('src/components/AdminEntry.tsx').default;
    const root = await mount(Admin, () => h('p', null, 'WRONG'));
    assert.match(document.body.textContent, new RegExp(expected));
    await act(async () => root.unmount());
  }
});
test('PWA distinguishes missing/suspended club from database failure and never mounts business UI', async () => {
  for (const [host, records, offline, expected] of [
    ['app-alpha.feelike.pro', [alpha], false, 'BUSINESS'],
    ['app-beta.feelike.pro', [alpha], false, 'Club introuvable'],
    ['app-alpha.feelike.pro', [{ ...alpha, status: 'suspended' }], false, 'Club introuvable'],
    ['app-alpha.feelike.pro', [alpha], true, 'Connexion momentanément'],
    ['unknown.example', [alpha], false, 'Club introuvable'],
  ]) {
    reset(); rows.clubs = records; fail = offline; dom.reconfigure({ url: 'https://' + host });
    const { ClubProvider } = load('pwa/src/contexts/ClubContext.tsx');
    const root = await mount(ClubProvider, h('p', null, 'BUSINESS'));
    assert.match(document.body.textContent, new RegExp(expected));
    if (expected !== 'BUSINESS') assert.doesNotMatch(document.body.textContent, /BUSINESS/);
    if (host === 'unknown.example') assert.equal(calls.length, 0);
    await act(async () => root.unmount());
  }
});
