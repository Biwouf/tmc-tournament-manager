// SaaS S5 — premiers pas : affichage, reprise, avancement, publication, image par défaut.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { createRequire } from 'node:module';
import vm from 'node:vm';
import ts from 'typescript';
import { JSDOM } from 'jsdom';
const dom = new JSDOM('<div id="root"></div>', { url: 'https://admin.feelike.pro/premiers-pas' });
globalThis.window = dom.window; globalThis.document = dom.window.document;
globalThis.ResizeObserver = class { observe() {} disconnect() {} };
globalThis.IS_REACT_ACT_ENVIRONMENT = true;
Object.defineProperty(globalThis, 'navigator', { configurable: true, value: { userAgent: 'node', clipboard: { writeText: async (text) => { clipboard = text; } } } });
const base = resolve(new URL('..', import.meta.url).pathname);
const req = createRequire(resolve(base, 'package.json'));
const { act, createElement: h } = req('react');
const { createRoot } = req('react-dom/client');
const { MemoryRouter, Routes, Route, useLocation } = req('react-router-dom');

let clipboard = null;
let db, log, failUpload, refuseConfig;
const HERO = 'https://x.supabase.co/storage/v1/object/public/content-images/c1/config/1-hero-image.webp';
const self = { id: 'c1', slug: 'tc-alpha', name: 'TC Alpha', sport: 'tennis', status: 'active', plan: 'trial', created_via: 'self_serve', trial_ends_at: new Date(Date.now() + 30 * 86_400_000).toISOString() };
const cac = { ...self, id: 'c2', slug: 'cac', name: 'CAC', plan: 'internal', created_via: 'console', trial_ends_at: null };
function reset(config = {}) {
  db = { club_settings: [{ club_id: 'c1', config: { brand: { name: 'TC Alpha', color: '#1d3f8f' }, home: { hero_image: HERO }, ...config } }], actus: [] };
  log = []; failUpload = false; refuseConfig = false; clipboard = null;
}
const supabase = {
  auth: {
    getSession: async () => ({ data: { session: { user: { id: 'u1' } } } }),
    onAuthStateChange: () => ({ data: { subscription: { unsubscribe() {} } } }),
  },
  async rpc(name, args) { log.push(['rpc', name, args]); return { data: 0, error: null }; },
  storage: { from: (bucket) => ({
    async upload(path, file) { log.push(['upload', bucket, path, file.type]); return { error: failUpload ? new Error('upload') : null }; },
    getPublicUrl: (path) => ({ data: { publicUrl: `https://x.supabase.co/storage/v1/object/public/${bucket}/${path}` } }),
    async remove(paths) { log.push(['remove', bucket, paths]); return { error: null }; },
  }) },
  from(table) {
    let filters = [], write = null, single = false;
    const rows = () => (db[table] || []).filter(row => filters.every(f => f(row)));
    const q = {
      select() { return q; }, order() { return q; }, limit() { return q; },
      eq(key, value) { filters.push(row => row[key] === value); return q; },
      maybeSingle() { single = true; return q; }, single() { single = true; return q; },
      insert(payload) { log.push(['insert', table, payload]); write = () => { const row = { id: `a${db[table].length + 1}`, ...payload }; db[table].push(row); return [row]; }; return q; },
      update(payload) { log.push(['update', table, payload]); write = () => { if (table === 'club_settings' && refuseConfig) return []; const found = rows(); found.forEach(row => Object.assign(row, payload)); return found; }; return q; },
      then(resolve) {
        const data = write ? write() : rows();
        resolve({ data: single ? data[0] ?? null : data, error: null });
      },
    };
    return q;
  },
};
let context = { club: self, role: 'admin', isSupport: false };
function load(relative) {
  const cache = new Map();
  function read(file) {
    if (file.endsWith('/lib/supabase.ts')) return { supabase };
    if (file.endsWith('/contexts/ClubContext.tsx')) return { useClub: () => ({ clubId: context.club.id, club: context.club, isSupport: context.isSupport, loading: false }) };
    if (file.endsWith('/contexts/ClubRoleContext.tsx')) return { useClubRole: () => ({ role: context.role, isMember: true, isSuperAdmin: false, loading: false }) };
    if (cache.has(file)) return cache.get(file).exports;
    const mod = { exports: {} }; cache.set(file, mod);
    const code = ts.transpileModule(readFileSync(file, 'utf8'), { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX, esModuleInterop: true } }).outputText;
    const require = (name) => {
      if (name.endsWith('.css') || name.startsWith('@fontsource')) return {};
      if (!name.startsWith('.')) return req(name);
      const p = resolve(dirname(file), name);
      return read([p, `${p}.ts`, `${p}.tsx`].find(existsSync));
    };
    vm.runInThisContext(`(function(require,module,exports){${code}\n})`, { filename: file })(require, mod, mod.exports);
    return mod.exports;
  }
  return read(resolve(base, relative));
}
const flush = () => act(async () => { await new Promise(r => setTimeout(r, 0)); });
const text = () => document.body.textContent;
const buttonNamed = (name) => [...document.querySelectorAll('button')].find(b => b.textContent === name);
async function click(name) { const b = buttonNamed(name); assert.ok(b, name); await act(async () => b.click()); await flush(); }
function Where() { return h('p', { 'data-where': useLocation().pathname }); }
const where = () => document.querySelector('[data-where]')?.dataset.where;
async function mount(element, path = '/premiers-pas') {
  const root = createRoot(document.getElementById('root'));
  const routes = h(MemoryRouter, { initialEntries: [path] }, h(Where), h(Routes, null,
    h(Route, { path: '/premiers-pas', element }),
    h(Route, { path: '/', element: h('p', null, 'TABLEAU DE BORD') })));
  await act(async () => root.render(routes));
  await flush();
  return async () => { await act(async () => root.unmount()); };
}
const page = () => h(load('src/pages/FirstStepsPage.tsx').default);
const heroResponse = () => { globalThis.fetch = async () => new Response(new Blob(['x'], { type: 'image/webp' }), { status: 200 }); };

test('display condition: self-serve trial club, admin, outside support; pending until finished or postponed', () => {
  const { eligibleForFirstSteps: yes, firstStepsPending: pending } = load('src/lib/firstSteps.ts');
  assert.equal(yes(self, 'admin', false), true);
  assert.equal(yes(self, 'manager', false), false);
  assert.equal(yes(self, null, false), false);
  assert.equal(yes(self, 'admin', true), false);
  assert.equal(yes(cac, 'admin', false), false);
  assert.equal(yes({ ...self, plan: 'saison' }, 'admin', false), false);
  assert.equal(yes({ ...self, created_via: 'console' }, 'admin', false), false);
  assert.equal(pending({ completed_steps: ['actu'] }), true);
  assert.equal(pending({ completed_steps: [], postponed_at: 'x' }), false);
  assert.equal(pending({ completed_steps: [], finished_at: 'x' }), false);
});

test('trial chip, app address', () => {
  const { trialLabel, clubAppHost } = load('src/lib/firstSteps.ts');
  const now = new Date('2026-11-04T10:00:00Z');
  assert.equal(trialLabel('2026-12-04T10:00:00Z', now), 'Essai · 30 jours restants');
  assert.equal(trialLabel('2026-11-05T09:00:00Z', now), 'Essai · 1 jour restant');
  assert.equal(trialLabel('2026-11-01T09:00:00Z', now), 'Essai terminé');
  assert.equal(clubAppHost('tc-alpha'), 'app-tc-alpha.feelike.pro');
});

test('dashboard gate: only a pending self-serve club is sent to the first steps; an internal club reads nothing more', async () => {
  const Gate = load('src/components/firstSteps/FirstStepsGate.tsx').default;
  const tree = () => h(Gate, null, h('p', null, 'CONTENU'));
  const render = async (ctx) => {
    context = ctx;
    const root = createRoot(document.getElementById('root'));
    await act(async () => root.render(h(MemoryRouter, { initialEntries: ['/'] }, h(Where), h(Routes, null,
      h(Route, { path: '/', element: tree() }), h(Route, { path: '/premiers-pas', element: h('p', null, 'PREMIERS PAS') })))));
    await flush();
    const seen = text(); await act(async () => root.unmount());
    return seen;
  };
  const reads = () => log.filter(l => l[0] === 'read').length;
  const from = supabase.from;
  supabase.from = (table) => { log.push(['read', table]); return from(table); };
  try {
    reset();
    assert.match(await render({ club: cac, role: 'admin', isSupport: false }), /CONTENU/);
    assert.equal(reads(), 0);
    reset();
    assert.match(await render({ club: self, role: 'manager', isSupport: false }), /CONTENU/);
    assert.equal(reads(), 0);
    reset();
    assert.match(await render({ club: self, role: 'admin', isSupport: true }), /CONTENU/);
    assert.equal(reads(), 0);
    reset();
    assert.match(await render({ club: self, role: 'admin', isSupport: false }), /PREMIERS PAS/);
    reset({ onboarding: { completed_steps: [], postponed_at: '2026-11-04' } });
    assert.match(await render({ club: self, role: 'admin', isSupport: false }), /CONTENU/);
    reset({ onboarding: { completed_steps: ['actu'], finished_at: '2026-11-04' } });
    assert.match(await render({ club: self, role: 'admin', isSupport: false }), /CONTENU/);
  } finally { supabase.from = from; context = { club: self, role: 'admin', isSupport: false }; }
});

test('the page refuses an internal club and a finished or postponed course', async () => {
  reset(); context = { club: cac, role: 'admin', isSupport: false };
  let unmount = await mount(page()); assert.equal(where(), '/'); await unmount();
  context = { club: self, role: 'admin', isSupport: false };
  reset({ onboarding: { completed_steps: [], postponed_at: '2026-11-04' } });
  unmount = await mount(page()); assert.equal(where(), '/'); await unmount();
});

test('adding a step is one entry: breadcrumb, counter, progress and resume follow the list', async () => {
  const Flow = load('src/components/firstSteps/FirstStepsFlow.tsx').default;
  const { FIRST_STEPS } = load('src/components/firstSteps/steps.ts');
  const { parseClubConfig } = load('src/lib/clubConfig.ts');
  assert.deepEqual(FIRST_STEPS.map(s => s.id), ['actu', 'fin']);
  const stub = (id) => ({ id, label: id === 'equipes' ? 'Vos équipes' : 'Vos affiches', isDone: (st) => st.completed_steps.includes(id),
    Component: ({ next, eyebrow }) => h("h2", { tabIndex: -1 }, `${eyebrow} ECRAN ${id} → ${next?.label}`), Preview: () => h('p', null, `APERCU ${id}`) });
  const steps = [FIRST_STEPS[0], stub('equipes'), stub('affiches'), FIRST_STEPS[1]];
  reset();
  const config = parseClubConfig({ ...db.club_settings[0].config, onboarding: { completed_steps: ['actu'] } });
  let unmount = await mount(h(Flow, { club: self, config, steps }));
  assert.match(text(), /Étape 2 sur 3/);
  assert.match(text(), /ECRAN equipes → vos affiches/);
  assert.match(text(), /APERCU equipes/);
  assert.equal(document.querySelector('[aria-current="step"]').textContent, 'Vos équipes');
  assert.equal([...document.querySelectorAll('nav li')].length, 4);
  assert.equal(document.querySelector('.fs-bar div').style.width, '33%');
  assert.ok(buttonNamed('✓Première actu'), 'past step clickable');
  assert.ok(!buttonNamed('Vos affiches'), 'next step is not');
  await unmount();
  // Le cadre ne nomme aucune étape.
  assert.doesNotMatch(readFileSync(resolve(base, 'src/components/firstSteps/FirstStepsFlow.tsx'), 'utf8'), /'actu'|'fin'|'equipes'/);
});

test('one click publishes the prefilled actu through the shared path, with the club photo copied into the actu bucket', async () => {
  reset(); heroResponse();
  const unmount = await mount(page());
  assert.match(text(), /Étape 1 sur 1/);
  assert.match(text(), /Essai · 30 jours restants/);
  assert.match(text(), /Aucune actualité/);
  assert.equal(document.querySelector('input.fs-input').value, 'Le club a sa nouvelle app !');
  assert.doesNotMatch(text(), /Passer à la saison/);
  await click('Publier l’actu');
  const [actu] = db.actus;
  assert.equal(actu.club_id, 'c1');
  assert.equal(actu.titre, 'Le club a sa nouvelle app !');
  assert.equal(actu.published, true);
  assert.ok(actu.published_at);
  assert.match(actu.contenu, /toute la vie du club/);
  const upload = log.find(l => l[0] === 'upload');
  assert.equal(upload[1], 'actu-images');
  assert.ok(upload[2].startsWith(`c1/${actu.id}/`));
  assert.equal(upload[3], 'image/webp');
  assert.equal(actu.image_urls.length, 1);
  assert.match(actu.image_urls[0], /actu-images\/c1\//);
  assert.deepEqual(log.find(l => l[0] === 'rpc'), ['rpc', 'content_push_announce', { p_club: 'c1', p_kind: 'actu', p_id: actu.id }]);
  assert.match(text(), /Votre première actu est en ligne/);
  assert.match(text(), /sera sur le site quand vous le publierez/);
  assert.match(text(), /Le club a sa nouvelle app !/, 'phone shows the actu');
  assert.deepEqual(db.club_settings[0].config.onboarding.completed_steps, ['actu']);
  assert.equal(db.club_settings[0].config.brand.name, 'TC Alpha', 'other config keys kept');
  assert.equal(document.activeElement.tagName, 'H2');
  await click('Suivant : c’est prêt →');
  assert.match(text(), /Votre app est prête/);
  await unmount();
  // ActuForm n'a plus son propre chemin d'écriture.
  const form = readFileSync(resolve(base, 'src/components/ActuForm.tsx'), 'utf8');
  assert.match(form, /saveActu\(/);
  assert.doesNotMatch(form, /\.insert\(|\.upload\(|content_push_announce/);
});

test('default image: club photo unreachable falls back on its URL, no club photo means no image', async () => {
  const { clubPhotoForActu } = load('src/lib/actuWrites.ts');
  globalThis.fetch = async () => new Response('', { status: 404 });
  assert.deepEqual((await clubPhotoForActu(HERO)).keptImages.map(i => i.url), [HERO]);
  globalThis.fetch = async () => { throw new Error('network'); };
  assert.deepEqual((await clubPhotoForActu(HERO)).newImages, []);
  reset({ home: {} });
  globalThis.fetch = async () => { throw new Error('must not fetch'); };
  const unmount = await mount(page());
  assert.match(text(), /Photo facultative/);
  await click('Publier l’actu');
  assert.deepEqual(db.actus[0].image_urls, []);
  assert.equal(log.filter(l => l[0] === 'upload').length, 0);
  await unmount();
});

test('a retry after a failure does not publish a second actu', async () => {
  reset(); heroResponse(); failUpload = true;
  const unmount = await mount(page());
  await click('Publier l’actu');
  assert.match(text(), /La publication n’a pas abouti/);
  assert.equal(db.actus.length, 1);
  failUpload = false; refuseConfig = true;
  await click('Publier l’actu');
  assert.match(text(), /Votre actu est publiée, mais/);
  assert.equal(db.actus.length, 1);
  const uploads = log.filter(l => l[0] === 'upload').length;
  refuseConfig = false;
  await click('Publier l’actu');
  assert.match(text(), /Votre première actu est en ligne/);
  assert.equal(db.actus.length, 1);
  assert.equal(log.filter(l => l[0] === 'upload').length, uploads, 'not uploaded again');
  await unmount();
});

test('reload resumes at the right step; final screen: real QR code, copy, dashboard ends the course', async () => {
  reset({ onboarding: { completed_steps: ['actu'] } });
  db.actus.push({ id: 'a1', club_id: 'c1', published: true, titre: 'Déjà publiée', contenu: 'x', image_urls: [], image_focal_points: [], published_at: '2026-11-04T10:00:00Z' });
  const unmount = await mount(page());
  assert.match(text(), /Votre app est prête/);
  assert.match(text(), /Première actu publiée/);
  assert.match(text(), /Déjà publiée/);
  assert.match(text(), /app-tc-alpha\.feelike\.pro/);
  const qr = document.querySelector('svg[role="img"]');
  assert.ok(qr.querySelector('path').getAttribute('d').length > 1000);
  assert.equal(document.querySelector('.fs-bar div').style.width, '100%');
  await click('Copier le lien');
  assert.equal(clipboard, 'https://app-tc-alpha.feelike.pro');
  assert.match(text(), /Lien copié/);
  for (const [label, href] of [['Le live score', '/live-score'], ['La gestion des cours', '/courses'], ['La feuille de match en photo', '/team-matches']]) {
    const card = [...document.querySelectorAll('article')].find(a => a.textContent.includes(label));
    assert.equal(card.querySelector('a').getAttribute('href'), href, label);
  }
  assert.equal([...document.querySelectorAll('article')].find(a => a.textContent.includes('Et plus encore')).querySelector('a'), null);
  assert.doesNotMatch(text(), /Passer à la saison/);
  assert.doesNotMatch(text(), /Je finirai plus tard/);
  await click('Aller au tableau de bord');
  assert.equal(where(), '/');
  assert.ok(db.club_settings[0].config.onboarding.finished_at);
  await unmount();
});

test('« Je finirai plus tard » records it and goes to the dashboard; a refusal keeps the page with a message', async () => {
  reset();
  let unmount = await mount(page());
  refuseConfig = true;
  await click('Je finirai plus tard');
  assert.equal(where(), '/premiers-pas');
  assert.match(text(), /seul un administrateur/);
  refuseConfig = false;
  await click('Je finirai plus tard');
  assert.equal(where(), '/');
  assert.ok(db.club_settings[0].config.onboarding.postponed_at);
  assert.equal(db.actus.length, 0);
  await unmount();
});

test('site config keeps the onboarding key when it saves a group', async () => {
  reset({ onboarding: { completed_steps: ['actu'] } });
  const { updateClubConfigKey } = load('src/lib/clubConfigWrite.ts');
  const { success } = await updateClubConfigKey('c1', 'contact', () => ({ phone: '01' }));
  assert.equal(success, true);
  assert.deepEqual(db.club_settings[0].config.onboarding, { completed_steps: ['actu'] });
  assert.deepEqual(db.club_settings[0].config.contact, { phone: '01' });
});
