// SaaS S8 — tableau de bord : bandeau d'essai, checklist, « Publier le site », mot de passe, reprise.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { createRequire } from 'node:module';
import vm from 'node:vm';
import ts from 'typescript';
import { JSDOM } from 'jsdom';
import { isReadyForIndexing, siteGaps } from '../shared/siteReadiness.mjs';

const dom = new JSDOM('<div id="root"></div>', { url: 'https://admin.feelike.pro/' });
globalThis.window = dom.window; globalThis.document = dom.window.document;
globalThis.localStorage = dom.window.localStorage;
globalThis.KeyboardEvent = dom.window.KeyboardEvent;
globalThis.IS_REACT_ACT_ENVIRONMENT = true;
globalThis.ResizeObserver = class { observe() {} disconnect() {} };
let clipboard = null;
Object.defineProperty(globalThis, 'navigator', { configurable: true, value: { userAgent: 'node', clipboard: { writeText: async (t) => { clipboard = t; } } } });
const base = resolve(new URL('..', import.meta.url).pathname);
const req = createRequire(resolve(base, 'package.json'));
const { act, createElement: h } = req('react');
const { createRoot } = req('react-dom/client');
const { MemoryRouter, Routes, Route, useLocation } = req('react-router-dom');

// Un site complet au sens de la vitrine.
const COMPLETE = {
  brand: { name: 'TC Alpha', color: '#1d3f8f' },
  home: { published: true, hero_title: 'Bienvenue' },
  pricing: { published: true, season: '2026/2027', membership: [{ name: 'Adulte', price: 180 }] },
  contact: { published: true, address_street: '1 rue du Court', address_postal_code: '82100', address_city: 'Castelsarrasin', email: 'club@example.test' },
};
const self = { id: 'c1', slug: 'tc-alpha', name: 'TC Alpha', sport: 'tennis', status: 'active', plan: 'trial', created_via: 'self_serve', site_published: false, trial_ends_at: new Date(Date.now() + 20 * 86_400_000).toISOString() };
const cac = { ...self, id: 'c2', slug: 'cac', name: 'CAC', plan: 'internal', created_via: 'console', site_published: true, trial_ends_at: null };
const ME = 'u1';

let db, log, user, members, rpcError, context;
function reset({ config = {}, club = self, meta } = {}) {
  db = { club_settings: [{ club_id: club.id, config }], clubs: [{ ...club }] };
  log = []; rpcError = null; clipboard = null;
  user = { id: ME, app_metadata: { created_via: 'club_signup' }, user_metadata: {}, ...meta };
  members = [{ user_id: ME, role: 'admin', status: 'active' }];
  context = { club, role: 'admin', isSupport: false };
  localStorage.clear();
}
const supabase = {
  auth: {
    getSession: async () => ({ data: { session: { user } } }),
    getUser: async () => { log.push(['getUser']); return { data: { user } }; },
    onAuthStateChange: () => ({ data: { subscription: { unsubscribe() {} } } }),
    async updateUser(attrs) { log.push(['updateUser', attrs]); return { data: {}, error: user.updateError ?? null }; },
  },
  async rpc(name, args) {
    log.push(['rpc', name, args]);
    if (rpcError) return { data: null, error: { message: rpcError } };
    db.clubs.find(c => c.id === args.p_club).site_published = args.p_published;
    return { data: args.p_published, error: null };
  },
  functions: { async invoke(name, { body }) { log.push(['invoke', name, body.action]); return { data: { success: true, members }, error: null }; } },
  from(table) {
    log.push(['read', table]);
    let filters = [], write = null, single = false;
    const rows = () => (db[table] || []).filter(row => filters.every(f => f(row)));
    const q = {
      select() { return q; }, order() { return q; }, limit() { return q; },
      eq(key, value) { filters.push(row => row[key] === value); return q; },
      maybeSingle() { single = true; return q; }, single() { single = true; return q; },
      update(payload) { log.push(['update', table, payload]); write = () => { const found = rows(); found.forEach(row => Object.assign(row, payload)); return found; }; return q; },
      then(done) { const data = write ? write() : rows(); done({ data: single ? data[0] ?? null : data, error: null }); },
    };
    return q;
  },
};
function load(relative) {
  const cache = new Map();
  function read(file) {
    if (file.endsWith('/lib/supabase.ts')) return { supabase };
    if (file.endsWith('/contexts/ClubContext.tsx')) return { useClub: () => ({ clubId: context.club.id, club: context.club, isSupport: context.isSupport, loading: false }) };
    if (file.endsWith('/contexts/ClubRoleContext.tsx')) return { useClubRole: () => ({ role: context.role, isMember: true, isSuperAdmin: false, loading: false }) };
    // L'étape affiches (S7b) importe l'export vidéo (Worker, import.meta) : hors de propos ici.
    if (file.endsWith('/rencontresAnimation/useRencontresVideo.ts')) return { useRencontresVideo: () => ({ encoderOk: false, canExport: false, exporting: false, progress: null, exportError: '', cancel() {}, download: async () => {} }) };
    if (cache.has(file)) return cache.get(file).exports;
    const mod = { exports: {} }; cache.set(file, mod);
    const code = ts.transpileModule(readFileSync(file, 'utf8'), { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX, esModuleInterop: true } }).outputText;
    const require = (name) => {
      if (name.endsWith('.css') || name.startsWith('@fontsource')) return {};
      if (name === 'html-to-image') return { toJpeg: async () => 'data:image/jpeg;base64,' };
      if (!name.startsWith('.')) return req(name);
      const p = resolve(dirname(file), name);
      return read([p, `${p}.ts`, `${p}.tsx`].find(existsSync));
    };
    vm.runInThisContext(`(function(require,module,exports){${code}\n})`, { filename: file })(require, mod, mod.exports);
    return mod.exports;
  }
  return read(resolve(base, relative));
}
const lib = load('src/lib/dashboardChecklist.ts');
const { parseClubConfig } = load('src/lib/clubConfig.ts');
const flush = () => act(async () => { for (let i = 0; i < 5; i++) await new Promise(r => setTimeout(r, 0)); });
const text = () => document.body.textContent;
const buttonNamed = (name) => [...document.querySelectorAll('button')].find(b => b.textContent === name);
async function click(name) { const b = buttonNamed(name); assert.ok(b, name); await act(async () => b.click()); await flush(); }
function Where() { const l = useLocation(); return h('p', { 'data-where': l.pathname + l.search }); }
const where = () => document.querySelector('[data-where]')?.dataset.where;

/** Le vrai tableau de bord, avec sa lecture de config (`useClubConfig`). */
async function mountHome(path = '/') {
  const Home = load('src/pages/AppHomePage.tsx').default;
  const Page = load('src/pages/FirstStepsPage.tsx').default;
  const root = createRoot(document.getElementById('root'));
  await act(async () => root.render(h(MemoryRouter, { initialEntries: [path] }, h(Where), h(Routes, null,
    h(Route, { path: '/', element: h(Home) }),
    h(Route, { path: '/premiers-pas', element: h(Page) }),
    h(Route, { path: '/admin/site', element: h('p', null, 'CONFIG SITE') })))));
  await flush();
  return async () => { await act(async () => root.unmount()); document.body.innerHTML = '<div id="root"></div>'; };
}
const facts = (config = {}, more = {}) => ({ config: parseClubConfig(config), sitePublished: false, team: false, passwordSet: false, ...more });
const ids = (items) => items.map(i => i.id);

test('shared readiness rule: gaps listed, search_indexing kept out of the checklist', () => {
  const config = parseClubConfig(COMPLETE);
  assert.deepEqual(siteGaps(config), []);
  assert.equal(isReadyForIndexing(config), true);
  assert.equal(isReadyForIndexing(parseClubConfig({ ...COMPLETE, settings: { search_indexing: false } })), false);
  assert.deepEqual(siteGaps(parseClubConfig({ ...COMPLETE, settings: { search_indexing: false } })), []);
  assert.deepEqual(siteGaps(parseClubConfig({})), ['accueil', 'tarifs', 'adresse', 'téléphone ou e-mail']);
  assert.deepEqual(siteGaps(parseClubConfig({ ...COMPLETE, contact: { published: false } })), ['contact']);
  assert.deepEqual(siteGaps(parseClubConfig({ ...COMPLETE, pricing: { published: true, membership: [{ name: 'Adulte' }] }, contact: { published: true, phone: '05' } })),
    ['saison des tarifs', 'prix des tarifs', 'adresse']);
  // Pas de copie : la vitrine importe la règle partagée.
  assert.doesNotMatch(readFileSync(resolve(base, 'web/src/lib/site.ts'), 'utf8'), /function isReadyForIndexing/);
});

test('eligibility: self-serve admins only, never internal, members or support', () => {
  assert.equal(lib.eligibleForChecklist(self, 'admin', false), true);
  assert.equal(lib.eligibleForChecklist({ ...self, plan: 'saison' }, 'admin', false), true);
  assert.equal(lib.eligibleForChecklist(cac, 'admin', false), false);
  assert.equal(lib.eligibleForChecklist({ ...self, created_via: 'console' }, 'admin', false), false);
  assert.equal(lib.eligibleForChecklist(self, 'member', false), false);
  assert.equal(lib.eligibleForChecklist(self, 'admin', true), false);
});

test('trial banner: days left in Paris calendar days, accent from J-7, J0 message, nothing outside trial', () => {
  const now = new Date('2026-11-14T10:00:00Z');
  const at = (iso) => lib.trialBanner({ ...self, trial_ends_at: iso }, now);
  assert.deepEqual(at('2026-12-14T10:00:00Z'), { label: 'Essai · 30 jours restants', urgent: false });
  assert.deepEqual(at('2026-11-22T10:00:00Z'), { label: 'Essai · 8 jours restants', urgent: false });
  assert.deepEqual(at('2026-11-21T10:00:00Z'), { label: 'Essai · 7 jours restants', urgent: true });
  assert.deepEqual(at('2026-11-15T08:00:00Z'), { label: 'Essai · 1 jour restant', urgent: true });
  assert.deepEqual(at('2026-11-14T22:00:00Z'), { label: 'Votre essai se termine aujourd’hui', urgent: true });
  // 23 h 30 à Paris le 14 : le lendemain 00 h 30 (Paris) est déjà J-1.
  assert.equal(lib.trialBanner({ ...self, trial_ends_at: '2026-11-14T23:30:00Z' }, new Date('2026-11-14T22:30:00Z')).label, 'Essai · 1 jour restant');
  assert.deepEqual(at('2026-11-14T09:00:00Z'), { label: 'Essai terminé', urgent: true });
  assert.equal(lib.trialBanner({ ...self, plan: 'saison' }, now), null);
  assert.equal(lib.trialBanner(cac, now), null);
});

test('checklist states, order and counter; password optional and out of the counter', () => {
  let items = lib.checklistItems(facts());
  assert.deepEqual(ids(items), ['site', 'publish', 'team', 'share', 'password']);
  assert.match(items[0].detail, /Il manque : accueil, tarifs, adresse et téléphone ou e-mail\./);
  assert.deepEqual(lib.checklistProgress(items), { done: 0, total: 4 });
  items = lib.checklistItems(facts({ ...COMPLETE, onboarding: { app_shared_at: '2026-11-14' } }, { sitePublished: true, team: true, passwordSet: false }));
  assert.deepEqual(items.map(i => i.done), [true, true, true, true, false]);
  assert.deepEqual(lib.checklistProgress(items), { done: 4, total: 4 });
  assert.equal(lib.checklistComplete(items), true, 'the optional password does not hold the card');
  // Liste des membres pas encore lue : à faire.
  assert.equal(lib.checklistItems(facts({}, { team: null })).find(i => i.id === 'team').done, false);
  // Compte qui n'est pas né du tunnel : pas d'élément mot de passe.
  assert.deepEqual(ids(lib.checklistItems(facts({}, { passwordSet: null }))), ['site', 'publish', 'team', 'share']);
  assert.equal(lib.passwordState({ app_metadata: { created_via: 'club_signup' }, user_metadata: {} }), false);
  assert.equal(lib.passwordState({ app_metadata: { created_via: 'club_signup' }, user_metadata: { password_set: true } }), true);
  assert.equal(lib.passwordState({ app_metadata: {}, user_metadata: {} }), null);
  assert.equal(lib.passwordState(null), null);
  assert.equal(lib.passwordProblem('12345', '12345'), 'Mot de passe trop court (6 caractères minimum).');
  assert.equal(lib.passwordProblem('123456', '123457'), 'Les mots de passe ne correspondent pas.');
  assert.equal(lib.passwordProblem('123456', '123456'), null);
  assert.match(lib.passwordUpdateError({ code: 'reauthentication_needed', message: 'x' }), /reconnectez-vous/);
});

test('postponed steps: reminded once the course is left, kept and ticked when resumed', () => {
  const steps = (onboarding) => ids(lib.checklistItems(facts({ onboarding }, { passwordSet: null }))).filter(id => id.startsWith('step:'));
  assert.deepEqual(steps({ completed_steps: ['actu'], skipped_steps: ['equipes'] }), [], 'course not left yet');
  assert.deepEqual(steps({ completed_steps: ['actu'], skipped_steps: ['equipes'], finished_at: 'x' }), ['step:equipes', 'step:affiches']);
  assert.deepEqual(steps({ completed_steps: [], postponed_at: 'x' }), ['step:actu', 'step:equipes', 'step:affiches']);
  assert.deepEqual(steps({ completed_steps: ['actu', 'equipes', 'affiches'], finished_at: 'x' }), []);
  const items = lib.checklistItems(facts({ onboarding: { completed_steps: ['actu', 'equipes'], resumed_steps: ['equipes'], finished_at: 'x' } }, { passwordSet: null }));
  assert.deepEqual(items.filter(i => i.id.startsWith('step:')).map(i => [i.id, i.done]), [['step:equipes', true], ['step:affiches', false]]);
  assert.deepEqual(lib.checklistProgress(items), { done: 1, total: 6 });
});

test('completing a step after leaving the course records it as resumed; not before', async () => {
  const { completeFirstStep } = load('src/lib/firstSteps.ts');
  reset({ config: { onboarding: { completed_steps: [], skipped_steps: ['equipes'], postponed_at: 'x' } } });
  const { state } = await completeFirstStep('c1', 'equipes');
  assert.deepEqual([state.completed_steps, state.skipped_steps, state.resumed_steps], [['equipes'], [], ['equipes']]);
  reset({ config: { onboarding: { completed_steps: [] } } });
  assert.deepEqual((await completeFirstStep('c1', 'actu')).state.resumed_steps, []);
});

test('CAC and internal clubs: no banner, no checklist, no extra read', async () => {
  reset({ club: cac, config: {} });
  const unmount = await mountHome();
  assert.doesNotMatch(text(), /Essai|Pour finir/);
  assert.deepEqual(log.filter(l => l[0] !== 'read' || l[1] !== 'club_settings'), [], 'only the existing config read');
  await unmount();
  reset({ config: {} }); context.role = 'member';
  const again = await mountHome();
  assert.doesNotMatch(text(), /Essai|Pour finir/);
  await again();
});

test('trial club, first steps finished: banner, real states, actions lead to the right places', async () => {
  reset({ config: { brand: COMPLETE.brand, onboarding: { completed_steps: ['actu', 'equipes', 'affiches'], finished_at: 'x' } } });
  members.push({ user_id: 'u2', role: 'member', status: 'active' });
  const unmount = await mountHome();
  assert.match(text(), /Essai · 20 jours restants/);
  assert.match(text(), /Pour finir d’installer le club/);
  assert.equal(document.querySelector('[aria-live="polite"]').textContent, '0 / 4 éléments faits');
  assert.match(text(), /Il manque : accueil, tarifs, adresse et téléphone ou e-mail/);
  assert.equal(buttonNamed('Publier le site').disabled, true, 'publish waits for a complete site');
  assert.equal([...document.querySelectorAll('a')].find(a => a.textContent === 'Compléter').getAttribute('href'), '/admin/site');
  assert.equal([...document.querySelectorAll('a')].find(a => a.textContent === 'Inviter').getAttribute('href'), '/admin/members');
  assert.equal([...document.querySelectorAll('a')].find(a => /propre fond/.test(a.textContent)).getAttribute('href'), '/admin/site#panneau-posters');
  assert.ok(log.some(l => l[0] === 'invoke' && l[1] === 'club-members'), 'an adherent who joined is not the board');
  // Repliable, préférence mémorisée.
  await click('Replier');
  assert.equal(document.getElementById('checklist-items').hidden, true);
  assert.equal(localStorage.getItem('feelike_checklist_collapsed:c1'), '1');
  await click('Afficher');
  // Partager : le QR s'affiche, l'élément est fait.
  await click('Partager');
  assert.ok(document.querySelector('[role="dialog"] svg[aria-label="QR code vers l\'app"]'));
  await click('Copier le lien');
  assert.equal(clipboard, 'https://app-tc-alpha.feelike.pro');
  assert.match(document.querySelector('textarea').value, /https:\/\/app-tc-alpha\.feelike\.pro/);
  assert.ok(db.club_settings[0].config.onboarding.app_shared_at);
  await click('Fermer');
  assert.equal(document.querySelector('[aria-live="polite"]').textContent, '1 / 4 éléments faits');
  await unmount();
});

test('publish: confirmation, RPC, then the item is done; the card leaves when everything is done', async () => {
  reset({ config: { ...COMPLETE, onboarding: { completed_steps: ['actu', 'equipes', 'affiches'], finished_at: 'x', app_shared_at: 'x' } } });
  members.push({ user_id: 'u2', role: 'admin', status: 'active' });
  let unmount = await mountHome();
  assert.equal(document.querySelector('[aria-live="polite"]').textContent, '3 / 4 éléments faits');
  await click('Publier le site');
  assert.match(document.querySelector('[role="dialog"]').textContent, /visible des moteurs de recherche/);
  rpcError = 'Réservé aux administrateurs du club.';
  await click('Publier');
  assert.match(document.querySelector('[role="alert"]').textContent, /Réservé/);
  rpcError = null;
  await click('Publier');
  assert.deepEqual(log.filter(l => l[1] === 'club_set_site_published').at(-1)[2], { p_club: 'c1', p_published: true });
  assert.equal(document.querySelector('[role="dialog"]'), null);
  assert.doesNotMatch(text(), /Pour finir/, 'only the optional password was left');
  assert.match(text(), /Essai · 20 jours restants/, 'the banner stays');
  await unmount();
  // Rechargement : publié lu sur `clubs`.
  unmount = await mountHome();
  assert.doesNotMatch(text(), /Pour finir/);
  await unmount();
});

test('password: validation, updateUser sets password_set, then the line is ticked', async () => {
  reset({ config: { brand: COMPLETE.brand, onboarding: { finished_at: 'x', completed_steps: ['actu', 'equipes', 'affiches'] } } });
  const unmount = await mountHome();
  await click('Choisir');
  const [pass, confirm] = document.querySelectorAll('[role="dialog"] input');
  const type = async (input, value) => { await act(async () => {
    Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set.call(input, value);
    input.dispatchEvent(new window.Event('input', { bubbles: true }));
  }); };
  await type(pass, 'abc'); await type(confirm, 'abc');
  await click('Enregistrer');
  assert.match(document.querySelector('[role="alert"]').textContent, /trop court/);
  assert.equal(log.filter(l => l[0] === 'updateUser').length, 0);
  await type(pass, 'secret-123'); await type(confirm, 'secret-123');
  await click('Enregistrer');
  assert.deepEqual(log.find(l => l[0] === 'updateUser')[1], { password: 'secret-123', data: { password_set: true } });
  assert.equal(document.querySelector('[role="dialog"]'), null);
  assert.ok(!buttonNamed('Choisir'));
  assert.match(text(), /Fait :Choisir un mot de passe/);
  await unmount();
});

test('a postponed step reopens from the checklist; the page refuses a done step and an internal club', async () => {
  reset({ config: { brand: COMPLETE.brand, onboarding: { completed_steps: [], postponed_at: 'x' } } });
  let unmount = await mountHome();
  const resume = [...document.querySelectorAll('a')].filter(a => a.textContent === 'Reprendre').map(a => a.getAttribute('href'));
  assert.deepEqual(resume, ['/premiers-pas?etape=actu', '/premiers-pas?etape=equipes', '/premiers-pas?etape=affiches']);
  await unmount();
  unmount = await mountHome('/premiers-pas?etape=actu');
  assert.equal(where(), '/premiers-pas?etape=actu');
  assert.match(text(), /Première actu/);
  await unmount();
  reset({ config: { brand: COMPLETE.brand, onboarding: { completed_steps: ['actu'], postponed_at: 'x' } } });
  unmount = await mountHome('/premiers-pas?etape=actu');
  assert.equal(where(), '/');
  await unmount();
  reset({ club: cac, config: { onboarding: { completed_steps: [], postponed_at: 'x' } } });
  unmount = await mountHome('/premiers-pas?etape=actu');
  assert.equal(where(), '/');
  await unmount();
});
