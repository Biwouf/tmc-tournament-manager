// SaaS S3 — logique du tunnel d'inscription (src/lib/clubSignup.ts) et source partagée des
// tokens de marque (shared/brandTokens.mjs). Le module TS est chargé par le type stripping de Node.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { signupSlugProblem } from '../shared/clubSlug.mjs';
import { brandTokens } from '../shared/brandTokens.mjs';
const lib = await import('../src/lib/clubSignup.ts');
const root = new URL('..', import.meta.url).pathname;

test('slugify : mots vides retirés, accents, 32 caractères sans tiret final', () => {
  assert.equal(lib.slugify('Tennis Club de Saint-Aubin'), 'tennis-club-saint-aubin');
  assert.equal(lib.slugify('Étoile Sportive d’Écully'), 'etoile-sportive-ecully');
  assert.equal(lib.slugify("Les Amis du Tennis et de l'Arbre"), 'amis-tennis-arbre');
  assert.equal(lib.slugify('  '), '');
  const long = lib.slugify('Association Sportive Municipale Tennis Castelsarrasin Moissac');
  assert.ok(long.length <= 32 && !long.endsWith('-'), long);
  for (const name of ['Tennis Club de Saint-Aubin', 'CAC Tennis', 'TC Montauban 82']) assert.equal(signupSlugProblem(lib.slugify(name)), null, name);
});

test('saisie et suggestion d’adresse', () => {
  assert.equal(lib.cleanSlugInput('TC Saint Aubin'), 'tc-saint-aubin');
  assert.equal(lib.cleanSlugInput('Été_92!'), 'ete92');
  assert.equal(lib.cleanSlugInput('x'.repeat(40)).length, 32);
  assert.equal(lib.suggestSlug('tc-saint-aubin', 'Montauban'), 'tc-saint-aubin-montauban');
  assert.equal(lib.suggestSlug('tc-montauban', 'Montauban'), null, 'la ville y est déjà');
  assert.equal(lib.suggestSlug('tc', ''), null);
  assert.equal(lib.suggestSlug('a'.repeat(30), 'Albi').length, 32);
});

test('messages de disponibilité', () => {
  assert.equal(lib.slugMessage({ state: 'idle' }), '');
  assert.match(lib.slugMessage({ state: 'available' }), /disponible/);
  assert.match(lib.slugMessage({ state: 'unavailable', reason: 'taken' }), /déjà prise/);
  assert.match(lib.slugMessage({ state: 'unavailable', reason: 'reserved' }), /réservée/);
  assert.match(lib.slugMessage({ state: 'unavailable', reason: 'format' }), /3 à 32/);
});

function pixels(...runs) {
  const data = [];
  for (const [count, [r, g, b, a = 255]] of runs) for (let i = 0; i < count; i++) data.push(r, g, b, a);
  return Uint8ClampedArray.from(data);
}

test('extractPalette : teintes dominantes, sans fond blanc, noir ni transparence', () => {
  const palette = lib.extractPalette(pixels(
    [900, [31, 107, 74]], [300, [232, 197, 71]], [2000, [255, 255, 255]], [500, [0, 0, 0]], [400, [200, 30, 30, 0]],
  ));
  assert.deepEqual(palette, ['#1f6b4a', '#e8c547']);
  // Deux verts voisins ne font qu'une teinte ; jamais plus de quatre.
  assert.equal(lib.extractPalette(pixels([500, [31, 107, 74]], [400, [40, 112, 80]])).length, 1);
  const many = lib.extractPalette(pixels([100, [200, 20, 20]], [100, [20, 200, 20]], [100, [20, 20, 200]], [100, [200, 200, 20]], [100, [200, 20, 200]]));
  assert.equal(many.length, 4);
  assert.deepEqual(lib.extractPalette(pixels([100, [255, 255, 255]])), []);
  // La saturation pèse : un rouge vif minoritaire passe devant un gris majoritaire.
  assert.equal(lib.extractPalette(pixels([300, [120, 120, 120]], [200, [229, 24, 40]]))[0], '#e51828');
});

test('codes de club-signup → message humain et étape à corriger', () => {
  assert.deepEqual(lib.signupOutcome(200), { ok: true });
  const cases = [
    [409, {}, 3, /prise/, true, 'taken'],
    [400, { reason: 'reserved' }, 3, /pas disponible/, true, 'reserved'],
    [400, { error: 'Image attendue : PNG, JPEG ou WebP.' }, 2, /PNG/, true, undefined],
    [400, { error: 'Informations incomplètes ou invalides.' }, 4, /incomplètes/, true, undefined],
    [413, {}, 2, /5 Mo/, true, undefined],
    [429, {}, 4, /une heure/, true, undefined],
    [403, {}, 4, /anti-robot/, true, undefined],
    [502, {}, 4, /e-mail n’a pas pu partir/, true, undefined],
    [500, {}, 4, /momentanément indisponible/, true, undefined],
    [503, undefined, 4, /momentanément indisponible/, true, undefined],
    ['network', undefined, 4, /réseau/, false, undefined],
  ];
  for (const [status, body, step, message, reset, reason] of cases) {
    const outcome = lib.signupOutcome(status, body);
    assert.equal(outcome.ok, false, String(status));
    assert.equal(outcome.step, step, String(status));
    assert.match(outcome.message, message, String(status));
    assert.equal(outcome.resetTurnstile, reset, String(status));
    assert.equal(outcome.slugReason, reason, String(status));
  }
});

test('envoi : formulaire multipart attendu par club-signup, réseau coupé', async () => {
  let sent;
  const ok = await lib.submitClubSignup(async (url, init) => { sent = { url, form: init.body }; return Response.json({ ok: true }); }, 'https://x/functions/v1/club-signup', {
    name: ' TC Nouveau ', city: 'Moissac', slug: 'tc-nouveau', color: '#1f6b4a', email: ' Président@Club.FR ', turnstileToken: 'jeton',
    logo: new Blob(['x'], { type: 'image/webp' }), photo: null,
  });
  assert.deepEqual(ok, { ok: true });
  assert.equal(sent.url, 'https://x/functions/v1/club-signup');
  const fields = Object.fromEntries([...sent.form.entries()].filter(([, v]) => typeof v === 'string'));
  assert.deepEqual(fields, { name: 'TC Nouveau', city: 'Moissac', sport: 'tennis', slug: 'tc-nouveau', color: '#1f6b4a', email: 'président@club.fr', turnstile_token: 'jeton' });
  assert.equal(sent.form.get('logo').name, 'logo.webp');
  assert.equal(sent.form.get('photo'), null);
  const taken = await lib.submitClubSignup(async () => Response.json({ error: 'pris', reason: 'taken' }, { status: 409 }), 'u', { name: 'a', city: 'b', slug: 'c', color: '#000000', email: 'a@b.c', turnstileToken: 't' });
  assert.equal(taken.step, 3);
  const offline = await lib.submitClubSignup(async () => { throw new TypeError('Failed to fetch'); }, 'u', { name: 'a', city: 'b', slug: 'c', color: '#000000', email: 'a@b.c', turnstileToken: 't' });
  assert.equal(offline.status, 0); assert.equal(offline.resetTurnstile, false);
  const html = await lib.submitClubSignup(async () => new Response('<html>', { status: 502 }), 'u', { name: 'a', city: 'b', slug: 'c', color: '#000000', email: 'a@b.c', turnstileToken: 't' });
  assert.equal(html.status, 502);
});

function memoryStorage(quota = Infinity) {
  const map = new Map();
  return { map, getItem: k => map.get(k) ?? null, setItem: (k, v) => { if (v.length > quota) throw new Error('QuotaExceededError'); map.set(k, v); } };
}

test('saisie conservée au rechargement, sans les images trop lourdes', () => {
  const storage = memoryStorage();
  assert.deepEqual(lib.loadDraft(storage), lib.emptyDraft());
  const draft = { ...lib.emptyDraft(), step: 3, name: 'TC Nouveau', city: 'Moissac', slug: 'tc-nouveau', slugEdited: true, color: '#1f6b4a',
    palette: ['#1f6b4a', '#e8c547'], email: 'a@b.fr', logo: 'data:image/webp;base64,AAAA', photo: 'data:image/webp;base64,' + 'A'.repeat(lib.MAX_STORED_IMAGE) };
  lib.saveDraft(storage, draft);
  const back = lib.loadDraft(storage);
  assert.deepEqual(back, { ...draft, photo: null }, 'photo trop lourde abandonnée, le reste conservé');
  // Quota dépassé même sans la grande image : la saisie est écrite sans aucune image.
  const tight = memoryStorage(400);
  lib.saveDraft(tight, { ...draft, logo: 'data:image/webp;base64,' + 'B'.repeat(500), photo: null });
  assert.equal(lib.loadDraft(tight).name, 'TC Nouveau');
  assert.equal(lib.loadDraft(tight).logo, null);
});

test('saisie conservée : lecture tolérante', () => {
  const storage = memoryStorage();
  storage.setItem(lib.DRAFT_KEY, '{abîmé');
  assert.deepEqual(lib.loadDraft(storage), lib.emptyDraft());
  storage.setItem(lib.DRAFT_KEY, JSON.stringify({ step: 9, color: 'red', palette: ['#zzzzzz', '#123456'], sample: 7, slug: 'Mon Club!', logo: 'javascript:alert(1)', name: 42 }));
  const draft = lib.loadDraft(storage);
  assert.equal(draft.step, 'find'); assert.equal(draft.color, lib.BRAND_FALLBACK); assert.deepEqual(draft.palette, ['#123456']);
  assert.equal(draft.sample, null); assert.equal(draft.slug, 'mon-club'); assert.equal(draft.logo, null); assert.equal(draft.name, '');
  storage.setItem(lib.DRAFT_KEY, JSON.stringify({ step: 'sent' }));
  assert.equal(lib.loadDraft(storage).step, 'account', 'confirmation sans envoi connu → écran 03');
  storage.setItem(lib.DRAFT_KEY, JSON.stringify({ step: 'sent', sent: { email: 'a@b.fr', slug: 'tc' } }));
  assert.deepEqual(lib.loadDraft(storage).sent, { email: 'a@b.fr', slug: 'tc' });
});

test('configuration : fermé sans clé Turnstile ni pages juridiques, valeurs de test en dev seulement', () => {
  assert.equal(lib.signupConfig({}).open, false);
  assert.equal(lib.signupConfig({ VITE_TURNSTILE_SITE_KEY: 'k', VITE_SIGNUP_TERMS_URL: 'https://www.feelike.pro/cgu' }).open, false);
  const prod = lib.signupConfig({ VITE_TURNSTILE_SITE_KEY: 'k', VITE_SIGNUP_TERMS_URL: 'https://t', VITE_SIGNUP_PRIVACY_URL: 'https://p' });
  assert.deepEqual(prod, { siteKey: 'k', termsUrl: 'https://t', privacyUrl: 'https://p', open: true });
  const dev = lib.signupConfig({ DEV: true });
  assert.equal(dev.open, true); assert.equal(dev.siteKey, lib.TURNSTILE_TEST_SITE_KEY);
  assert.notEqual(lib.signupConfig({ DEV: false }).siteKey, lib.TURNSTILE_TEST_SITE_KEY);
});

// Critère 3 du brief : l'aperçu et la vitrine posent les mêmes fonds et textes de marque.
test('tokens de marque : une seule fonction pour la vitrine et l’aperçu', () => {
  const light = brandTokens('#e8c547');
  assert.equal(light['--brand-fill'], light['--brand']);
  assert.equal(light['--brand-foreground'], 'hsl(5.5 15.1% 14.3%)', 'encre sur le jaune');
  const green = brandTokens('#3a9a5c');
  assert.equal(green['--brand-fill'], green['--brand']);
  assert.equal(green['--brand-foreground'], 'hsl(5.5 15.1% 14.3%)', 'encre sur le vert moyen');
  const source = (file) => readFileSync(join(root, file), 'utf8');
  assert.match(source('web/src/lib/tokens.ts'), /from '\.\.\/\.\.\/\.\.\/shared\/brandTokens\.mjs'/);
  assert.match(source('src/components/signup/SignupPreview.tsx'), /from '\.\.\/\.\.\/\.\.\/shared\/brandTokens\.mjs'/);
  for (const file of ['web/src/lib/tokens.ts', 'src/components/signup/SignupPreview.tsx', 'src/pages/SignupTunnelPage.tsx']) {
    assert.doesNotMatch(source(file), /function (hexToHsl|luminance|darkenUntil)/, `${file} ne recopie pas le calcul`);
  }
});

// Critère 2 : la règle du slug n'existe qu'une fois côté code (les copies SQL sont testées
// par club-signup-sql.test.mjs).
test('aucune copie de la regex de slug ni de la liste des réservés hors de shared/clubSlug.mjs', () => {
  const files = [];
  const walk = (dir) => {
    for (const name of readdirSync(dir)) {
      if (['node_modules', 'dist', '.astro', 'migrations', 'tests'].includes(name)) continue;
      const path = join(dir, name);
      if (statSync(path).isDirectory()) walk(path);
      else if (/\.(m?[jt]sx?|astro)$/.test(name)) files.push(path);
    }
  };
  for (const dir of ['src', 'pwa/src', 'web/src', 'web/server.mjs', 'shared', 'supabase/functions', 'landing/src']) {
    const path = join(root, dir);
    if (statSync(path).isDirectory()) walk(path); else files.push(path);
  }
  const offenders = files.filter(file => !file.endsWith('shared/clubSlug.mjs'))
    .filter(file => /\{1,30\}|'static',\s*'assets'|"static",\s*"assets"/.test(readFileSync(file, 'utf8')))
    .map(file => relative(root, file));
  assert.deepEqual(offenders, []);
});

// ── Onboarding « Ten'Up d'abord », PR P0 : retouches du tunnel, rendu réel sous jsdom ───────
async function renderTunnel({ draft, rawDraft, mobile = false, turnstileToken = null, respond, available, palette = [], online = true }) {
  const { JSDOM } = await import('jsdom');
  const ts = (await import('typescript')).default;
  const vm = await import('node:vm');
  const { createRequire } = await import('node:module');
  const { dirname, resolve } = await import('node:path');
  const { existsSync } = await import('node:fs');
  const req = createRequire(join(root, 'package.json'));
  const dom = new JSDOM('<div id="root"></div>', { url: 'https://admin.feelike.pro/inscription', pretendToBeVisual: true });
  Object.assign(globalThis, { window: dom.window, document: dom.window.document, IS_REACT_ACT_ENVIRONMENT: true });
  Object.defineProperty(globalThis, 'navigator', { configurable: true, value: { userAgent: 'node', onLine: online } });
  globalThis.ResizeObserver = class { observe() {} disconnect() {} };
  dom.window.matchMedia = () => ({ matches: mobile, addEventListener() {}, removeEventListener() {} });
  dom.window.scrollTo = () => {};
  dom.window.HTMLElement.prototype.scrollIntoView = function () {};
  if (draft) dom.window.sessionStorage.setItem(lib.DRAFT_KEY, JSON.stringify({ ...lib.emptyDraft(), ...draft }));
  if (rawDraft) dom.window.sessionStorage.setItem(lib.DRAFT_KEY, rawDraft);
  // Réseau simulé : `tenup-lookup` (JSON) et `club-signup` (multipart). `respond` choisit la réponse.
  const requests = [];
  globalThis.fetch = async (url, init) => {
    const lookup = String(url).endsWith('/tenup-lookup');
    const entry = lookup ? { url, kind: 'lookup', body: JSON.parse(init.body) } : { url, kind: 'signup', form: init.body };
    requests.push(entry);
    return respond ? respond(entry) : Response.json({ ok: true });
  };
  // `slug_available` simulé : `available(slug)` → true / false / null (erreur).
  const rpcs = [];
  const rpc = async (name, args) => {
    rpcs.push(args.slug);
    const free = available ? await available(args.slug) : true;
    return free === null ? { data: null, error: new Error('rpc') } : { data: { available: free, ...(free ? {} : { reason: 'taken' }) }, error: null };
  };
  // Turnstile simulé : `interaction-only` attendu, jeton remis (ou non) dès le rendu ; un reset en donne un neuf.
  const widgets = [];
  let tokens = 0;
  dom.window.turnstile = {
    render: (el, options) => { widgets.push(options); if (turnstileToken) options.callback(`${turnstileToken}-${++tokens}`); return `w${widgets.length}`; },
    reset(id) { const options = widgets[Number(id.slice(1)) - 1]; if (turnstileToken && options) options.callback(`${turnstileToken}-${++tokens}`); },
    remove() {},
  };
  const env = JSON.stringify({ DEV: true, VITE_SUPABASE_URL: 'https://x.supabase.co' });
  const cache = new Map();
  function read(file) {
    if (cache.has(file)) return cache.get(file).exports;
    const mod = { exports: {} }; cache.set(file, mod);
    const code = ts.transpileModule(readFileSync(file, 'utf8').replaceAll('import.meta.env', env), { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX, esModuleInterop: true } }).outputText;
    const require = (name) => {
      if (name.endsWith('.css') || name.startsWith('@fontsource')) return {};
      if (name.endsWith('/lib/supabase') || name.endsWith('/supabase')) return { supabase: { rpc } };
      if (!name.startsWith('.')) return req(name);
      const p = resolve(dirname(file), name);
      const exports = read([p, `${p}.ts`, `${p}.tsx`, `${p}.mjs`].find(existsSync));
      // Le canvas n'existe pas sous jsdom : les teintes du logo sont simulées.
      if (name.endsWith('/signupImage')) return { ...exports, paletteFromUrl: async () => palette };
      return exports;
    };
    vm.runInThisContext(`(function(require,module,exports){${code}\n})`, { filename: file })(require, mod, mod.exports);
    return mod.exports;
  }
  const Page = read(join(root, 'src/pages/SignupTunnelPage.tsx')).default;
  const { act, createElement: h } = req('react');
  const { createRoot } = req('react-dom/client');
  const { MemoryRouter } = req('react-router-dom');
  const container = dom.window.document.getElementById('root');
  const rootNode = createRoot(container);
  const flush = () => act(async () => { await new Promise(r => setTimeout(r, 0)); });
  await act(async () => rootNode.render(h(MemoryRouter, null, h(Page))));
  await flush();
  const button = (name) => [...container.querySelectorAll('button, a')].find(b => b.textContent === name);
  const click = async (el) => { await act(async () => el.click()); await flush(); };
  const type = async (id, value, { paste = false } = {}) => {
    const input = container.querySelector(`#${id}`);
    const setter = Object.getOwnPropertyDescriptor(dom.window.HTMLInputElement.prototype, 'value').set;
    await act(async () => {
      if (paste) input.dispatchEvent(new dom.window.Event('paste', { bubbles: true }));
      setter.call(input, value); input.dispatchEvent(new dom.window.Event('input', { bubbles: true }));
    });
    await flush();
  };
  /** Laisse passer les vérifications d'adresse (300 ms) et les réponses simulées. */
  const settle = async (ms = 350) => { await act(async () => { await new Promise(r => setTimeout(r, ms)); }); await flush(); await flush(); };
  const saved = () => dom.window.sessionStorage.getItem(lib.DRAFT_KEY);
  return { dom, container, requests, rpcs, widgets, button, click, type, settle, saved, flush, act, unmount: () => act(async () => rootNode.unmount()) };
}

test('P0 étape 1 : ni champ Sport ni placeholder d’exemple, nom en casse réelle ; club-signup reçoit tennis', async () => {
  const t = await renderTunnel({ draft: { step: 1, mode: 'manual' } });
  try {
    assert.doesNotMatch(t.container.textContent, /Sport|Autres sports/);
    assert.equal(t.container.querySelectorAll('[placeholder]').length, 0);
    assert.doesNotMatch(t.container.querySelector('#fl-club').className, /name/, 'plus de police condensée en capitales');
  } finally { await t.unmount(); }
  const source = readFileSync(join(root, 'src/pages/SignupTunnelPage.tsx'), 'utf8');
  assert.doesNotMatch(source, /placeholder=|Saint-Aubin|president@votreclub/);
  assert.doesNotMatch(readFileSync(join(root, 'src/components/signup/signup.css'), 'utf8'), /fl-input-name/);
  assert.equal(lib.signupForm({ name: 'a', city: 'b', slug: 'abc', color: '#000000', email: 'a@b.fr', turnstileToken: 't' }).get('sport'), 'tennis');
});

test('P0 étape 2 : « Continuer » est le bouton principal, « Passer cette étape » un lien', async () => {
  const t = await renderTunnel({ draft: { step: 2, mode: 'manual', name: 'TC Nouveau', city: 'Moissac', slug: 'tc-nouveau' } });
  try {
    assert.equal(t.button('Continuer').className, 'fl-cta');
    assert.equal(t.button('Passer cette étape').className, 'fl-link');
    await t.click(t.button(lib.COLOR_SAMPLES[1].label));
    assert.equal(t.button('Passer cette étape'), undefined, 'une couleur choisie : seulement Continuer');
    assert.equal(t.button('Continuer').className, 'fl-cta');
  } finally { await t.unmount(); }
});

test('P0 étape 4 : bouton jamais grisé ; envoi incomplet → message et focus sur le manque, aucune requête', async () => {
  const t = await renderTunnel({ draft: { step: 'account', mode: 'manual', name: 'TC Nouveau', city: 'Moissac', slug: 'tc-nouveau' } });
  try {
    assert.equal(t.widgets[0].appearance, 'interaction-only', 'Turnstile invisible tant qu’aucun défi');
    const submit = () => t.button('Créer mon club · 30 jours offerts');
    const message = (field) => t.container.querySelector(`#fl-${field}-error`)?.textContent ?? '';
    assert.equal(submit().disabled, false);
    await t.click(submit());
    assert.equal(message('email'), 'Indiquez votre e-mail.');
    // Le message se lit sous le champ à corriger, pas sous la case CGU.
    assert.equal(t.container.querySelector('#fl-email-error').previousElementSibling.id, 'fl-email');
    assert.equal(t.dom.window.document.activeElement.id, 'fl-email');
    assert.equal(t.container.querySelector('#fl-email').getAttribute('aria-invalid'), 'true');
    assert.equal(t.container.querySelector('#fl-email').getAttribute('aria-describedby'), 'fl-email-error');
    const email = t.container.querySelector('#fl-email');
    const setter = Object.getOwnPropertyDescriptor(t.dom.window.HTMLInputElement.prototype, 'value').set;
    await t.act(async () => { setter.call(email, 'president@club.fr'); email.dispatchEvent(new t.dom.window.Event('input', { bubbles: true })); });
    await t.click(submit());
    assert.equal(message('email'), '', 'le message de l’e-mail est parti');
    assert.equal(message('consent'), 'Cochez l’acceptation des CGU.');
    assert.ok(t.container.querySelector('#fl-consent-error').previousElementSibling.contains(t.container.querySelector('#fl-consent')), 'sous la case');
    assert.equal(t.dom.window.document.activeElement.id, 'fl-consent');
    await t.click(t.container.querySelector('#fl-consent'));
    await t.click(submit());
    assert.match(message('turnstile'), /anti-robot n’est pas terminée/, 'jeton Turnstile pas encore reçu');
    assert.equal(submit().disabled, false);
    assert.deepEqual(t.requests, [], 'aucune requête tant qu’il manque quelque chose');
    // Le jeton arrive : l'envoi part, avec tennis.
    await t.act(async () => t.widgets[0].callback('jeton'));
    assert.match(t.container.textContent, /Gardez TC Nouveau/, 'titre « Gardez <nom> » en branche manuelle');
    assert.equal(message('turnstile'), '', 'message retiré quand le jeton arrive');
    await t.click(submit());
    assert.equal(t.requests.length, 1);
    assert.equal(t.requests[0].form.get('sport'), 'tennis');
    assert.equal(t.requests[0].form.get('email'), 'president@club.fr');
    assert.equal(t.requests[0].form.get('lookup_token'), null, 'branche manuelle : ni jeton de lecture');
    assert.equal(t.requests[0].form.get('short_name'), null, '… ni nom court');
  } finally { await t.unmount(); }
});

test('P0 étape 1 : bouton jamais grisé ; nom ou ville manquant → message sous le champ et focus, on reste', async () => {
  const t = await renderTunnel({ draft: { step: 1, mode: 'manual' } });
  try {
    const next = () => t.button('Continuer');
    assert.equal(next().disabled, false);
    await t.click(next());
    assert.equal(t.container.querySelector('#fl-name-error').textContent, 'Indiquez le nom du club.');
    assert.equal(t.container.querySelector('#fl-name-error').previousElementSibling.id, 'fl-club');
    assert.equal(t.dom.window.document.activeElement.id, 'fl-club');
    const type = async (id, value) => {
      const input = t.container.querySelector(`#${id}`);
      const setter = Object.getOwnPropertyDescriptor(t.dom.window.HTMLInputElement.prototype, 'value').set;
      await t.act(async () => { setter.call(input, value); input.dispatchEvent(new t.dom.window.Event('input', { bubbles: true })); });
    };
    await type('fl-club', 'Tennis Club de Moissac');
    assert.equal(t.container.querySelector('#fl-name-error'), null, 'message retiré à la saisie');
    await t.click(next());
    assert.equal(t.container.querySelector('#fl-city-error').textContent, 'Indiquez la ville du club.');
    assert.equal(t.dom.window.document.activeElement.id, 'fl-city');
    await type('fl-city', 'Moissac');
    await t.click(next());
    assert.match(t.container.textContent, /Votre logo, votre photo/);
  } finally { await t.unmount(); }
});

test('P0 étape 3 : bouton jamais grisé ; adresse refusée → focus sur le champ ; en vérification → on avance à la réponse', async () => {
  const t = await renderTunnel({ draft: { step: 3, mode: 'manual', name: 'TC Nouveau', city: 'Moissac', slug: 'ab', slugEdited: true } });
  try {
    const reserve = () => t.container.querySelector('form button[type="submit"]');
    assert.equal(reserve().disabled, false);
    await t.click(reserve());
    assert.equal(t.dom.window.document.activeElement.id, 'fl-slug', 'adresse trop courte : focus sur le champ');
    assert.match(t.container.querySelector('#fl-slug-msg').textContent, /3 à 32/);
    assert.match(t.container.textContent, /Votre adresse sur le circuit/, 'on reste à l’étape 3');
    // Adresse valide, vérification en cours : l'envoi attend la réponse puis avance.
    const input = t.container.querySelector('#fl-slug');
    const setter = Object.getOwnPropertyDescriptor(t.dom.window.HTMLInputElement.prototype, 'value').set;
    await t.act(async () => { setter.call(input, 'tc-nouveau'); input.dispatchEvent(new t.dom.window.Event('input', { bubbles: true })); });
    await t.click(reserve());
    assert.equal(reserve().textContent, 'Vérification…');
    // Réponse après le délai de 300 ms : on la guette (suite chargée, minuteries en retard).
    for (let i = 0; i < 40 && !/Gardez TC Nouveau/.test(t.container.textContent); i++) await t.settle(50);
    assert.match(t.container.textContent, /Gardez TC Nouveau/);
  } finally { await t.unmount(); }
});

test('P0 en-tête : « Déjà un compte ? Connexion » reste visible sous 720 px', () => {
  const css = readFileSync(join(root, 'src/components/signup/signup.css'), 'utf8');
  const mobile = css.slice(css.indexOf('@media (max-width: 719px)'));
  assert.doesNotMatch(mobile, /\.fl-head-login\s*\{\s*display:\s*none/);
});

test('P0 mobile : vignette de l’app sous le titre, qui ouvre l’aperçu complet', async () => {
  const t = await renderTunnel({ mobile: true, draft: { step: 2, mode: 'manual', name: 'TC Nouveau', city: 'Moissac', slug: 'tc-nouveau' } });
  try {
    const mini = t.container.querySelector('.fl-mini');
    assert.ok(mini, 'vignette rendue sur mobile');
    assert.equal(mini.previousElementSibling.tagName, 'H1', 'juste sous le titre');
    assert.match(mini.textContent, /app-tc-nouveau\.feelike\.pro/);
    // Coupure possible seulement après un tiret ou avant un point, jamais dans un mot.
    const host = mini.querySelector('.fl-mini-host');
    assert.deepEqual([...host.childNodes].filter(n => n.nodeType === 3).map(n => n.textContent), ['app-', 'tc-', 'nouveau', '.feelike', '.pro']);
    assert.equal(host.querySelectorAll('wbr').length, 4);
    assert.equal(t.container.querySelector('.fl-preview-toggle').textContent, 'Voir l’aperçu', 'la version complète reste');
    await t.click(mini);
    assert.equal(t.container.querySelector('.fl-preview-toggle').getAttribute('aria-expanded'), 'true');
  } finally { await t.unmount(); }
  const desktop = await renderTunnel({ draft: { step: 2, mode: 'manual', name: 'TC Nouveau', city: 'Moissac', slug: 'tc-nouveau' } });
  try { assert.equal(desktop.container.querySelector('.fl-mini'), null, 'rien de plus sur ordinateur'); } finally { await desktop.unmount(); }
});

test('P0 : accountProblem dans l’ordre de l’écran', () => {
  assert.equal(lib.accountProblem({ email: ' ', consent: true, token: 't' }).field, 'email');
  assert.match(lib.accountProblem({ email: 'a@b', consent: true, token: 't' }).message, /incomplète/);
  assert.equal(lib.accountProblem({ email: 'a@b.fr', consent: false, token: null }).field, 'consent');
  assert.equal(lib.accountProblem({ email: 'a@b.fr', consent: true, token: null }).field, 'turnstile');
  assert.equal(lib.accountProblem({ email: 'a@b.fr', consent: true, token: 't' }), null);
});

// ── Onboarding « Ten'Up d'abord », PR P1-front : écrans 01, 01b, 02, branche manuelle ─────────
const MOISSAC = {
  ok: true, tenup_club_id: '60820110', name: 'MOISSAC TENNIS CLUB', street: 'Avenue du Sarlac', postal_code: '82200', city: 'MOISSAC',
  sports: ['Tennis', 'Padel', 'Pickleball'], courts: 7,
  logo_url: 'https://x.supabase.co/storage/v1/object/public/content-images/_lookup/60820110/1-logo.png',
  banner_url: 'https://x.supabase.co/storage/v1/object/public/content-images/_lookup/60820110/1-banner.jpg',
  already_on_feelike: false, cached: false, read_at: '2026-11-15T10:00:00.000Z', lookup_token: 'eyJpZCI6IjYwODIwMTEwIn0.c2ln',
};
const LINK = 'https://tenup.fft.fr/club/60820110/offres';
const LOGO_PALETTE = ['#1f6f43', '#e3b23c', '#26302b', '#888888'];
const json = (status, body) => Response.json(body, { status });

test('P1 : lien de l’écran 01 — vide, autre site, autre page Ten’Up', () => {
  assert.equal(lib.findProblem('  '), 'Collez le lien de votre club.');
  assert.match(lib.findProblem('https://example.com/club/1'), /Copiez le lien de votre club sur Ten’Up/);
  assert.match(lib.findProblem('https://tenup.fft.fr/tournoi/123'), /n’importe quel onglet du club/);
  assert.equal(lib.findProblem(LINK), null);
  assert.equal(lib.findProblem('https://tenup.fft.fr/club/60820110'), null);
});

test('P1 : codes de tenup-lookup → état de l’écran 01', () => {
  assert.deepEqual(lib.lookupOutcome(200, MOISSAC).kind, 'found');
  assert.deepEqual(lib.lookupOutcome(200, { ok: true, tenup_club_id: '60820110', already_on_feelike: true, name: 'MOISSAC TENNIS CLUB' }),
    { kind: 'already', tenupClubId: '60820110', name: 'MOISSAC TENNIS CLUB' });
  assert.equal(lib.lookupOutcome(200, { ok: true, tenup_club_id: '60820110', already_on_feelike: true }).name, null);
  const cases = [
    [400, { reason: 'bad_link', error: 'Copiez le lien…' }, 'bad_link', /Copiez le lien/],
    [403, { reason: 'turnstile' }, 'turnstile', /^La vérification anti-robot a échoué\. Rechargez la page : votre saisie est conservée\.$/],
    [404, { reason: 'not_found' }, 'not_found', /^Nous ne trouvons pas ce club sur Ten’Up\. Vérifiez le lien, ou saisissez votre club à la main\.$/],
    [429, { reason: 'throttled' }, 'throttled', /^Trop de recherches depuis votre connexion\. Réessayez dans quelques minutes, ou continuez à la main\.$/],
    [504, { reason: 'tenup_unavailable' }, 'unavailable', /^Ten’Up ne répond pas pour le moment\. Vous pouvez réessayer, ou continuer à la main : vous pourrez importer vos équipes plus tard\.$/],
    ['network', undefined, 'unavailable', /Ten’Up ne répond pas/],
    ['offline', undefined, 'offline', /^Pas de connexion internet\. Vérifiez votre réseau puis réessayez\.$/],
    [500, {}, 'error', /momentanément indisponible/],
    [503, {}, 'error', /momentanément indisponible/],
    [200, { ok: true, name: 'X' }, 'error', /momentanément indisponible/],
  ];
  for (const [status, body, kind, message] of cases) {
    const outcome = lib.lookupOutcome(status, body);
    assert.equal(outcome.kind, kind, String(status)); assert.match(outcome.message, message, String(status));
  }
});

test('P1 : réponse de lecture assainie (brouillon compris), jamais d’URL autre que https', () => {
  const clean = lib.parseLookupResult({ ...MOISSAC, logo_url: 'javascript:alert(1)', banner_url: 'http://cmsclub.fft.fr/x.png', courts: -1, sports: ['Tennis', 3, ''], phone: '0600000000' });
  assert.equal(clean.logo_url, undefined); assert.equal(clean.banner_url, undefined); assert.equal(clean.courts, undefined);
  assert.deepEqual(clean.sports, ['Tennis']);
  assert.equal(clean.phone, undefined, 'rien d’autre que les champs attendus');
  assert.equal(lib.parseLookupResult({ ...MOISSAC, tenup_club_id: 'abc' }), null);
  assert.equal(lib.parseLookupResult({ ...MOISSAC, lookup_token: '' }), null);
});

test('P1 : carte — adresse, source, initiales, nom court', () => {
  assert.equal(lib.clubAddress('Avenue du Sarlac', '82200', 'Moissac'), 'Avenue du Sarlac, 82200 Moissac');
  assert.equal(lib.clubAddress(undefined, '82200', 'Moissac'), '82200 Moissac');
  assert.equal(lib.clubAddress(undefined, undefined, ''), '');
  assert.equal(lib.lookupSource({ cached: false, read_at: MOISSAC.read_at }), 'Infos publiques Ten’Up, lues à l’instant');
  assert.equal(lib.lookupSource({ cached: true, read_at: '2026-11-14T12:00:00.000Z' }), 'Infos publiques Ten’Up, lues le 14/11');
  assert.equal(lib.clubInitials('Moissac Tennis Club'), 'MTC');
  assert.equal(lib.clubInitials('Tennis Club de Moissac'), 'TCM');
  assert.equal(lib.clubInitials('Castelsarrasin'), 'CA');
  assert.equal(lib.shortNameProblem(' '), 'Indiquez un nom court.');
  assert.match(lib.shortNameProblem('Treize lettres'), /12 caractères/);
  assert.equal(lib.shortNameProblem('Moissac TC'), null);
});

test('P1 : adresse web — première libre parmi 3, sinon en erreur ; vérification impossible → la première', async () => {
  const taken = new Set(['moissac-tc']);
  assert.deepEqual(await lib.firstFreeSlug(['moissac-tc', 'moissac-tc-2', 'moissac-tc-3'], async (s) => !taken.has(s)),
    { slug: 'moissac-tc-2', check: { state: 'available' } });
  const asked = [];
  assert.deepEqual(await lib.firstFreeSlug(['a-tc', 'a-tc-ville', 'a-tc-2', 'a-tc-3'], async (s) => { asked.push(s); return false; }),
    { slug: 'a-tc', check: { state: 'unavailable', reason: 'taken' } });
  assert.deepEqual(asked, ['a-tc', 'a-tc-ville', 'a-tc-2'], 'trois essais au plus');
  assert.deepEqual(await lib.firstFreeSlug(['moissac-tc'], async () => null), { slug: 'moissac-tc', check: { state: 'error' } });
});

test('P1 : en-tête « Étape X sur N » — 3 écrans en Ten’Up, 5 en branche manuelle', () => {
  assert.deepEqual(lib.stepPosition({ step: 'find', mode: 'tenup' }), { index: 1, total: 3 });
  assert.deepEqual(lib.stepPosition({ step: 'confirm', mode: 'tenup' }), { index: 2, total: 3 });
  assert.deepEqual(lib.stepPosition({ step: 'account', mode: 'tenup' }), { index: 3, total: 3 });
  assert.deepEqual(lib.stepPosition({ step: 1, mode: 'manual' }), { index: 2, total: 5 });
  assert.deepEqual(lib.stepPosition({ step: 3, mode: 'manual' }), { index: 4, total: 5 });
  assert.deepEqual(lib.stepPosition({ step: 'account', mode: 'manual' }), { index: 5, total: 5 });
  assert.equal(lib.stepPosition({ step: 'already', mode: 'tenup' }), null);
});

test('P1 : club-signup — jeton de lecture et nom court envoyés ; 409 déjà sur feelike, 400 lecture expirée', () => {
  const form = lib.signupForm({ name: 'Moissac Tennis Club', city: 'Moissac', slug: 'moissac-tc', color: '#1f6f43', email: 'a@b.fr', turnstileToken: 't', lookupToken: 'jeton', shortName: ' Moissac TC ' });
  assert.equal(form.get('lookup_token'), 'jeton'); assert.equal(form.get('short_name'), 'Moissac TC');
  assert.equal(lib.signupForm({ name: 'a', city: 'b', slug: 'abc', color: '#000000', email: 'a@b.fr', turnstileToken: 't' }).get('lookup_token'), null);
  const already = lib.signupOutcome(409, { reason: 'already_on_feelike' });
  assert.equal(already.lookup, 'already'); assert.equal(already.slugReason, undefined);
  assert.equal(lib.signupOutcome(409, { reason: 'taken' }).lookup, undefined, 'adresse prise : comme avant');
  const expired = lib.signupOutcome(400, { reason: 'lookup_expired' });
  assert.equal(expired.lookup, 'expired'); assert.match(expired.message, /expiré/); assert.equal(expired.resetTurnstile, true);
});

test('P1 : brouillon — nouveaux champs, brouillon d’avant P1 repris en branche manuelle', () => {
  const storage = memoryStorage();
  assert.equal(lib.emptyDraft().step, 'find'); assert.equal(lib.emptyDraft().mode, 'tenup');
  const draft = { ...lib.emptyDraft(), step: 'confirm', tenupUrl: LINK, tenup: lib.parseLookupResult(MOISSAC), name: 'Moissac Tennis Club', city: 'Moissac', shortName: 'Moissac TC', slug: 'moissac-tc' };
  lib.saveDraft(storage, draft);
  assert.deepEqual(lib.loadDraft(storage), draft);
  storage.setItem(lib.DRAFT_KEY, JSON.stringify({ ...draft, tenup: { name: 'sans jeton' } }));
  assert.equal(lib.loadDraft(storage).step, 'find', 'carte sans club lisible → on retrouve le club');
  storage.setItem(lib.DRAFT_KEY, JSON.stringify({ step: 4, name: 'TC Nouveau', city: 'Moissac', slug: 'tc-nouveau' }));
  const legacy = lib.loadDraft(storage);
  assert.equal(legacy.step, 'account'); assert.equal(legacy.mode, 'manual'); assert.equal(legacy.name, 'TC Nouveau');
});

test('P1 : lien Ten’Up de la branche manuelle, gardé pour l’étape Équipes de CE club', () => {
  const storage = memoryStorage();
  lib.rememberTenupLink(storage, 'tc-nouveau', LINK);
  assert.equal(lib.rememberedTenupLink(storage, 'tc-nouveau'), 'https://tenup.fft.fr/club/60820110/competitions/rencontres');
  assert.equal(lib.rememberedTenupLink(storage, 'autre-club'), null);
  lib.rememberTenupLink(storage, 'tc-x', 'https://example.com');
  assert.equal(lib.rememberedTenupLink(storage, 'tc-x'), null, 'lien invalide : rien n’est écrit');
});

/** Réponses simulées : `tenup-lookup` → `lookup`, `club-signup` → `signup` (fonctions ou réponses). */
const network = ({ lookup = () => json(200, MOISSAC), signup = () => json(200, { ok: true }) } = {}) =>
  (entry) => (entry.kind === 'lookup' ? lookup(entry) : signup(entry));

test('P1 parcours Ten’Up complet : lien → carte préremplie → e-mail → club-signup avec jeton et nom court', async () => {
  const t = await renderTunnel({ turnstileToken: 'jeton', respond: network(), palette: LOGO_PALETTE });
  try {
    const text = () => t.container.textContent;
    assert.match(text(), /Étape 1 sur 3/);
    assert.equal(t.container.querySelectorAll('.fl-bar span').length, 3);
    assert.match(text(), /Retrouvons votre club/);
    const field = t.container.querySelector('#fl-tenup-url');
    assert.deepEqual(['type', 'inputmode', 'autocomplete', 'autocapitalize', 'spellcheck'].map(a => field.getAttribute(a)), ['url', 'url', 'off', 'none', 'false']);
    assert.equal(t.container.querySelectorAll('[placeholder]').length, 0);
    assert.equal(document.querySelector('label[for="fl-tenup-url"]').textContent, 'Lien de votre club sur Ten’Up');
    assert.match(t.container.querySelector('#fl-tenup-help').textContent, /N’importe quelle page de votre club sur tenup\.fft\.fr fait l’affaire\./);
    const help = t.container.querySelector('details.fl-help');
    assert.equal(help.querySelector('summary').textContent, 'Où trouver ce lien ?');
    assert.doesNotMatch(help.textContent, /app Ten’Up|Partager/, 'l’aide ne parle que de tenup.fft.fr');
    assert.equal(t.widgets[0].appearance, 'interaction-only');

    // Coller valide sans lire.
    await t.type('fl-tenup-url', LINK, { paste: true });
    assert.equal(t.requests.length, 0, 'coller ne lance pas la lecture');
    await t.click(t.button('Trouver mon club'));
    await t.settle();
    assert.equal(t.requests.length, 1);
    assert.deepEqual(t.requests[0].body, { url: LINK, turnstile_token: 'jeton-1' });

    // 02 : la carte.
    assert.match(text(), /Étape 2 sur 3/);
    assert.equal(document.activeElement.tagName, 'H1', 'focus sur le titre à l’arrivée');
    assert.equal(document.activeElement.textContent, 'C’est bien votre club\u00a0?');
    const card = t.container.querySelector('section.fl-card');
    assert.equal(card.getAttribute('aria-labelledby'), 'fl-card-name');
    assert.equal(card.querySelector('#fl-card-name').textContent, 'Moissac Tennis Club');
    assert.match(card.textContent, /Avenue du Sarlac, 82200 Moissac/);
    assert.deepEqual([...card.querySelectorAll('.fl-card-chips li')].map(li => li.textContent), ['Tennis', 'Padel', 'Pickleball']);
    assert.match(card.textContent, /7 terrains/);
    assert.match(card.textContent, /Infos publiques Ten’Up, lues à l’instant/);
    assert.doesNotMatch(card.innerHTML, /cmsclub/);
    assert.ok([...card.querySelectorAll('img')].every(img => img.getAttribute('alt') === ''), 'images décoratives');
    assert.ok(card.querySelector('.fl-skeleton'), 'squelette tant que les images chargent');
    // Couleur : 3 teintes du logo, la première choisie.
    const group = t.container.querySelector('[role="radiogroup"]');
    const radios = [...group.querySelectorAll('[role="radio"]')];
    assert.deepEqual(radios.map(r => r.getAttribute('aria-label')), ['Couleur 1 : #1f6f43', 'Couleur 2 : #e3b23c', 'Couleur 3 : #26302b']);
    assert.deepEqual(radios.map(r => r.getAttribute('aria-checked')), ['true', 'false', 'false']);
    assert.deepEqual(radios.map(r => r.tabIndex), [0, -1, -1], 'un seul arrêt de tabulation');
    // Nom court et adresse courte dérivée.
    assert.match(text(), /Nom court · écran d’accueilMoissac TC/);
    assert.match(text(), /Adresse webmoissac-tc\.feelike\.pro/);
    assert.deepEqual(t.rpcs, ['moissac-tc']);

    // Tout reste modifiable : couleur au clavier, nom court (l'adresse suit), le nom.
    await t.act(async () => radios[0].dispatchEvent(new t.dom.window.KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true })));
    await t.flush();
    assert.deepEqual([...group.querySelectorAll('[role="radio"]')].map(r => r.getAttribute('aria-checked')), ['false', 'true', 'false']);
    assert.equal(document.activeElement.getAttribute('aria-label'), 'Couleur 2 : #e3b23c');
    await t.click(t.container.querySelector('[aria-label="Modifier le nom court"]'));
    assert.equal(t.container.querySelector('#fl-short').maxLength, 12);
    await t.type('fl-short', 'Moissac');
    assert.match(t.container.querySelector('#fl-short-count').textContent, /7 \/ 12/);
    await t.settle();
    assert.match(text(), /Adresse webmoissac\.feelike\.pro/, 'adresse dérivée du nom court modifié');

    await t.click(t.button('Oui, c’est mon club'));
    // 03 : l'accès.
    assert.match(text(), /Étape 3 sur 3/);
    assert.equal(t.container.querySelector('h1').textContent, 'Gardez Moissac');
    assert.equal(t.container.querySelector('.fl-lede').textContent, 'Votre e-mail sert à vous reconnecter. Pas de mot de passe, pas de carte bancaire.');
    await t.type('fl-email', 'president@moissac-tc.fr');
    await t.click(t.container.querySelector('#fl-consent'));
    await t.click(t.button('Créer mon club · 30 jours offerts'));
    await t.settle(10);
    const signup = t.requests.find(r => r.kind === 'signup');
    assert.ok(signup, 'club-signup appelé');
    const fields = Object.fromEntries([...signup.form.entries()].filter(([, v]) => typeof v === 'string'));
    assert.deepEqual(fields, { name: 'Moissac Tennis Club', city: 'Moissac', sport: 'tennis', slug: 'moissac', color: '#e3b23c',
      email: 'president@moissac-tc.fr', turnstile_token: fields.turnstile_token, lookup_token: MOISSAC.lookup_token, short_name: 'Moissac' });
    assert.equal(signup.form.get('logo'), null, 'logo et bandeau copiés par le serveur, rien d’envoyé');
    assert.equal(signup.form.get('photo'), null);
    assert.equal(signup.form.get('tenup_url'), null, 'le lien Ten’Up n’est jamais envoyé');
    assert.match(text(), /Un lien vous attend/);
  } finally { await t.unmount(); }
});

test('P1 écran 01 : envoi vide ou mauvais lien → message sous le champ, focus, aucune requête ; bouton jamais grisé', async () => {
  const t = await renderTunnel({ turnstileToken: 'jeton', respond: network() });
  try {
    const submit = () => t.button('Trouver mon club');
    assert.equal(submit().disabled, false);
    await t.click(submit());
    assert.equal(t.container.querySelector('#fl-tenup-error').textContent, 'Collez le lien de votre club.');
    const field = t.container.querySelector('#fl-tenup-url');
    assert.equal(field.getAttribute('aria-invalid'), 'true');
    assert.equal(field.getAttribute('aria-describedby'), 'fl-tenup-help fl-tenup-error');
    assert.equal(document.activeElement.id, 'fl-tenup-url');
    await t.type('fl-tenup-url', 'https://tenup.fft.fr/tournoi/82123', { paste: true });
    assert.match(t.container.querySelector('#fl-tenup-error').textContent, /^Copiez le lien de votre club sur Ten’Up : https:\/\/tenup\.fft\.fr\/club\/… \(n’importe quel onglet du club\)\.$/, 'validé au collage');
    await t.click(submit());
    assert.deepEqual(t.requests, [], 'aucune requête');
    // « Saisir à la main » toujours proposé en pied (bouton-lien).
    assert.match(t.container.querySelector('.fl-foot').textContent, /Club non affilié à la FFT \? Saisir à la main/);
  } finally { await t.unmount(); }
});

test('P1 écran 01 : lecture en cours — bouton occupé, champ en lecture seule, ligne d’attente après 3 s', async () => {
  let release;
  const t = await renderTunnel({ turnstileToken: 'jeton', respond: network({ lookup: () => new Promise(r => { release = () => r(json(200, MOISSAC)); }) }) });
  try {
    await t.type('fl-tenup-url', LINK);
    await t.click(t.button('Trouver mon club'));
    const busy = t.container.querySelector('button[type="submit"]');
    assert.equal(busy.textContent, 'Recherche de votre club…');
    assert.equal(busy.getAttribute('aria-busy'), 'true');
    assert.ok(busy.querySelector('.fl-spin'));
    assert.equal(t.container.querySelector('#fl-tenup-url').readOnly, true);
    const status = t.container.querySelector('.fl-slow');
    assert.equal(status.getAttribute('role'), 'status');
    assert.equal(status.textContent, '');
    await t.settle(3100);
    assert.equal(status.textContent, 'Ten’Up met un peu de temps à répondre…');
    await t.act(async () => release());
    await t.settle(10);
    assert.match(t.container.textContent, /C’est bien votre club\u00a0\?/);
  } finally { await t.unmount(); }
});

test('P1 écran 01 : introuvable, trop de demandes, anti-robot, erreur — messages et repli manuel', async () => {
  for (const [status, message, manual] of [
    [404, /Nous ne trouvons pas ce club sur Ten’Up/, true],
    [429, /Trop de recherches depuis votre connexion/, true],
    [403, /La vérification anti-robot a échoué\. Rechargez la page/, false],
    [500, /momentanément indisponible/, true],
  ]) {
    const t = await renderTunnel({ turnstileToken: 'jeton', respond: network({ lookup: () => json(status, { reason: 'x' }) }) });
    try {
      await t.type('fl-tenup-url', LINK);
      await t.click(t.button('Trouver mon club'));
      await t.settle(10);
      assert.match(t.container.querySelector('#fl-tenup-error').textContent, message, String(status));
      assert.equal(t.container.querySelector('#fl-tenup-error').getAttribute('role'), 'alert');
      // Seul un club introuvable met le lien en cause (WCAG 3.3.1) ; 429 / 403 / 500 ne disent rien du lien.
      assert.equal(t.container.querySelector('#fl-tenup-url').getAttribute('aria-invalid'), String(status === 404), `${status} : aria-invalid`);
      assert.equal(document.activeElement.id, 'fl-tenup-url', 'focus sur le champ');
      assert.equal(Boolean(t.container.querySelector('.fl-field .fl-ghost')), manual, `${status} : « Saisir à la main » sous le champ`);
      assert.equal(t.widgets.length, 1); assert.equal(t.requests.length, 1);
      if (status === 404) {
        await t.click(t.container.querySelector('.fl-field .fl-ghost'));
        assert.match(t.container.textContent, /Comment s’appelle votre club\u00a0\?/);
        assert.equal(t.container.querySelector('#fl-club').value, '', 'le nom n’est pas connu, rien à reporter');
      }
    } finally { await t.unmount(); }
  }
});

test('P1 écran 01 : hors ligne → message, aucune requête ; Ten’Up injoignable → Réessayer, ou M1 avec le lien gardé jusqu’à l’étape Équipes', async () => {
  const offline = await renderTunnel({ turnstileToken: 'jeton', respond: network(), online: false });
  try {
    await offline.type('fl-tenup-url', LINK);
    await offline.click(offline.button('Trouver mon club'));
    assert.equal(offline.container.querySelector('#fl-tenup-error').textContent, 'Pas de connexion internet. Vérifiez votre réseau puis réessayez.');
    assert.equal(offline.container.querySelector('#fl-tenup-url').getAttribute('aria-invalid'), 'false', 'hors ligne : le lien n’est pas en cause');
    assert.deepEqual(offline.requests, []);
    assert.ok(offline.button('Réessayer'));
  } finally { await offline.unmount(); }

  let calls = 0;
  const t = await renderTunnel({ turnstileToken: 'jeton', respond: network({ lookup: () => (++calls === 1 ? json(504, { reason: 'tenup_unavailable' }) : Promise.reject(new TypeError('Failed to fetch'))) }) });
  try {
    await t.type('fl-tenup-url', LINK);
    await t.click(t.button('Trouver mon club'));
    await t.settle(10);
    assert.match(t.container.querySelector('#fl-tenup-error').textContent, /^Ten’Up ne répond pas pour le moment\./);
    assert.equal(t.container.querySelector('#fl-tenup-url').getAttribute('aria-invalid'), 'false', '504 : le lien n’est pas en cause');
    assert.equal(t.button('Réessayer').className, 'fl-cta fl-cta-wide', 'Réessayer en principal');
    assert.equal(t.button('Continuer à la main').className, 'fl-ghost fl-cta-wide', 'Continuer à la main en secondaire');
    await t.click(t.button('Réessayer'));
    await t.settle(10);
    assert.equal(calls, 2);
    assert.deepEqual(t.requests.map(r => r.body.turnstile_token), ['jeton-1', 'jeton-2'], 'jeton neuf à chaque lecture');
    assert.match(t.container.querySelector('#fl-tenup-error').textContent, /Ten’Up ne répond pas/, 'coupure réseau : même message');
    await t.click(t.button('Continuer à la main'));
    // M1 : branche manuelle, 5 étapes, lien gardé ; « Retrouver mon club sur Ten’Up » ramène à 01.
    assert.match(t.container.textContent, /Étape 2 sur 5/);
    assert.equal(JSON.parse(t.saved()).tenupUrl, LINK);
    assert.equal(JSON.parse(t.saved()).mode, 'manual');
    await t.click(t.button('← Retrouver mon club sur Ten’Up'));
    assert.equal(t.container.querySelector('#fl-tenup-url').value, LINK, 'lien conservé');
    await t.click(t.container.querySelector('.fl-foot button'));
    await t.type('fl-club', 'TC Nouveau'); await t.type('fl-city', 'Moissac');
    await t.click(t.button('Continuer'));
    assert.match(t.container.textContent, /Étape 3 sur 5/);
    await t.click(t.button('Continuer'));
    await t.settle();
    assert.match(t.container.textContent, /Étape 4 sur 5/);
    await t.click(t.button('Réserver cette adresse'));
    assert.match(t.container.textContent, /Étape 5 sur 5/);
    assert.equal(t.container.querySelector('h1').textContent, 'Gardez TC Nouveau');
    await t.type('fl-email', 'president@club.fr');
    await t.click(t.container.querySelector('#fl-consent'));
    await t.click(t.button('Créer mon club · 30 jours offerts'));
    await t.settle(10);
    const signup = t.requests.find(r => r.kind === 'signup');
    assert.equal(signup.form.get('name'), 'TC Nouveau');
    assert.equal(signup.form.get('lookup_token'), null);
    assert.equal(signup.form.get('tenup_url'), null, 'jamais envoyé à club-signup (P1-back ne le traite pas)');
    assert.equal(lib.rememberedTenupLink(t.dom.window.localStorage, 'tc-nouveau'), 'https://tenup.fft.fr/club/60820110/competitions/rencontres');
    assert.match(t.container.textContent, /Un lien vous attend/);
  } finally { await t.unmount(); }
});

test('P1 écran 01b : club déjà sur feelike — pas de support, Se connecter, Ce n’est pas mon club', async () => {
  const t = await renderTunnel({ turnstileToken: 'jeton', respond: network({ lookup: () => json(200, { ok: true, tenup_club_id: '60820110', already_on_feelike: true, name: 'MOISSAC TENNIS CLUB' }) }) });
  try {
    await t.type('fl-tenup-url', LINK);
    await t.click(t.button('Trouver mon club'));
    await t.settle(10);
    assert.equal(t.container.querySelector('h1').textContent, 'Moissac Tennis Club a déjà son espace feelike');
    assert.equal(document.activeElement.tagName, 'H1');
    assert.match(t.container.textContent, /Un responsable de votre club l’a déjà créé\. Demandez-lui de vous inviter depuis le back-office \(Membres › Inviter\), ou connectez-vous si c’est vous\./);
    assert.equal(t.button('Se connecter').getAttribute('href'), '/login');
    assert.doesNotMatch(t.container.innerHTML, /mailto:|support/i, 'aucune adresse de support');
    await t.click(t.button('Ce n’est pas mon club'));
    assert.match(t.container.textContent, /Retrouvons votre club/);
    assert.equal(t.container.querySelector('#fl-tenup-url').value, '', 'champ vidé');
  } finally { await t.unmount(); }
});

test('P1 écran 02 : « Ce n’est pas le bon club » ; adresse courte prise → variante ; 3 prises → ligne en erreur et champ ouvert', async () => {
  const taken = new Set(['moissac-tc']);
  const t = await renderTunnel({ turnstileToken: 'jeton', respond: network(), available: (slug) => !taken.has(slug) });
  try {
    await t.type('fl-tenup-url', LINK);
    await t.click(t.button('Trouver mon club'));
    await t.settle();
    assert.match(t.container.textContent, /Adresse webmoissac-tc-2\.feelike\.pro/);
    assert.deepEqual(t.rpcs, ['moissac-tc', 'moissac-tc-2']);
    // Sans logo lisible (palette vide) : les échantillons, le premier choisi.
    assert.deepEqual([...t.container.querySelectorAll('[role="radio"]')].map(r => r.getAttribute('aria-label')), ['Rouge : #c8102e', 'Vert : #1f6b4a', 'Bleu marine : #1d3f8f']);
    assert.equal(t.container.querySelector('[role="radio"][aria-checked="true"]').getAttribute('aria-label'), 'Rouge : #c8102e');
    await t.click(t.button('Ce n’est pas le bon club'));
    assert.match(t.container.textContent, /Retrouvons votre club/);
    assert.equal(t.container.querySelector('#fl-tenup-url').value, '');
  } finally { await t.unmount(); }

  const full = await renderTunnel({ turnstileToken: 'jeton', respond: network(), available: () => false });
  try {
    await full.type('fl-tenup-url', LINK);
    await full.click(full.button('Trouver mon club'));
    await full.settle();
    assert.equal(full.rpcs.length, 3, 'trois essais au plus');
    const slug = full.container.querySelector('#fl-slug');
    assert.ok(slug, 'champ ouvert');
    assert.equal(slug.getAttribute('aria-invalid'), 'true');
    assert.match(full.container.querySelector('#fl-slug-msg').textContent, /déjà prise/);
    assert.match(full.container.querySelector('#fl-slug-app').textContent, /Votre app : app-moissac-tc\.feelike\.pro/);
    // Le bouton reste actif : l'envoi met le focus sur la ligne en erreur.
    await full.click(full.button('Oui, c’est mon club'));
    await full.act(async () => { await new Promise(r => setTimeout(r, 30)); });
    assert.equal(document.activeElement.id, 'fl-slug');
    assert.match(full.container.textContent, /C’est bien votre club\u00a0\?/);
    await full.type('fl-slug', 'moissac-82');
    await full.settle();
    assert.match(full.container.querySelector('#fl-slug-msg').textContent, /✕/, 'toujours prise selon la base simulée');
  } finally { await full.unmount(); }
});

test('P1 écran 02 : nom court vidé → message et focus ; nom modifié → nom court recalculé', async () => {
  const t = await renderTunnel({ turnstileToken: 'jeton', respond: network() });
  try {
    await t.type('fl-tenup-url', LINK);
    await t.click(t.button('Trouver mon club'));
    await t.settle();
    await t.click(t.button('Modifier le nom'));
    await t.type('fl-club', 'Tennis Club de Moissac');
    assert.match(t.container.textContent, /Nom court · écran d’accueilMoissacModifier/, 'recalculé par shortNameFor (était Moissac TC)');
    await t.click(t.container.querySelector('[aria-label="Modifier le nom court"]'));
    await t.type('fl-short', '');
    await t.click(t.button('Oui, c’est mon club'));
    await t.act(async () => { await new Promise(r => setTimeout(r, 30)); });
    assert.equal(t.container.querySelector('#fl-short-error').textContent, 'Indiquez un nom court.');
    assert.equal(document.activeElement.id, 'fl-short');
    assert.equal(document.activeElement.getAttribute('aria-describedby'), 'fl-short-count fl-short-error');
  } finally { await t.unmount(); }
});

test('P1 : brouillon conservé au rechargement, en 01 comme en 02', async () => {
  const t = await renderTunnel({ turnstileToken: 'jeton', respond: network(), palette: LOGO_PALETTE });
  let raw;
  try {
    await t.type('fl-tenup-url', LINK);
    raw = t.saved();
    assert.equal(JSON.parse(raw).tenupUrl, LINK);
  } finally { await t.unmount(); }
  const again = await renderTunnel({ rawDraft: raw, turnstileToken: 'jeton', respond: network(), palette: LOGO_PALETTE });
  try {
    assert.equal(again.container.querySelector('#fl-tenup-url').value, LINK, 'lien gardé au rechargement de 01');
    await again.click(again.button('Trouver mon club'));
    await again.settle();
    await again.click(again.container.querySelector('[aria-label="Modifier le nom court"]'));
    await again.type('fl-short', 'MTC');
    await again.settle();
    raw = again.saved();
  } finally { await again.unmount(); }
  const third = await renderTunnel({ rawDraft: raw, turnstileToken: 'jeton', respond: network(), palette: LOGO_PALETTE });
  try {
    assert.match(third.container.textContent, /C’est bien votre club\u00a0\?/, 'retour sur la carte, sans relire Ten’Up');
    assert.deepEqual(third.requests, []);
    assert.match(third.container.textContent, /Nom court · écran d’accueilMTC/);
    assert.match(third.container.textContent, /Adresse webmtc\.feelike\.pro/);
    assert.equal(third.container.querySelector('[role="radio"][aria-checked="true"]').getAttribute('aria-label'), 'Couleur 1 : #1f6f43');
  } finally { await third.unmount(); }
});

test('P1 écran 03 : 409 déjà sur feelike → 01b ; 400 lecture expirée → 01 avec le lien, puis la carte avec les retouches', async () => {
  for (const [body, expect] of [[{ reason: 'already_on_feelike' }, 'already'], [{ reason: 'lookup_expired' }, 'expired']]) {
    const t = await renderTunnel({ turnstileToken: 'jeton', respond: network({ signup: () => json(body.reason === 'lookup_expired' ? 400 : 409, body) }) });
    try {
      await t.type('fl-tenup-url', LINK);
      await t.click(t.button('Trouver mon club'));
      await t.settle();
      await t.click(t.container.querySelector('[aria-label="Modifier le nom court"]'));
      await t.type('fl-short', 'MTC');
      await t.settle();
      await t.click(t.button('Oui, c’est mon club'));
      await t.type('fl-email', 'a@b.fr');
      await t.click(t.container.querySelector('#fl-consent'));
      await t.click(t.button('Créer mon club · 30 jours offerts'));
      await t.settle(10);
      if (expect === 'already') {
        assert.equal(t.container.querySelector('h1').textContent, 'Moissac Tennis Club a déjà son espace feelike');
      } else {
        assert.match(t.container.textContent, /Retrouvons votre club/);
        assert.match(t.container.querySelector('.fl-alert').textContent, /expiré/);
        assert.equal(t.container.querySelector('#fl-tenup-url').value, LINK);
        await t.click(t.button('Trouver mon club'));
        await t.settle();
        assert.equal(t.requests.filter(r => r.kind === 'lookup').length, 2, 'lecture relancée');
        assert.match(t.container.textContent, /Nom court · écran d’accueilMTC/, 'retouches gardées pour le même club');
      }
    } finally { await t.unmount(); }
  }
});

test('P1 mobile : bouton principal collé en bas dans le flux, pas de vignette jusqu’à la carte comprise', async () => {
  const css = readFileSync(join(root, 'src/components/signup/signup.css'), 'utf8');
  const mobile = css.slice(css.indexOf('@media (max-width: 719px)'));
  assert.match(mobile, /\.fl-sticky \{ position: sticky; bottom: 0;/);
  assert.doesNotMatch(css, /position: fixed/);
  const t = await renderTunnel({ mobile: true, turnstileToken: 'jeton', respond: network() });
  try {
    assert.equal(t.container.querySelector('.fl-mini'), null, 'rien à montrer avant le club');
    assert.ok(t.container.querySelector('.fl-sticky button[type="submit"]'));
    await t.type('fl-tenup-url', LINK);
    await t.click(t.button('Trouver mon club'));
    await t.settle();
    assert.ok(t.container.textContent.includes('C’est bien votre club\u00a0?'));
    // Ses rencontres d'exemple passeraient pour le vrai calendrier du club.
    assert.equal(t.container.querySelector('.fl-mini'), null, 'pas de vignette sur la carte');
  } finally { await t.unmount(); }
});
