// S8b — relecture « Remplir depuis Ten'Up » : mapping (cas Moissac : part club, réduction à 1 €,
// produits, « à partir de »), jamais d'écrasement silencieux, écriture par groupe validée, puis le
// parcours réel de `/admin/site` (bandeau, relecture, enregistrement, panneaux remontés, lien collé,
// `internal`, lecture récente).
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { createRequire } from 'node:module';
import vm from 'node:vm';
import ts from 'typescript';
import { JSDOM } from 'jsdom';
import { siteGaps } from '../shared/siteReadiness.mjs';
import {
  extractTenupClubBoard, extractTenupClubHome, extractTenupClubOffers, extractTenupInstallation, extractTenupOfferTariffs,
} from '../services/tenup-worker/parse-club-profile.mjs';

const dom = new JSDOM('<div id="root"></div>', { url: 'https://admin.feelike.pro/admin/site' });
globalThis.window = dom.window; globalThis.document = dom.window.document;
globalThis.localStorage = dom.window.localStorage;
globalThis.IS_REACT_ACT_ENVIRONMENT = true;
globalThis.ResizeObserver = class { observe() {} disconnect() {} };
dom.window.HTMLElement.prototype.scrollIntoView = function () {};
dom.window.confirm = () => true;
Object.defineProperty(globalThis, 'navigator', { configurable: true, value: { userAgent: 'node' } });
const base = resolve(new URL('..', import.meta.url).pathname);
const req = createRequire(resolve(base, 'package.json'));
const { act, createElement: h } = req('react');
const { createRoot } = req('react-dom/client');
const { MemoryRouter } = req('react-router-dom');

const CLUB = 'c1';
const self = { id: CLUB, slug: 'tc-alpha', name: 'TC Alpha', sport: 'tennis', status: 'active', plan: 'trial', created_via: 'self_serve', site_published: false, trial_ends_at: null };
const STORE = 'https://db.example/storage/v1/object/public/content-images/c1/config/';
let db, log, state, proposal, club, invokeResult;
const supabase = {
  auth: {
    getSession: async () => ({ data: { session: { user: { id: 'u1' } } } }),
    onAuthStateChange: () => ({ data: { subscription: { unsubscribe() {} } } }),
  },
  async rpc(name, args) {
    log.push(['rpc', name, args]);
    if (name === 'club_tenup_site_state') return { data: state, error: null };
    if (name === 'club_tenup_site_consume') { if (proposal) proposal.status = 'consumed'; return { data: true, error: null }; }
    if (name === 'club_set_site_published') return { data: args.p_published, error: null };
    throw new Error(name);
  },
  functions: { async invoke(name, { body }) { log.push(['invoke', name, body]); return invokeResult(body); } },
  storage: { from: () => ({ remove: async (paths) => { log.push(['remove', ...paths]); return { error: null }; }, upload: async () => ({ error: null }), getPublicUrl: (p) => ({ data: { publicUrl: STORE + p } }) }) },
  from(table) {
    let filters = [], write = null, single = false;
    const rows = () => table === 'club_tenup_site_proposals'
      ? (proposal ? [proposal] : []).filter((row) => filters.every((f) => f(row)))
      : (db[table] || []).filter((row) => filters.every((f) => f(row)));
    const q = {
      select() { return q; }, order() { return q; }, limit() { return q; },
      eq(key, value) { filters.push((row) => row[key] === value); return q; },
      maybeSingle() { single = true; return q; },
      update(payload) { log.push(['update', table, payload]); write = () => { const found = rows(); found.forEach((row) => Object.assign(row, structuredClone(payload))); return found; }; return q; },
      then(done) { const data = write ? write() : rows(); done({ data: single ? data[0] ?? null : structuredClone(data), error: null }); },
    };
    return q;
  },
};
function load(relative) {
  const cache = new Map();
  function read(file) {
    if (file.endsWith('/lib/supabase.ts')) return { supabase };
    if (file.endsWith('/contexts/ClubContext.tsx')) return { useClub: () => ({ clubId: club.id, club, isSupport: false, loading: false }) };
    if (cache.has(file)) return cache.get(file).exports;
    const mod = { exports: {} }; cache.set(file, mod);
    const code = ts.transpileModule(readFileSync(file, 'utf8'), { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX, esModuleInterop: true } }).outputText;
    const require = (name) => {
      if (name.endsWith('.css')) return {};
      if (!name.startsWith('.')) return req(name);
      const p = resolve(dirname(file), name);
      return read([p, `${p}.ts`, `${p}.tsx`, `${p}.mjs`].find(existsSync));
    };
    vm.runInThisContext(`(function(require,module,exports){${code}\n})`, { filename: file })(require, mod, mod.exports);
    return mod.exports;
  }
  return read(resolve(base, relative));
}
const lib = load('src/lib/tenupSiteImport.ts');
const write = load('src/lib/clubConfigWrite.ts');
const { parseClubConfig } = load('src/lib/clubConfig.ts');

const doc = async (name) => new JSDOM(await readFile(new URL(`./fixtures/tenup-profile/${name}.html`, import.meta.url), 'utf8')).window.document;
async function moissac() {
  const { installation: _i, ...home } = extractTenupClubHome(await doc('60820110-club'));
  return {
    url: 'https://tenup.fft.fr/club/60820110', pages: { club: 'ok', equipe: 'ok', offres: 'ok', installation: 'ok' },
    // Images déjà copiées par l'Edge.
    club: { ...home, logo: `${STORE}1-tenup-logo.webp`, banner: `${STORE}1-tenup-bandeau.webp` },
    board: extractTenupClubBoard(await doc('60820110-equipe')).board,
    offers: extractTenupClubOffers(await doc('60820110-offres')).offers,
    courts: extractTenupInstallation(await doc('60820110-installation')).courts,
    image_errors: [],
  };
}
const byId = (items) => Object.fromEntries(items.map((i) => [i.id, i]));
const find = (items, label) => items.find((i) => i.next.startsWith(label));

/** L'écriture réelle (`saveClubConfigGroup`) contre la base factice. */
async function saveAll(config, items) {
  const out = lib.applyReview(config, items);
  for (const { group, value } of out.groups) {
    const result = await write.saveClubConfigGroup(CLUB, group, value);
    assert.deepEqual(result, { success: true }, group.key);
  }
  return { ...out, config: parseClubConfig(db.club_settings[0].config) };
}

function reset({ config = { brand: { name: 'TC Alpha' } }, withProposal = null, st = { available: true, tenup_club_id: '60820110', running: false, next_read_at: null, failures: 0 }, theClub = self } = {}) {
  db = { club_settings: [{ club_id: CLUB, config: structuredClone(config) }], clubs: [{ ...theClub }] };
  log = []; state = st; club = theClub;
  proposal = withProposal ? { club_id: CLUB, status: 'ready', payload: withProposal, read_at: '2026-11-14T10:00:00Z' } : null;
  invokeResult = () => ({ data: null, error: { context: new Response(JSON.stringify({ error: 'non' }), { status: 400 }) } });
}

test('mapping Moissac: everything checked except what needs a look; Ten’Up prices as they are', async () => {
  reset();
  const items = lib.buildReview(await moissac(), parseClubConfig({ brand: { name: 'TC Alpha' } }));
  const ids = byId(items);
  assert.equal(ids['brand.logo'].checked, true);
  assert.equal(ids['contact.address_city'].next, 'Moissac');
  assert.equal(ids['contact.phone'].next, '06 29 33 46 04');
  assert.equal(ids['home.hero_title'].next, 'Bienvenue au TC Alpha', 'the tunnel name, not the Ten’Up capitals');
  assert.equal(ids['home.hero_title'].editable, 'text');
  assert.equal(ids['club.president_name'].next, 'Zoé Michel');
  assert.equal(ids['club.president_role'].next, 'Président');
  assert.equal(items.filter((i) => i.list === 'board').length, 3);
  assert.deepEqual(items.filter((i) => i.list === 'courts').map((i) => i.entry), [
    { count: '3', label: 'Courts extérieurs', detail: 'Résine', image: '' },
    { count: '2', label: 'Courts couverts', detail: 'Résine', image: '' },
    { count: '2', label: 'Terrains de padel', detail: 'Gazon synthétique', image: '' },
  ]);
  assert.deepEqual(items.filter((i) => i.list === 'infra_teaser').map((i) => i.entry.detail), ['3 courts · résine', '2 courts · résine', '2 terrains · gazon synthétique']);
  assert.deepEqual(['cta_title', 'cta_text', 'cta_button'].map((k) => [ids[`home.${k}`].next, ids[`home.${k}`].checked]),
    [['Rejoignez notre club', true], [lib.DEFAULT_HOME_CTA.cta_text, true], ['Nous contacter', true]]);
  assert.equal(ids['pricing.season'].next, '2026/2027');
  // Part club sans licence : importée telle quelle, la description reste visible pour corriger.
  const adult = find(items, 'Adhesion Adulte tennis hors padel');
  assert.deepEqual([adult.list, adult.entry.price, adult.checked], ['membership', '117', true]);
  assert.match(adult.note, /Adhérez au club/);
  const from = find(items, 'Accés illimité');
  assert.deepEqual([from.entry.price, from.entry.subtitle], ['147', 'à partir de']);
  assert.equal(find(items, 'Jeu libre + 1h30 cours').list, 'lessons');
  assert.equal(find(items, 'Mini-tennis').list, 'lessons');
  assert.equal(find(items, 'Perf enfant').list, 'membership', 'the label decides, not the description');
  const reduction = find(items, 'Reduction');
  assert.deepEqual([reduction.checked, reduction.warning], [false, 'prix à vérifier']);
  for (const product of items.filter((i) => /^Tube/.test(i.next))) {
    assert.deepEqual([product.list, product.checked], ['other_fees', false]);
    assert.match(product.warning, /produit/);
  }
  assert.equal(find(items, 'Tube 3').entry.price, '6,50 €');
  const tickets = find(items, '5 location tennis');
  assert.deepEqual([tickets.list, tickets.entry.price, tickets.checked], ['other_fees', '60 €', true]);
  assert.equal(find(items, 'Nos proposition').warning, 'prix manquant');
  assert.equal(items.some((i) => /Bénévole|Entraîneur/.test(i.next)), false, 'teachers and volunteers are not imported');
});

test('nothing is overwritten silently: current values shown, unchecked; lists only grow', async () => {
  reset();
  const config = parseClubConfig({
    brand: { name: 'TC Alpha', logo: `${STORE}old-logo.png` },
    contact: { phone: '05 63 00 00 00', email: 'tennispadelmoissac@gmail.com', address_street: 'avenue du sarlac' },
    club: { board: [{ name: 'Alice Morel', role: 'Secrétaire' }] },
    pricing: { membership: [{ name: 'Adhesion Enfant', price: 40 }] },
    home: { hero_title: 'Bonjour', cta_button: 'Écrivez-nous', infra_teaser: [{ label: 'Club house' }, { label: 'Courts couverts' }] },
    infra: { courts: [{ count: '2', label: 'Courts couverts' }] },
  });
  const items = lib.buildReview(await moissac(), config);
  const ids = byId(items);
  assert.deepEqual([ids['contact.phone'].current, ids['contact.phone'].next, ids['contact.phone'].checked], ['05 63 00 00 00', '06 29 33 46 04', false]);
  assert.equal(ids['contact.phone'].warning, 'remplace la valeur actuelle');
  assert.deepEqual([ids['brand.logo'].current, ids['brand.logo'].checked], [`${STORE}old-logo.png`, false]);
  assert.equal(ids['contact.email'], undefined, 'same value: nothing to review');
  assert.equal(ids['contact.address_street'], undefined, 'same value, other case');
  assert.equal(ids['home.hero_title'], undefined, 'a home title exists: no default proposed');
  assert.equal(ids['home.cta_title'], undefined, 'the final call already has a button: no default');
  assert.deepEqual(items.filter((i) => i.list === 'courts').map((i) => i.entry.label), ['Courts extérieurs', 'Terrains de padel'], 'same label already on the site');
  assert.deepEqual(items.filter((i) => i.list === 'infra_teaser').map((i) => i.entry.label), ['Courts extérieurs'], 'three cards at most');
  assert.equal(items.some((i) => i.list === 'board' && i.entry.name === 'Alice Morel'), false, 'already on the site');
  assert.equal(items.some((i) => i.entry?.name === 'Adhesion Enfant'), false);
  // Coché à la main : l'ancienne image est à supprimer après l'enregistrement.
  ids['brand.logo'].checked = true;
  const saved = await saveAll(config, items);
  assert.deepEqual(saved.replaced, [`${STORE}old-logo.png`]);
  assert.deepEqual(saved.config.club.board.map((m) => m.name), ['Alice Morel', 'Bruno Francois', 'Claire Robert']);
  assert.equal(saved.config.contact.phone, '05 63 00 00 00', 'unchecked: kept');
  assert.equal(saved.config.pricing.membership[0].name, 'Adhesion Enfant');
});

test('write: validated groups, config parses, the site is complete with the default title', async () => {
  reset();
  const proposal = await moissac();
  const items = lib.buildReview(proposal, parseClubConfig(db.club_settings[0].config));
  // Tarif corrigé sur place, virgule comprise.
  const adult = find(items, 'Adhesion Adulte tennis hors padel');
  Object.assign(adult, { entry: { ...adult.entry, name: 'Adhésion adulte', price: '150,50' } });
  for (const item of lib.applyReview(parseClubConfig(db.club_settings[0].config), items).groups) {
    assert.equal(write.validateClubConfigGroup(item.group, item.value).valid, true, item.group.key);
  }
  const saved = await saveAll(parseClubConfig(db.club_settings[0].config), items);
  const config = saved.config;
  assert.deepEqual(siteGaps(config), [], 'the checklist item « Compléter votre site » is done');
  assert.equal(config.brand.logo, proposal.club.logo);
  assert.equal(config.brand.name, 'TC Alpha');
  assert.equal(config.home.hero_image, proposal.club.banner);
  assert.equal(config.home.hero_title, 'Bienvenue au TC Alpha');
  assert.deepEqual(config.contact, { ...config.contact, address_street: 'Avenue du Sarlac', address_postal_code: '82200', address_city: 'Moissac', phone: '06 29 33 46 04', email: 'tennispadelmoissac@gmail.com' });
  assert.equal(config.social.facebook_url, 'https://www.facebook.com/TCMoissac');
  assert.deepEqual(config.club.president, { ...config.club.president, name: 'Zoé Michel', role: 'Président' });
  assert.equal(config.infra.courts.length, 3);
  assert.equal(config.home.infra_teaser.length, 3);
  assert.equal(config.home.cta_button, 'Nous contacter');
  assert.equal(config.pricing.season, '2026/2027');
  assert.deepEqual(config.pricing.membership[0], { name: 'Adhésion adulte', subtitle: '', price: 150.5 });
  assert.equal(config.pricing.membership.some((m) => m.name === 'Reduction'), false);
  assert.equal(config.pricing.other_fees.some((m) => /Tube/.test(m.label)), false);
  assert.deepEqual(config.pricing.other_fees, [{ label: '5 location tennis', price: '60 €' }, { label: '5 Locations padel', price: '25 €' }]);
  assert.doesNotMatch(JSON.stringify(db.club_settings[0].config), /tenup\.fft\.fr|cmsclub/, 'no Ten’Up URL in the config');
  assert.equal(saved.filled, items.filter((i) => i.checked).length);
  assert.deepEqual(lib.unusedProposalImages(proposal, items), []);
  byId(items)['brand.logo'].checked = false;
  assert.deepEqual(lib.unusedProposalImages(proposal, items), [proposal.club.logo]);
});

test('unreadable image: shown, never checkable; other clubs and seasons', async () => {
  const p = await moissac();
  const items = lib.buildReview({ ...p, club: { ...p.club, logo: '' }, image_errors: ['logo'] }, parseClubConfig({}));
  const logo = byId(items)['brand.logo'];
  assert.deepEqual([logo.disabled, logo.checked], [true, false]);
  assert.match(logo.warning, /illisible/);
  assert.equal(lib.applyReview(parseClubConfig({}), items).groups.find((g) => g.group.key === 'brand'), undefined);
  assert.equal(lib.pricingSeason([], new Date('2026-11-14')), '2026/2027');
  assert.equal(lib.pricingSeason([], new Date('2027-03-01')), '2026/2027');
  assert.equal(lib.tidyCase('ERMONT'), 'Ermont');
  assert.equal(lib.tidyCase('SAINT-GRATIEN'), 'Saint-Gratien');
  assert.equal(lib.tidyCase('Jean-Christophe FALQUES'), 'Jean-Christophe Falques');
  assert.equal(lib.formatPhone('0134152500'), '01 34 15 25 00');
  assert.equal(lib.formatPhone('+33 5 61 71 24 24'), '+33 5 61 71 24 24');
  // Blagnac : cours depuis « Enseignement (cours) », animation écartée.
  const blagnac = extractTenupClubOffers(await doc('60310304-offres')).offers;
  assert.equal(lib.offerTarget(blagnac.find((o) => o.title === 'Groupe Elite')).list, 'lessons');
  assert.equal(lib.offerTarget(blagnac.at(-1)), null);
  // Ermont : les stages sont des produits, à vérifier.
  const ermont = extractTenupClubOffers(await doc('57950125-offres')).offers;
  assert.deepEqual(ermont.map((o) => lib.offerTarget(o).list), ['other_fees', 'other_fees', 'other_fees']);
  assert.ok(lib.offerTarget(ermont[1]).warning);
});

// ── Parcours réel de `/admin/site` ────────────────────────────────────────────
const flush = () => act(async () => { for (let i = 0; i < 6; i++) await new Promise((r) => setTimeout(r, 0)); });
const text = () => document.body.textContent;
const buttonNamed = (name) => [...document.querySelectorAll('button')].find((b) => b.textContent === name || b.textContent.startsWith(name));
async function click(name) { const b = buttonNamed(name); assert.ok(b, name); await act(async () => b.click()); await flush(); }
async function mount() {
  const Page = load('src/pages/SiteConfigPage.tsx').default;
  const root = createRoot(document.getElementById('root'));
  await act(async () => root.render(h(MemoryRouter, { initialEntries: ['/admin/site'] }, h(Page))));
  await flush();
  return async () => { await act(async () => root.unmount()); document.body.innerHTML = '<div id="root"></div>'; };
}
const input = (selector) => document.querySelector(selector);
async function type(el, value) {
  const setter = Object.getOwnPropertyDescriptor(dom.window.HTMLInputElement.prototype, 'value').set;
  await act(async () => { setter.call(el, value); el.dispatchEvent(new dom.window.Event('input', { bubbles: true })); });
}

test('/admin/site: background proposal → banner → review → save; panels show the values', async () => {
  reset({ withProposal: await moissac() });
  const unmount = await mount();
  try {
    assert.match(text(), /Votre site a été prérempli depuis Ten’Up — relisez et enregistrez/);
    await click('Relire');
    const legends = [...document.querySelectorAll('fieldset legend')].map((l) => l.textContent);
    assert.deepEqual(legends, ['Identité', 'Contact', 'Réseaux', 'Accueil', 'Le club', 'Infrastructures', 'Tarifs']);
    assert.match(text(), /Ces noms seront publiés sur votre site/);
    assert.match(text(), /à vérifier : prix à vérifier/);
    assert.ok(document.querySelector('[aria-live="polite"]'));
    // Chaque case a son libellé (clavier, lecteur d'écran).
    for (const box of document.querySelectorAll('section[aria-labelledby="tenup-site-title"] input[type="checkbox"]')) assert.ok(document.querySelector(`label[for="${box.id}"]`), box.id);
    const before = buttonNamed('Enregistrer').textContent;
    await act(async () => document.querySelector('#tenup-review-contact-email').click());
    assert.notEqual(buttonNamed('Enregistrer').textContent, before, 'the counter follows the boxes');
    await click('Enregistrer');
    await flush();
    const config = parseClubConfig(db.club_settings[0].config);
    assert.equal(config.contact.email ?? '', '', 'unchecked, not written');
    assert.equal(config.contact.phone, '06 29 33 46 04');
    assert.ok(log.some(([k, n]) => k === 'rpc' && n === 'club_tenup_site_consume'));
    assert.match(text(), /\d+ champs remplis depuis Ten’Up/);
    // Les panneaux remontés montrent la valeur enregistrée.
    assert.ok([...document.querySelectorAll('input')].some((i) => i.value === '06 29 33 46 04'), 'the contact panel shows the new phone');
    assert.equal(log.filter(([k]) => k === 'update').every(([, t]) => t === 'club_settings'), true);
  } finally { await unmount(); }
});

test('/admin/site: pasted link → read → review; invalid link refused before any call', async () => {
  reset();
  const p = await moissac();
  invokeResult = (body) => ({ data: { started: true, payload: p }, error: null, body });
  const unmount = await mount();
  try {
    assert.match(text(), /Remplir depuis Ten’Up/);
    await click('Remplir depuis Ten’Up');
    const field = input('#tenup-site-url');
    await type(field, 'https://evil.test/club/1');
    await act(async () => document.querySelector('form').dispatchEvent(new dom.window.Event('submit', { bubbles: true, cancelable: true })));
    await flush();
    assert.match(document.querySelector('[role="alert"]').textContent, /Copiez le lien/);
    assert.equal(log.some(([k]) => k === 'invoke'), false);
    await type(field, 'https://tenup.fft.fr/club/60820110/equipe');
    await act(async () => document.querySelector('form').dispatchEvent(new dom.window.Event('submit', { bubbles: true, cancelable: true })));
    await flush();
    assert.deepEqual(log.find(([k]) => k === 'invoke').slice(1), ['tenup-site', { club_id: CLUB, url: 'https://tenup.fft.fr/club/60820110' }]);
    assert.match(text(), /Relisez ce que Ten’Up dit de votre club/);
    // « Plus tard » garde la proposition : le bandeau la réannonce.
    await click('Plus tard');
    assert.match(text(), /Votre site a été prérempli depuis Ten’Up/);
  } finally { await unmount(); }
});

test('/admin/site: server refusal shown; recent read gives the date; internal club sees nothing', async () => {
  reset();
  invokeResult = () => ({ data: null, error: { context: new Response(JSON.stringify({ error: 'Ten’Up ne répond pas.' }), { status: 502 }) } });
  let unmount = await mount();
  try {
    await click('Remplir depuis Ten’Up');
    await type(input('#tenup-site-url'), 'https://tenup.fft.fr/club/60820110');
    await act(async () => document.querySelector('form').dispatchEvent(new dom.window.Event('submit', { bubbles: true, cancelable: true })));
    await flush();
    assert.match(document.querySelector('[role="alert"]').textContent, /Ten’Up ne répond pas/);
  } finally { await unmount(); }

  reset({ st: { available: true, tenup_club_id: '1', running: false, next_read_at: new Date(Date.now() + 3_600_000).toISOString(), failures: 0 } });
  unmount = await mount();
  try {
    assert.match(text(), /Nouvelle lecture Ten’Up possible le/);
    assert.equal(buttonNamed('Remplir depuis Ten’Up'), undefined);
  } finally { await unmount(); }

  reset({ theClub: { ...self, plan: 'internal', created_via: 'console' }, st: { available: false } });
  unmount = await mount();
  try {
    assert.doesNotMatch(text(), /Ten’Up/);
    assert.equal(log.some(([, n]) => n === 'club_tenup_site_state'), false, 'no call at all for the CAC');
  } finally { await unmount(); }
});

test('S8b-bis — CAC: courts grouped with the photo, home cards, one line per tariff of an « À partir de » offer', async () => {
  const cacDoc = await doc('60820058-installation');
  const { courts } = extractTenupInstallation(cacDoc);
  const p = await moissac();
  const photo = `${STORE}2-tenup-installation.webp`, photoHome = `${STORE}2-tenup-installation-accueil.webp`;
  const tariffs = extractTenupOfferTariffs(await doc('60820058-offre')).tariffs;
  const proposal = {
    ...p, courts, club: { ...p.club, installation_image: photo, installation_image_home: photoHome },
    offers: [{ type: 'Enseignement (cours)', title: 'Cours collectifs Tennis', year: 2027, description: '', price: 20, from: true, tariffs },
      { type: 'Adhésion', title: 'CARTE PADEL', year: 2027, description: '', price: 113, from: true, tariffs: [] }],
  };
  const items = lib.buildReview(proposal, parseClubConfig({ brand: { name: 'CAC' } }));
  assert.deepEqual(items.filter((i) => i.list === 'courts').map((i) => i.entry), [
    { count: '7', label: 'Courts extérieurs', detail: 'Béton poreux, gazon synthétique, terre battue traditionnelle', image: photo },
    { count: '6', label: 'Courts couverts', detail: 'Résine, terre battue traditionnelle', image: '' },
    { count: '2', label: 'Terrains de padel', detail: 'Gazon synthétique', image: '' },
  ], 'padel kept: its surface is also a tennis surface');
  assert.deepEqual(items.filter((i) => i.list === 'infra_teaser').map((i) => [i.entry.label, i.entry.image]),
    [['Courts extérieurs', photoHome], ['Courts couverts', ''], ['Terrains de padel', '']]);
  const lessons = items.filter((i) => i.list === 'lessons');
  assert.equal(lessons.length, 5);
  assert.deepEqual(lessons[0].entry, { ...lessons[0].entry, name: '1 heure de tennis à 2 ni membres ni licenciés', subtitle: 'Cours collectifs Tennis', price: '22' });
  assert.equal(lessons[0].note, 'Tarif par personne, Licence en supplément obligatoire');
  assert.equal(lessons[0].next, '1 heure de tennis à 2 ni membres ni licenciés (Cours collectifs Tennis) — 22 €');
  assert.equal(lessons.every((i) => i.checked), true);
  const padel = items.find((i) => i.entry?.name === 'CARTE PADEL');
  assert.deepEqual([padel.entry.subtitle, padel.next], ['à partir de', 'CARTE PADEL — à partir de 113 €'], 'page not read: lowest price kept');

  reset({ config: { brand: { name: 'CAC' } } });
  const saved = await saveAll(parseClubConfig(db.club_settings[0].config), items);
  assert.equal(saved.config.infra.courts[0].image, photo);
  assert.equal(saved.config.home.infra_teaser[0].image, photoHome);
  assert.equal(saved.config.pricing.lessons.length, 5);
  assert.deepEqual(lib.unusedProposalImages(proposal, items), []);
  items.find((i) => i.id === 'home.infra_teaser.0').checked = false;
  assert.deepEqual(lib.unusedProposalImages(proposal, items), [photoHome]);
  // Proposition lue avant S8b-bis : ni photo ni grille, rien ne casse.
  const old = lib.buildReview({ ...p, courts }, parseClubConfig({}));
  assert.equal(old.find((i) => i.list === 'courts').entry.image, '');
});

test('S8b-bis — what Ten’Up does not give: president’s word, partners, key figures', () => {
  const extras = load('src/lib/siteExtras.ts');
  assert.deepEqual(extras.missingSiteExtras(parseClubConfig({})).map((e) => [e.id, extras.extraPanelPath(e)]),
    [['president_quote', '/admin/site#panneau-club'], ['partners', '/admin/site#panneau-partners'], ['stats', '/admin/site#panneau-home']]);
  assert.deepEqual(extras.missingSiteExtras(parseClubConfig({
    club: { president: { quote: 'Bienvenue' } }, partners: [{ logo: 'x' }], home: { stats: [{ value: '6', label: 'courts' }] },
  })), []);
});
