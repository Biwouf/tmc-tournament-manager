// PR-BO2 — accueil « À traiter » et compteurs de la barre latérale.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { createRequire } from 'node:module';
import vm from 'node:vm';
import ts from 'typescript';
import { JSDOM } from 'jsdom';

const dom = new JSDOM('<div id="root"></div>', { url: 'https://admin.feelike.pro/' });
globalThis.window = dom.window; globalThis.document = dom.window.document; globalThis.localStorage = dom.window.localStorage;
globalThis.IS_REACT_ACT_ENVIRONMENT = true;
const base = resolve(new URL('..', import.meta.url).pathname);
const req = createRequire(resolve(base, 'package.json'));
const { act, createElement: h } = req('react');
const { createRoot } = req('react-dom/client');
const { MemoryRouter } = req('react-router-dom');

const DAY = 86_400_000;
const ago = (days) => new Date(Date.now() - days * DAY).toISOString();
const EMPTY = { signup_pending: 0, signup_oldest_at: null, scores_to_enter: 0, scores_oldest_at: null, scores_preview: [],
  course_pending: 0, course_oldest_at: null, course_next: null, live_count: 0, stale_lives: 0, stale_lives_oldest_at: null };
const FULL = { signup_pending: 1, signup_oldest_at: ago(3.5), scores_to_enter: 3, scores_oldest_at: ago(9),
  scores_preview: [{ id: 'r1', nom: 'Interclubs', genre: 'hommes', categorie: 'seniors', numero: 2, club_adverse: 'Moissac', date_heure: ago(9) },
    { id: 'r2', nom: 'CODEP', genre: 'femmes', categorie: 'seniors', numero: 1, club_adverse: 'Montauban', date_heure: ago(2) }],
  course_pending: 2, course_oldest_at: ago(1), course_next: { id: 'k1', name: 'Cours adultes', starts_at: ago(-2) },
  live_count: 4, stale_lives: 1, stale_lives_oldest_at: ago(20) };

let inbox, failure, calls, role, requests;
const supabase = {
  auth: { getSession: async () => ({ data: {} }), onAuthStateChange: () => ({ data: { subscription: { unsubscribe() {} } } }) },
  rpc(name, args) {
    calls.push([name, args]);
    const result = name === 'admin_inbox' ? (failure ? { data: null, error: { message: 'down' } } : { data: inbox, error: null })
      : name === 'club_signup_admin_list' ? { data: requests, error: null } : { data: null, error: null };
    if (name === 'club_signup_decide') { inbox = { ...inbox, signup_pending: 0 }; requests = []; }
    return Promise.resolve(result);
  },
  from(table) {
    const q = { select: () => q, eq: () => q, maybeSingle: () => q,
      then: (done) => done({ data: table === 'profiles' ? { prenom: 'Alice' } : null, error: null }) };
    return q;
  },
};
const cache = new Map();
function load(file) {
  if (file.endsWith('/lib/supabase.ts')) return { supabase };
  if (file.endsWith('/contexts/ClubContext.tsx')) return { useClub: () => ({ clubId: 'c1', club: { id: 'c1', name: 'CAC', plan: 'internal', created_via: 'console' }, isSupport: false }) };
  if (file.endsWith('/contexts/ClubRoleContext.tsx')) return { useClubRole: () => ({ role, isMember: true, isSuperAdmin: false, loading: false }) };
  for (const name of ['/home/WeekAgenda.tsx', '/dashboard/ClubSetup.tsx', '/layout/UserMenu.tsx']) if (file.endsWith(name)) return { __esModule: true, default: () => null };
  if (cache.has(file)) return cache.get(file).exports;
  const mod = { exports: {} }; cache.set(file, mod);
  const code = ts.transpileModule(readFileSync(file, 'utf8'), { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX, esModuleInterop: true } }).outputText;
  const require = (name) => {
    if (!name.startsWith('.')) return req(name);
    const p = resolve(dirname(file), name);
    return load([p, `${p}.ts`, `${p}.tsx`].find((f) => existsSync(f) && /\.(ts|tsx|mjs|js)$/.test(f)));
  };
  vm.runInThisContext(`(function(require,module,exports){${code}\n})`, { filename: file })(require, mod, mod.exports);
  return mod.exports;
}
const at = (path) => load(resolve(base, path));
const Provider = at('src/components/layout/AdminInboxProvider.tsx').default;
const Sidebar = at('src/components/layout/SidebarNav.tsx').default;
const Home = at('src/pages/AppHomePage.tsx').default;
const SignupRequests = at('src/components/SignupRequests.tsx').default;
const { notifyInboxChanged } = at('src/lib/inboxSignal.ts');
const user = { id: 'u1', email: 'a@example.test' };
const flush = () => act(async () => { for (let i = 0; i < 5; i++) await new Promise((r) => setTimeout(r, 0)); });
const text = () => document.querySelector('[data-page]').textContent;
const nav = () => Object.fromEntries([...document.querySelectorAll('nav a')].map((a) => [a.querySelector('span:not([aria-hidden])').textContent, a.querySelector('.rounded-full')]));
const reads = () => calls.filter(([name]) => name === 'admin_inbox').length;

async function mount(page = h(Home, { user }), path = '/') {
  const root = createRoot(document.getElementById('root'));
  await act(async () => root.render(h(MemoryRouter, { initialEntries: [path] }, h(Provider, null,
    h(Sidebar, { user, clubName: 'CAC', logo: '/logo.png' }), h('div', { 'data-page': '' }, page)))));
  await flush();
  return async () => { await act(async () => root.unmount()); document.body.innerHTML = '<div id="root"></div>'; };
}
test.beforeEach(() => { inbox = FULL; failure = false; calls = []; role = 'admin'; requests = []; });

test('home: one row per type, oldest first, each with its target', async () => {
  const unmount = await mount();
  assert.match(text(), /Bonjour Alice/);
  assert.match(text(), /7 éléments demandent votre attention/);
  assert.deepEqual([...document.querySelectorAll('[data-page] h3')].map((x) => x.textContent),
    ['1 live ouvert depuis plus de 6 jours', '3 scores de rencontre à saisir', '1 demande d’adhésion', '2 inscriptions à un cours à valider']);
  assert.deepEqual([...document.querySelectorAll('[data-page] li:has(h3) a')].map((a) => a.getAttribute('href')),
    ['/live-score', '/team-matches', '/admin/members#demandes', '/courses/k1/registrations?status=pending']);
  assert.match(text(), /éq\. 2 contre Moissac · .*éq\. 1 contre Montauban · \+1 autre/);
  assert.match(text(), /attend depuis 3 jours/);
  assert.equal(reads(), 1, 'one read for the home and the sidebar');
  await unmount();
});

test('home: nothing to do, then failure with retry', async () => {
  inbox = EMPTY;
  let unmount = await mount();
  assert.match(text(), /Rien à traiter pour l’instant/);
  assert.doesNotMatch(text(), /votre attention/);
  assert.match(text(), /Raccourcis/);
  assert.ok(Object.values(nav()).every((badge) => badge === null), 'no counter at 0');
  await unmount();
  failure = true;
  unmount = await mount();
  assert.match(text(), /Impossible de charger/);
  assert.doesNotMatch(text(), /Rien à traiter/);
  failure = false; inbox = FULL;
  await act(async () => [...document.querySelectorAll('button')].find((b) => b.textContent === 'Réessayer').click());
  await flush();
  assert.match(text(), /7 éléments/);
  await unmount();
});

test('sidebar: ink counters to act on, neutral one for lives, none for Messages', async () => {
  const unmount = await mount();
  const badges = nav();
  const value = (label) => badges[label]?.firstChild.textContent;
  assert.deepEqual(['Accueil', 'Adhérents', 'Cours', 'Rencontres', 'Live score', 'Messages'].map(value), ['7', '1', '2', '3', '4', undefined]);
  for (const label of ['Accueil', 'Adhérents', 'Cours', 'Rencontres']) assert.match(badges[label].className, /bg-foreground/);
  assert.match(badges['Live score'].className, /bg-muted/);
  assert.doesNotMatch(document.querySelector('nav').innerHTML.match(/rounded-full[^"]*/g).join(), /primary/);
  await unmount();
});

test('refresh: window focus, action signal, and an accepted request lowers the counter without reload', async () => {
  requests = [{ user_id: 'u9', email: 'x@y.z', prenom: 'Bob', nom: 'Dupont', sex: 'male', classement: null, status: 'pending', created_at: ago(1) }];
  const unmount = await mount(h(SignupRequests, { clubId: 'c1', onChanged() {} }), '/admin/members');
  assert.equal(nav()['Adhérents'].firstChild.textContent, '1');
  await act(async () => [...document.querySelectorAll('button')].find((b) => b.textContent === 'Accepter comme membre').click());
  await flush();
  assert.equal(nav()['Adhérents'], null);
  assert.equal(nav()['Accueil'].firstChild.textContent, '6');
  const before = reads();
  await act(async () => window.dispatchEvent(new window.Event('focus'))); await flush();
  assert.equal(reads(), before + 1);
  await act(async () => notifyInboxChanged()); await flush();
  assert.equal(reads(), before + 2);
  await unmount();
  notifyInboxChanged();
  assert.equal(reads(), before + 2, 'unsubscribed');
});

test('member and manager: no read, no counter, no « À traiter »', async () => {
  for (const [who, links] of [['member', ['/live-score/new']], ['manager', ['/actus/new', '/events/new', '/live-score/new']]]) {
    role = who;
    const unmount = await mount();
    assert.equal(reads(), 0);
    assert.doesNotMatch(text(), /À traiter/);
    assert.ok(Object.values(nav()).every((badge) => badge === null));
    assert.deepEqual([...document.querySelectorAll('[data-page] a')].map((a) => a.getAttribute('href')), links);
    await unmount();
  }
});
