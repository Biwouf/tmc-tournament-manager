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
  db = { club_settings: [{ club_id: 'c1', config: { brand: { name: 'TC Alpha', color: '#1d3f8f' }, home: { hero_image: HERO }, ...config } }], actus: [],
    team_saisons: [], team_competitions: [], team_equipes: [], team_etapes: [], team_rencontres: [] };
  log = []; failUpload = false; refuseConfig = false; clipboard = null; tenup = {}; poster = {};
}
// S7 : le dessin du fond (canvas) et l'export JPEG (html-to-image) n'existent pas sous jsdom.
let poster = {};
const JPEG = 'data:image/jpeg;base64,' + Buffer.from('jpeg-affiche').toString('base64');
// Ten'Up simulé (Edge `tenup-sync`) et création d'équipe (`team_equipe_create`).
let tenup = {};
const POOL_URL = 'https://tenup.fft.fr/championnat/82145789?division=4&phase=1&poule=2';
const MATCH = (n) => `https://tenup.fft.fr/championnat/82145789/division/4/phase/1/poule/2/rencontre/${n}`;
const future = (days) => new Date(Date.now() + days * 86_400_000).toISOString().slice(0, 10);
const POOL = () => ({
  division: 'Division 2', phase: 'Phase 1', poule: 'Poule B',
  teams: [{ id: '11', name: 'TC ALPHA 1' }, { id: '12', name: 'US BETA 1' }, { id: '13', name: 'AS GAMMA 1' }, { id: '14', name: 'RC DELTA 1' }],
  rounds: [
    { numero: 1, matches: [{ url: MATCH(1), home_id: '11', away_id: '12', date: future(8) }, { url: MATCH(2), home_id: '13', away_id: '14', date: future(8) }] },
    { numero: 2, matches: [{ url: MATCH(3), home_id: '13', away_id: '11', date: future(15) }, { url: MATCH(4), home_id: '12', away_id: '14', date: future(15) }] },
  ],
});
function createTeam(args) {
  const pool = POOL();
  const team = pool.teams.find(t => t.id === args.p_team_id);
  const equipe = { id: `e${db.team_equipes.length + 1}`, club_id: 'c1', competition_id: args.p_competition, numero: args.p_numero, division: args.p_division, tenup_team_id: team.id, tenup_team_name: team.name, created_at: '' };
  db.team_equipes.push(equipe);
  pool.rounds.forEach(round => {
    const etape = { id: `${equipe.id}-j${round.numero}`, club_id: 'c1', equipe_id: equipe.id, phase: 'poule', numero_journee: round.numero };
    db.team_etapes.push(etape);
    const m = round.matches.find(x => x.home_id === team.id || x.away_id === team.id);
    const home = m.home_id === team.id;
    db.team_rencontres.push({ id: `${etape.id}-r`, club_id: 'c1', etape_id: etape.id, date_heure: `${m.date}T08:00:00Z`, domicile: home, wo: false,
      club_adverse: pool.teams.find(t => t.id === (home ? m.away_id : m.home_id)).name });
  });
  return equipe.id;
}
const supabase = {
  auth: {
    getSession: async () => ({ data: { session: { user: { id: 'u1' } } } }),
    onAuthStateChange: () => ({ data: { subscription: { unsubscribe() {} } } }),
  },
  async rpc(name, args) {
    log.push(['rpc', name, args]);
    if (name === 'team_equipe_create') return tenup.create ? tenup.create(args) : { data: createTeam(args), error: null };
    return { data: 0, error: null };
  },
  functions: { async invoke(name, { body }) {
    log.push(['tenup', body.kind]);
    if (tenup.refuse) return { data: null, error: { context: new Response(JSON.stringify({ error: tenup.refuse }), { status: 400 }) } };
    if (body.kind === 'club') return { data: tenup.club, error: null };
    if (body.kind === 'competition') return { data: { url: body.url, nom: tenup.nom ?? 'Championnat Seniors Messieurs', format: tenup.format === undefined ? '3S1D2' : tenup.format, singles_set3_format: 'super_tiebreak', warnings: [] }, error: null };
    const pool = POOL();
    if (tenup.teams) pool.teams = pool.teams.map((t, i) => ({ ...t, name: tenup.teams[i] ?? t.name }));
    return { data: { id: `p${log.length}`, url: body.url, ...pool }, error: null };
  } },
  storage: { from: (bucket) => ({
    async upload(path, file) { log.push(['upload', bucket, path, file.type]); return { error: failUpload ? new Error('upload') : null }; },
    getPublicUrl: (path) => ({ data: { publicUrl: `https://x.supabase.co/storage/v1/object/public/${bucket}/${path}` } }),
    async remove(paths) { log.push(['remove', bucket, paths]); return { error: null }; },
  }) },
  from(table) {
    let filters = [], write = null, single = false, columns = '';
    const rows = () => (db[table] || []).filter(row => filters.every(f => f(row)));
    // `useTeamSeasonGrid` lit compétitions → équipes → journées → rencontres en une requête imbriquée.
    const nested = (comp) => ({ ...comp, team_equipes: db.team_equipes.filter(e => e.competition_id === comp.id).map(e => ({ ...e,
      team_etapes: db.team_etapes.filter(et => et.equipe_id === e.id).map(et => ({ ...et, team_rencontres: db.team_rencontres.filter(r => r.etape_id === et.id) })) })) });
    const q = {
      select(cols = '') { columns = cols; return q; }, order() { return q; }, limit() { return q; },
      eq(key, value) { filters.push(row => row[key] === value); return q; },
      in(key, values) { filters.push(row => values.includes(row[key])); return q; },
      maybeSingle() { single = true; return q; }, single() { single = true; return q; },
      insert(payload) { log.push(['insert', table, payload]); write = () => { const row = { id: `a${db[table].length + 1}`, ...payload }; db[table].push(row); return [row]; }; return q; },
      update(payload) { log.push(['update', table, payload]); write = () => { if (table === 'club_settings' && refuseConfig) return []; const found = rows(); found.forEach(row => Object.assign(row, payload)); return found; }; return q; },
      then(resolve) {
        const data = write ? write() : columns.includes('team_equipes(') ? rows().map(nested) : rows();
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
    // S7b : la story vidéo (polices, encodeur, worker) n'existe pas sous jsdom ; le bouton est testé.
    if (file.endsWith('/rencontresAnimation/useRencontresVideo.ts')) return { useRencontresVideo: (input) => ({ encoderOk: true, canExport: true, exporting: false, progress: null, exportError: '', cancel() {}, download: async (name) => { log.push(['video', name, input.matches.length]); } }) };
    if (file.endsWith('/contexts/ClubRoleContext.tsx')) return { useClubRole: () => ({ role: context.role, isMember: true, isSuperAdmin: false, loading: false }) };
    if (cache.has(file)) return cache.get(file).exports;
    const mod = { exports: {} }; cache.set(file, mod);
    const code = ts.transpileModule(readFileSync(file, 'utf8'), { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX, esModuleInterop: true } }).outputText;
    const require = (name) => {
      if (name.endsWith('.css') || name.startsWith('@fontsource')) return {};
      if (name === 'html-to-image') return { toJpeg: async () => { log.push(['jpeg']); return JPEG; } };
      if (!name.startsWith('.')) return req(name);
      const p = resolve(dirname(file), name);
      return read([p, `${p}.ts`, `${p}.tsx`].find(existsSync));
    };
    vm.runInThisContext(`(function(require,module,exports){${code}\n})`, { filename: file })(require, mod, mod.exports);
    if (file.endsWith('/lib/clubPosterBackground.ts')) {
      mod.exports.renderClubPosterBackground = async (brand) => {
        log.push(['render', brand]);
        await poster.duringRender?.();
        if (poster.failRender) throw new Error('canvas');
        return new Blob(['png'], { type: 'image/png' });
      };
    }
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
  assert.deepEqual(FIRST_STEPS.map(s => s.id), ['actu', 'equipes', 'affiches', 'fin']);
  const stub = (id) => ({ id, label: id === 'equipes' ? 'Vos équipes' : 'Vos affiches', isDone: (st) => st.completed_steps.includes(id),
    Component: ({ next, eyebrow }) => h("h2", { tabIndex: -1 }, `${eyebrow} ECRAN ${id} → ${next?.label}`), Preview: () => h('p', null, `APERCU ${id}`) });
  const steps = [FIRST_STEPS[0], stub('equipes'), stub('affiches'), FIRST_STEPS.at(-1)];
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
  assert.match(text(), /Étape 1 sur 3/);
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
  await click('Suivant : vos équipes →');
  assert.match(text(), /Étape 2 sur 3 · 1 minute par équipe/);
  assert.match(text(), /Vos équipes, sans rien ressaisir/);
  assert.match(text(), /Vos rencontres arrivent ici/);
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
  reset({ onboarding: { completed_steps: ['actu', 'equipes', 'affiches'] } });
  db.actus.push({ id: 'a1', club_id: 'c1', published: true, titre: 'Déjà publiée', contenu: 'x', image_urls: [], image_focal_points: [], published_at: '2026-11-04T10:00:00Z' });
  const unmount = await mount(page());
  assert.match(text(), /Votre app est prête/);
  assert.match(text(), /Première actu publiée/);
  assert.match(text(), /Vos équipes et leur calendrier/);
  assert.match(text(), /Affiche du week-end prête/);
  // « À découvrir » prend la place du téléphone, pour être vu sans défiler (14/11/2026).
  assert.ok(document.querySelector('.fs-layout > .fs-discover'), 'discover cards beside the step');
  assert.ok(!document.querySelector('.fs-stage'), 'no phone preview on the final screen');
  assert.doesNotMatch(text(), /Déjà publiée/);
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

// --- S6 : étape « Vos équipes » ---
function setValue(el, value) {
  const proto = el.tagName === 'SELECT' ? dom.window.HTMLSelectElement.prototype : dom.window.HTMLInputElement.prototype;
  Object.getOwnPropertyDescriptor(proto, 'value').set.call(el, value);
  el.dispatchEvent(new dom.window.Event(el.tagName === 'SELECT' ? 'change' : 'input', { bubbles: true }));
}
async function paste(value) { await act(async () => setValue(document.getElementById('fs-pool-url'), value)); await flush(); }
const isDisabled = (name) => buttonNamed(name)?.disabled;
const season = () => { const d = new Date(); const y = d.getMonth() >= 8 ? d.getFullYear() : d.getFullYear() - 1; return `${y}/${y + 1}`; };
const atTeams = () => reset({ onboarding: { completed_steps: ['actu'] } });

test('one pool link: season, competition, team and encounters created; the phone shows them; Suivant completes the step', async () => {
  atTeams();
  const unmount = await mount(page());
  assert.match(text(), /Étape 2 sur 3 · 1 minute par équipe/);
  assert.match(text(), /Vos rencontres arrivent ici/);
  assert.equal(isDisabled('Suivant : vos affiches →'), true, 'no team yet');
  await paste('https://tenup.fft.fr/championnat/82145789');
  assert.match(text(), /Copiez le lien Ten’Up de la poule/, 'instant validation');
  assert.equal(isDisabled('Lire la poule'), true);
  await paste(POOL_URL);
  await click('Lire la poule');
  const status = document.querySelector('.fs-progress[role="status"]');
  assert.equal(status.getAttribute('aria-live'), 'polite');
  assert.equal(status.querySelectorAll('.fs-mark.ok').length, 3);
  assert.match(text(), /TC ALPHA 1/);
  assert.match(text(), /Championnat Seniors Messieurs · Division 2 · 2 rencontres/);
  assert.deepEqual(db.team_saisons.map(s => [s.label, s.actif]), [[season(), true]]);
  assert.equal(db.team_competitions.length, 1);
  const [comp] = db.team_competitions;
  assert.deepEqual([comp.type, comp.genre, comp.categorie, comp.format, comp.singles_set3_format, comp.tenup_url], ['adultes', 'hommes', 'Seniors', '3S1D2', 'super_tiebreak', POOL_URL]);
  assert.equal(db.team_equipes.length, 0, 'nothing before « Ajouter l’équipe »');
  await click('Ajouter l’équipe');
  await flush();
  assert.equal(db.team_equipes.length, 1);
  assert.deepEqual(log.filter(l => l[0] === 'tenup').map(l => l[1]), ['competition', 'pool']);
  assert.match(text(), /TC ALPHA 1Hommes Seniors · Division 2 · 2 rencontres/);
  assert.match(text(), /vs US BETA 1/, 'phone shows the real encounters');
  assert.match(text(), /vs AS GAMMA 1/);
  assert.match(text(), /Une équipe manque \? Ajoutez-la avec le lien de sa poule/);
  assert.equal(document.getElementById('fs-pool-url').value, '');
  assert.ok(!buttonNamed('Passer cette étape'), 'skipping is offered only before the first team');
  assert.match(text(), /Votre équipe est prête\./);
  assert.ok(!text().includes('C’est bon pour l’instant'));
  await click('Suivant : vos affiches →');
  assert.deepEqual(db.club_settings[0].config.onboarding.completed_steps, ['actu', 'equipes']);
  assert.match(text(), /Annoncez le week-end comme un tournoi/);
  assert.match(text(), /Étape 3 sur 3/);
  await unmount();
});

test('the same pool twice: the team is shown as already present, the competition is reused without a read', async () => {
  atTeams();
  const unmount = await mount(page());
  await paste(POOL_URL); await click('Lire la poule'); await click('Ajouter l’équipe');
  log.length = 0;
  await paste(POOL_URL); await click('Lire la poule');
  assert.match(text(), /« TC ALPHA 1 » est déjà dans vos équipes/);
  assert.deepEqual(log.filter(l => l[0] === 'tenup').map(l => l[1]), ['pool'], 'competition found, not read again');
  assert.equal(db.team_competitions.length, 1);
  assert.equal(db.team_saisons.length, 1);
  assert.equal(db.team_equipes.length, 1);
  await unmount();
});

test('team not recognised: the founder picks it in the pool list', async () => {
  atTeams(); tenup.teams = ['TENNIS CLUB DU LAC 1'];
  const unmount = await mount(page());
  await paste(POOL_URL); await click('Lire la poule');
  assert.match(text(), /Quelle est votre équipe dans cette poule \?/);
  assert.match(text(), /Votre équipe : à choisir ci-dessous/);
  assert.equal(document.querySelectorAll('.fs-progress .fs-mark.ok').length, 2, 'not ticked as recognised');
  assert.equal(document.querySelectorAll('input[name="fs-team"]').length, 4);
  assert.equal(isDisabled('Ajouter l’équipe'), true);
  await act(async () => document.querySelector('input[value="11"]').click()); await flush();
  assert.match(text(), /2 rencontres/);
  await click('Ajouter l’équipe');
  assert.equal(db.team_equipes[0].tenup_team_id, '11');
  await unmount();
});

test('genre or format not deduced: asked inline, nothing created without it', async () => {
  atTeams(); tenup.nom = 'Pyrénées Interclubs'; tenup.format = null;
  const unmount = await mount(page());
  await paste(POOL_URL); await click('Lire la poule');
  assert.match(text(), /TEN’UP ne précise pas tout pour « Pyrénées Interclubs »/);
  assert.ok(buttonNamed('Hommes') && buttonNamed('Femmes') && buttonNamed('Mixte'), 'adult genres');
  assert.ok(!buttonNamed('Set classique'), 'third set known: not asked');
  assert.equal(db.team_competitions.length, 0);
  assert.deepEqual(log.filter(l => l[0] === 'tenup').map(l => l[1]), ['competition'], 'pool not read yet');
  assert.equal(isDisabled('Continuer'), true);
  await click('Femmes');
  assert.equal(buttonNamed('Femmes').getAttribute('aria-pressed'), 'true');
  assert.equal(isDisabled('Continuer'), true, 'format still missing');
  await act(async () => setValue(document.querySelector('select.fs-input'), '4S1D2')); await flush();
  await click('Continuer');
  assert.deepEqual([db.team_competitions[0].genre, db.team_competitions[0].format], ['femmes', '4S1D2']);
  assert.match(text(), /TC ALPHA 1/);
  await unmount();
});

test('quota, trial cap or expired preview: a human message, the link is kept', async () => {
  atTeams(); tenup.refuse = 'Limite de l’essai atteinte : 20 lectures Ten’Up par 24 heures. Réessayez demain, ou ajoutez vos autres équipes plus tard depuis Matches par équipe.';
  let unmount = await mount(page());
  await paste(POOL_URL); await click('Lire la poule');
  assert.match(document.querySelector('[role="alert"]').textContent, /Limite de l’essai atteinte/);
  assert.equal(document.getElementById('fs-pool-url').value, POOL_URL);
  await unmount();
  atTeams(); tenup.create = () => ({ data: null, error: { message: 'Aperçu expiré ou incomplet. Relancez la lecture Ten’Up.' } });
  unmount = await mount(page());
  await paste(POOL_URL); await click('Lire la poule'); await click('Ajouter l’équipe');
  assert.match(text(), /Aperçu expiré/);
  assert.equal(document.getElementById('fs-pool-url').value, POOL_URL);
  tenup.create = undefined; log.length = 0;
  await click('Relire la poule');
  assert.deepEqual(log.filter(l => l[0] === 'tenup').map(l => l[1]), ['pool'], 'only the pool is read again');
  await click('Ajouter l’équipe');
  assert.equal(db.team_equipes.length, 1);
  await unmount();
});

test('« Passer cette étape » records it as postponed, not done: resume skips it, the recap does not count it', async () => {
  atTeams();
  let unmount = await mount(page());
  await click('Passer cette étape');
  assert.deepEqual(db.club_settings[0].config.onboarding.skipped_steps, ['equipes']);
  assert.deepEqual(db.club_settings[0].config.onboarding.completed_steps, ['actu']);
  assert.match(text(), /Annoncez le week-end comme un tournoi/);
  assert.match(text(), /Ajoutez d’abord une équipe/);
  await unmount();
  unmount = await mount(page());
  assert.match(text(), /Annoncez le week-end comme un tournoi/, 'reload does not bring the skipped step back');
  // Revenue par le fil d'Ariane, une équipe ajoutée la termine et retire le report.
  await click('✓Vos équipes');
  await paste(POOL_URL); await click('Lire la poule'); await click('Ajouter l’équipe');
  await click('Suivant : vos affiches →');
  assert.deepEqual(db.club_settings[0].config.onboarding.skipped_steps, []);
  assert.deepEqual(db.club_settings[0].config.onboarding.completed_steps, ['actu', 'equipes']);
  await unmount();
  const { currentStepIndex } = load('src/lib/firstSteps.ts');
  const steps = [{ id: 'a', isDone: s => s.completed_steps.includes('a') }, { id: 'b', isDone: () => false }, { id: 'fin', isDone: () => false, final: true }];
  assert.equal(currentStepIndex(steps, { completed_steps: ['a'], skipped_steps: [] }), 1);
  assert.equal(currentStepIndex(steps, { completed_steps: ['a'], skipped_steps: ['b'] }), 2);
});

test('club link: every team listed by championship, all ticked; import creates them, a miss is reported with a retry', async () => {
  atTeams(); tenup.nom = 'Pyrénées Interclubs';
  const team = (name, dates) => ({ pool_url: POOL_URL, competition: 'Pyrénées Interclubs', team: name, level: 'Départemental', category: 'Senior', genre: 'Homme', dates });
  tenup.club = { club: 'TC ALPHA', skipped: 0, teams: [team('TC ALPHA 1', ['dimanche 15 novembre 2026', 'dimanche 22 novembre 2026']), team('TC ALPHA 3', ['dimanche 29 novembre 2026'])] };
  const unmount = await mount(page());
  assert.match(text(), /Collez le lien des rencontres de votre club sur TEN’UP/);
  const club = document.getElementById('fs-club-url');
  await act(async () => setValue(club, 'https://tenup.fft.fr/championnat/82145789')); await flush();
  assert.match(text(), /Copiez le lien Ten’Up de votre club/);
  await act(async () => setValue(club, 'https://tenup.fft.fr/club/60820056')); await flush();
  await click('Trouver mes équipes');
  assert.match(text(), /2 équipes trouvées sur TEN’UP/);
  assert.match(text(), /Pyrénées InterclubsTC ALPHA 1Homme · Départemental · 2 rencontres à venir/);
  const boxes = [...document.querySelectorAll('input[type="checkbox"]')];
  assert.equal(boxes.length, 2);
  assert.ok(boxes.every((b) => b.checked && !b.disabled));
  assert.equal(db.team_saisons.length, 1, 'season ready');
  assert.equal(db.team_competitions.length, 0, 'nothing created before « Importer »');
  await act(async () => boxes[1].click()); await flush();
  assert.ok(buttonNamed('Importer 1 équipe'));
  await act(async () => boxes[1].click()); await flush();
  await click('Importer 2 équipes');
  for (let i = 0; i < 10; i++) await flush();
  assert.deepEqual(log.filter(l => l[0] === 'tenup').map(l => l[1]), ['club', 'competition', 'pool', 'pool']);
  assert.equal(db.team_competitions[0].genre, 'hommes', 'gender from the « Homme » badge');
  assert.equal(db.team_equipes.length, 1);
  assert.match(text(), /TC ALPHA 1Hommes Seniors · Division 2 · 2 rencontres/, 'created team in the step list');
  assert.doesNotMatch(text(), /TC ALPHA 1 · Pyrénées Interclubs/, 'only failures stay in the import list');
  assert.match(text(), /TC ALPHA 3 · Pyrénées InterclubsÉquipe introuvable dans la poule/);
  assert.match(text(), /1 équipe importée\. 1 équipe en échec\./);
  assert.match(text(), /Les résultats des rencontres déjà jouées ne sont pas repris ici/);
  assert.equal([...document.querySelectorAll('a')].find((a) => a.textContent === 'Matches par équipe').getAttribute('href'), '/team-matches');
  assert.equal(document.querySelector('.fs-progress[aria-label="Import des équipes"]').getAttribute('aria-live'), 'polite');
  assert.match(text(), /vs US BETA 1/, 'phone shows the imported encounters');
  await click('Réessayer les équipes en échec');
  const again = [...document.querySelectorAll('input[type="checkbox"]')];
  assert.deepEqual(again.map((b) => [b.checked, b.disabled]), [[true, true], [true, false]]);
  assert.match(text(), /TC ALPHA 1 · déjà ajoutée/);
  assert.ok(buttonNamed('Importer 1 équipe'), 'only the failed team is ticked');
  await unmount();
});

test('club page without upcoming encounter: the pool link stays available', async () => {
  atTeams(); tenup.club = { club: 'TC ALPHA', skipped: 0, teams: [] };
  const unmount = await mount(page());
  await act(async () => setValue(document.getElementById('fs-club-url'), 'https://tenup.fft.fr/club/60820056/competitions/rencontres')); await flush();
  await click('Trouver mes équipes');
  assert.match(text(), /Aucune rencontre à venir sur la page du club/);
  assert.ok(document.getElementById('fs-pool-url'));
  await unmount();
});

// --- S7 : étape « Vos affiches » et fond aux couleurs du club ---
const atPosters = () => reset({ onboarding: { completed_steps: ['actu', 'equipes'] } });
const soon = () => new Date(Date.now() + 60_000).toISOString();
/** Une équipe dans la saison active : une rencontre imminente au club, une la semaine suivante. */
function withTeam({ upcoming = true } = {}) {
  db.team_saisons.push({ id: 's1', club_id: 'c1', label: season(), actif: true, created_at: '2026-09-01' });
  db.team_competitions.push({ id: 'k1', club_id: 'c1', saison_id: 's1', nom: 'Championnat Seniors Messieurs', type: 'adultes', genre: 'hommes', categorie: 'Seniors', terminee: false, created_at: '' });
  db.team_equipes.push({ id: 'e1', club_id: 'c1', competition_id: 'k1', numero: 1, division: 'D2', nb_journees_poule: 2, created_at: '' });
  const dates = upcoming ? [soon(), new Date(Date.now() + 8 * 86_400_000).toISOString()] : ['2026-10-04T08:00:00Z', '2026-10-11T08:00:00Z'];
  [['US BETA 1', true], ['AS GAMMA 1', false]].forEach(([adv, home], i) => {
    db.team_etapes.push({ id: `j${i + 1}`, club_id: 'c1', equipe_id: 'e1', phase: 'poule', numero_journee: i + 1, stade_finale: null });
    db.team_rencontres.push({ id: `r${i + 1}`, club_id: 'c1', etape_id: `j${i + 1}`, date_heure: dates[i], domicile: home, wo: false, club_adverse: adv,
      score_club: upcoming ? null : 3, score_adverse: upcoming ? null : 1 });
  });
}
const settle = async () => { for (let i = 0; i < 6; i++) await flush(); };
const configUploads = () => log.filter(l => l[0] === 'upload' && l[1] === 'content-images');

test('posters: the club colours background is created once, the real poster is generated and downloaded', async () => {
  atPosters(); withTeam();
  let unmount = await mount(page());
  await settle();
  assert.match(text(), /Étape 3 sur 3 · 1 minute/);
  assert.match(text(), /Annoncez le week-end comme un tournoi/);
  // Fond « Aux couleurs du club » : un fond normal, rangé comme ceux de la configuration du site.
  const list = () => db.club_settings[0].config.posters.team_match_backgrounds;
  assert.equal(list().length, 1);
  const [bg] = list();
  assert.equal(bg.name, 'Aux couleurs du club');
  assert.equal(configUploads().length, 1);
  const [, , path, type] = configUploads()[0];
  assert.match(path, /^c1\/config\/\d+-team-match-backgrounds\.0\.image-aux-couleurs-du-club\.png$/, 'same folder as « Configuration du site › Affiches »');
  assert.equal(type, 'image/png');
  assert.equal(bg.image, `https://x.supabase.co/storage/v1/object/public/content-images/${path}`);
  assert.deepEqual(log.find(l => l[0] === 'render')[1], { name: 'TC Alpha', color: '#1d3f8f', logo: null });
  assert.equal(db.club_settings[0].config.brand.name, 'TC Alpha', 'other config keys kept');
  // Sélection de PosterPanel : la semaine courante présélectionnée, la suivante proposée.
  assert.match(text(), /1 \/ 8 sélectionnées/);
  assert.match(text(), /Hommes Seniors 1 · vs US BETA 1/);
  assert.match(text(), /Hommes Seniors 1 · vs AS GAMMA 1/);
  assert.match(text(), /Semaine suivante/);
  assert.deepEqual([...document.querySelectorAll('.fs-choice input')].map(b => b.checked), [true, false]);
  assert.equal(buttonNamed('Couleurs du club').getAttribute('aria-pressed'), 'true');
  assert.ok(!document.body.textContent.includes('Votre propre fond'), 'decision 2: no own background here');
  // Aperçu : la vraie affiche, sur le fond créé.
  assert.ok(document.querySelector('.fs-poster .tmc-poster'), 'poster in the preview');
  assert.equal(document.querySelector('.fs-poster img').getAttribute('src'), bg.image);
  assert.equal(document.querySelectorAll('.fs-poster .va-cell').length, 1);
  await act(async () => document.querySelectorAll('.fs-choice input')[1].click()); await flush();
  assert.match(text(), /2 \/ 8 sélectionnées/);
  assert.equal(document.querySelectorAll('.fs-poster .va-cell').length, 2);
  await click('Générer l’affiche');
  assert.deepEqual(db.club_settings[0].config.onboarding.completed_steps, ['actu', 'equipes', 'affiches'], 'done once generated');
  assert.match(text(), /Étape terminée/);
  assert.match(text(), /Votre affiche est prête/);
  const download = [...document.querySelectorAll('a')].find(a => a.textContent === 'Télécharger');
  assert.equal(download.getAttribute('href'), JPEG);
  assert.match(download.getAttribute('download'), /^affiche-rencontres-\d{4}-\d{2}-\d{2}\.jpg$/);
  // S7b : la story vidéo de /medias, à côté, dans la même barre d'actions collée en bas.
  assert.ok(download.closest('.fs-sticky'), 'download stays on screen');
  await click('Télécharger la vidéo (story)');
  assert.deepEqual(log.filter(l => l[0] === 'video').map(l => l.slice(1)).map(([n, c]) => [/^story-rencontres-\d{4}-\d{2}-\d{2}$/.test(n), c]), [[true, 2]]);
  assert.ok(!buttonNamed('Publier en actu'), 'no actu from the first steps');
  assert.equal(db.actus.length, 0);
  // Une nouvelle coche invalide l'affiche générée.
  await act(async () => document.querySelectorAll('.fs-choice input')[1].click()); await flush();
  assert.ok(![...document.querySelectorAll('a')].some(a => a.textContent === 'Télécharger'), 'stale poster dropped');
  await click('Générer l’affiche');
  await click('Terminer →');
  assert.match(text(), /Votre app est prête/);
  assert.match(text(), /Affiche du week-end prête/);
  await unmount();
  // Recharger puis revenir à l'étape : aucun second fond.
  unmount = await mount(page());
  await click('✓Vos affiches');
  await settle();
  assert.equal(list().length, 1);
  assert.equal(configUploads().length, 1);
  assert.equal(log.filter(l => l[0] === 'render').length, 1);
  assert.match(text(), /Étape terminée/);
  await unmount();
});

test('default background: created once even when asked twice, never over an existing list, never for an internal club; a background added meanwhile wins', async () => {
  const { ensureClubPosterBackground: ensure } = load('src/lib/defaultPosterBackground.ts');
  const brand = { name: 'TC Alpha', color: '#1d3f8f', logo: null };
  const renders = () => log.filter(l => l[0] === 'render').length;
  reset();
  const [a, b] = await Promise.all([ensure(self, brand), ensure(self, brand)]);
  assert.equal(renders(), 1);
  assert.equal(a, b);
  assert.equal(a.created, true);
  assert.deepEqual(db.club_settings[0].config.posters.team_match_backgrounds.map(x => x.name), ['Aux couleurs du club']);
  const again = await ensure(self, brand);
  assert.equal(again.created, false);
  assert.equal(renders(), 1);
  assert.equal(db.club_settings[0].config.posters.team_match_backgrounds.length, 1);

  const own = [{ name: 'Saison 2026-2027', image: 'https://x/own.png' }];
  reset({ posters: { team_match_backgrounds: own, tmc_backgrounds: [] } });
  assert.deepEqual(await ensure(self, brand), { backgrounds: own, created: false });
  assert.equal(renders(), 0);

  reset();
  const internal = await ensure({ ...self, plan: 'internal' }, brand);
  assert.equal(internal.created, false);
  assert.equal(renders(), 0);
  assert.equal(db.club_settings[0].config.posters, undefined, 'internal club untouched');
  assert.equal(log.filter(l => l[0] === 'update').length, 0);

  reset();
  const other = [{ name: 'Ajouté ailleurs', image: 'https://x/other.png' }];
  poster.duringRender = () => { db.club_settings[0].config.posters = { team_match_backgrounds: other }; };
  const raced = await ensure(self, brand);
  assert.equal(raced.created, false);
  assert.deepEqual(raced.backgrounds, other);
  assert.deepEqual(db.club_settings[0].config.posters.team_match_backgrounds, other);
  const [uploaded] = configUploads();
  assert.deepEqual(log.find(l => l[0] === 'remove'), ['remove', 'content-images', [uploaded[2]]], 'orphan removed');

  reset(); poster.failRender = true;
  await assert.rejects(ensure(self, brand));
  assert.equal(db.club_settings[0].config.posters, undefined);
});

test('posters without team or without upcoming encounter: a clear message and « Passer cette étape », recorded like S6', async () => {
  atPosters();
  let unmount = await mount(page());
  await settle();
  assert.match(text(), /Ajoutez d’abord une équipe/);
  assert.ok(!buttonNamed('Générer l’affiche'));
  await click('Ajouter une équipe');
  assert.match(text(), /Vos équipes, sans rien ressaisir/, 'link to the teams step');
  await unmount();
  unmount = await mount(page());
  await settle();
  await click('Passer cette étape');
  assert.deepEqual(db.club_settings[0].config.onboarding.skipped_steps, ['affiches']);
  assert.deepEqual(db.club_settings[0].config.onboarding.completed_steps, ['actu', 'equipes']);
  assert.match(text(), /Votre app est prête/);
  assert.match(text(), /Affiche du week-end à générer/);
  await unmount();
  unmount = await mount(page());
  assert.match(text(), /Votre app est prête/, 'reload does not bring the skipped step back');
  await unmount();

  atPosters(); withTeam({ upcoming: false });
  unmount = await mount(page());
  await settle();
  assert.match(text(), /Aucune rencontre à venir pour vos équipes/);
  assert.ok(buttonNamed('Passer cette étape'));
  assert.ok(!buttonNamed('Générer l’affiche'));
  await unmount();
});

test('a failed background shows a retry; the step cannot generate without a background', async () => {
  atPosters(); withTeam(); poster.failRender = true;
  const unmount = await mount(page());
  await settle();
  assert.match(text(), /Le fond aux couleurs du club n’a pas pu être préparé/);
  assert.equal(buttonNamed('Générer l’affiche').disabled, true);
  poster.failRender = false;
  await click('Réessayer');
  await settle();
  assert.equal(buttonNamed('Générer l’affiche').disabled, false);
  assert.equal(db.club_settings[0].config.posters.team_match_backgrounds.length, 1);
  await unmount();
});

test('poster selection is shared with PosterPanel: current week preselected, sorted, capped at 8', () => {
  const { initialPosterSelection, groupByWeek } = load('src/components/teamMatches/poster/posterSelection.ts');
  const now = new Date();
  const entry = (id, offsetMs) => ({ rencontre: { id, date_heure: new Date(now.getTime() + offsetMs).toISOString() } });
  const entries = Array.from({ length: 10 }, (_, i) => entry(`r${i}`, (10 - i) * 1000 + 60_000));
  entries.push(entry('later', 30 * 86_400_000));
  assert.deepEqual(initialPosterSelection(entries, now), ['r9', 'r8', 'r7', 'r6', 'r5', 'r4', 'r3', 'r2']);
  assert.deepEqual(groupByWeek(entries, now).map(g => g.key), ['courant', 'plus-tard']);
  const panel = readFileSync(resolve(base, 'src/components/teamMatches/poster/PosterPanel.tsx'), 'utf8');
  assert.match(panel, /usePosterSelection\(entries\)/);
  assert.doesNotMatch(panel, /function groupByWeek|toJpeg\(/, 'not copied');
});

// Contraste WCAG d'après les chaînes `hsl(h s% l%)` des tokens.
function hslLuminance(css) {
  const [h, s, l] = css.match(/[\d.]+/g).map(Number);
  const a = (s / 100) * Math.min(l / 100, 1 - l / 100);
  const f = (n) => { const k = (n + h / 30) % 12; return l / 100 - a * Math.max(-1, Math.min(k - 3, 9 - k, 1)); };
  const lin = (v) => (v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4);
  const [r, g, b] = [f(0), f(8), f(4)].map(lin);
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}
const contrast = (x, y) => { const [a, b] = [hslLuminance(x), hslLuminance(y)].sort((m, n) => n - m); return (a + 0.05) / (b + 0.05); };

test('background drawing: 1414 × 2000, club colour, readable header (≥ 4.5:1), text only in the header, not a flat colour, logo or initials', () => {
  const bgLib = load('src/lib/clubPosterBackground.ts');
  const { drawClubPosterBackground: draw, clubBackgroundPalette, clubInitials, BACKGROUND_W, BACKGROUND_H, BACKGROUND_HEADER_H } = bgLib;
  assert.deepEqual([BACKGROUND_W, BACKGROUND_H, BACKGROUND_HEADER_H], [1414, 2000, 245]);
  const spec = load('src/lib/clubConfigWrite.ts').CLUB_CONFIG_GROUPS.find(g => g.key === 'posters').items.find(i => i.key === 'team_match_backgrounds');
  assert.deepEqual(spec.fields.find(f => f.key === 'image').dimensions, { width: 1414, height: 2000 }, 'same template as the upload check');
  assert.equal(clubInitials('TC Saint-Aubin'), 'TSA');
  assert.equal(clubInitials('Association sportive de la Ville'), 'ASV');
  const inks = {};
  for (const color of ['#e8c547', '#3a9a5c', '#1d3f8f']) {
    for (const logo of [null, { width: 300, height: 200 }]) {
      const calls = [];
      const ctx = {
        fillStyle: '', strokeStyle: '', lineWidth: 1, font: '', textAlign: 'left', textBaseline: 'alphabetic', globalAlpha: 1,
        measureText(t) { return { width: t.length * Number(/(\d+)px/.exec(this.font)[1]) * 0.55 }; },
        createLinearGradient: () => { const g = { stops: [], addColorStop: (o, c) => g.stops.push(c) }; calls.push(['gradient', g]); return g; },
        fillRect(...a) { calls.push(['fillRect', this.fillStyle, ...a]); },
        strokeRect(...a) { calls.push(['strokeRect', ...a]); },
        fillText(t, x, y) { calls.push(['text', t, x, y, this.fillStyle, this.globalAlpha, this.font]); },
        drawImage(...a) { calls.push(['image', ...a]); },
        stroke() { calls.push(['stroke', this.strokeStyle, this.globalAlpha]); },
        stack: [],
        save() { this.stack.push([this.fillStyle, this.strokeStyle, this.lineWidth, this.font, this.textAlign, this.textBaseline, this.globalAlpha]); },
        restore() { [this.fillStyle, this.strokeStyle, this.lineWidth, this.font, this.textAlign, this.textBaseline, this.globalAlpha] = this.stack.pop(); },
        beginPath() {}, moveTo() {}, lineTo() {}, arc() {}, fill() {}, clip() {},
      };
      draw(ctx, { name: 'TC Alpha', color, logo });
      const palette = clubBackgroundPalette(color);
      inks[color] = palette.ink;
      assert.deepEqual(calls[0], ['fillRect', palette.fill, 0, 0, 1414, 2000], `${color}: whole page in the club colour`);
      assert.ok(calls.some(c => c[0] === 'gradient' && c[1].stops.length === 2 && c[1].stops[0] !== c[1].stops[1]), 'gradient');
      assert.ok(calls.filter(c => c[0] === 'stroke' || c[0] === 'strokeRect').length >= 3, 'court lines: not a flat colour');
      const texts = calls.filter(c => c[0] === 'text');
      assert.ok(texts.every(([, , , y]) => y < BACKGROUND_HEADER_H), `${color}: text only in the header`);
      const title = texts.find(c => c[1] === 'Les rencontres du week-end');
      assert.ok(title, 'title');
      assert.ok(title[2] >= 60 && title[2] + title[1].length * Number(/(\d+)px/.exec(title[6])[1]) * 0.55 <= 1354, 'inside the 60 px margins');
      assert.ok(texts.some(c => c[1] === 'TC Alpha'), 'club name');
      for (const t of texts) {
        assert.equal(t[4], palette.ink);
        assert.equal(t[5], 1, 'full opacity');
        assert.ok(contrast(palette.ink, palette.fill) >= 4.5, `${color}: ${contrast(palette.ink, palette.fill).toFixed(2)}`);
      }
      assert.equal(calls.filter(c => c[0] === 'image').length, logo ? 1 : 0);
      assert.equal(texts.some(c => c[1] === 'TA'), !logo, 'initials without a logo');
    }
  }
  assert.notEqual(inks['#e8c547'], inks['#1d3f8f'], 'dark ink on a light colour, white on a dark one');
});
