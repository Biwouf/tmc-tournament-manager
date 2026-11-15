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
  assert.equal(draft.step, 1); assert.equal(draft.color, lib.BRAND_FALLBACK); assert.deepEqual(draft.palette, ['#123456']);
  assert.equal(draft.sample, null); assert.equal(draft.slug, 'mon-club'); assert.equal(draft.logo, null); assert.equal(draft.name, '');
  storage.setItem(lib.DRAFT_KEY, JSON.stringify({ step: 'sent' }));
  assert.equal(lib.loadDraft(storage).step, 4, 'confirmation sans envoi connu → étape 4');
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
async function renderTunnel({ draft, mobile = false, turnstileToken = null }) {
  const { JSDOM } = await import('jsdom');
  const ts = (await import('typescript')).default;
  const vm = await import('node:vm');
  const { createRequire } = await import('node:module');
  const { dirname, resolve } = await import('node:path');
  const { existsSync } = await import('node:fs');
  const req = createRequire(join(root, 'package.json'));
  const dom = new JSDOM('<div id="root"></div>', { url: 'https://admin.feelike.pro/inscription', pretendToBeVisual: true });
  Object.assign(globalThis, { window: dom.window, document: dom.window.document, IS_REACT_ACT_ENVIRONMENT: true });
  globalThis.ResizeObserver = class { observe() {} disconnect() {} };
  dom.window.matchMedia = () => ({ matches: mobile, addEventListener() {}, removeEventListener() {} });
  dom.window.scrollTo = () => {};
  dom.window.HTMLElement.prototype.scrollIntoView = function () {};
  if (draft) dom.window.sessionStorage.setItem(lib.DRAFT_KEY, JSON.stringify({ ...lib.emptyDraft(), ...draft }));
  const requests = [];
  globalThis.fetch = async (url, init) => { requests.push({ url, form: init.body }); return Response.json({ ok: true }); };
  // Turnstile simulé : `interaction-only` attendu, jeton remis (ou non) dès le rendu.
  const widgets = [];
  dom.window.turnstile = { render: (el, options) => { widgets.push(options); if (turnstileToken) options.callback(turnstileToken); return 'w1'; }, reset() {}, remove() {} };
  const env = JSON.stringify({ DEV: true, VITE_SUPABASE_URL: 'https://x.supabase.co' });
  const cache = new Map();
  function read(file) {
    if (cache.has(file)) return cache.get(file).exports;
    const mod = { exports: {} }; cache.set(file, mod);
    const code = ts.transpileModule(readFileSync(file, 'utf8').replaceAll('import.meta.env', env), { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX, esModuleInterop: true } }).outputText;
    const require = (name) => {
      if (name.endsWith('.css') || name.startsWith('@fontsource')) return {};
      if (name.endsWith('/lib/supabase')) return { supabase: { rpc: async () => ({ data: { available: true }, error: null }) } };
      if (!name.startsWith('.')) return req(name);
      const p = resolve(dirname(file), name);
      return read([p, `${p}.ts`, `${p}.tsx`, `${p}.mjs`].find(existsSync));
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
  const button = (name) => [...container.querySelectorAll('button')].find(b => b.textContent === name);
  const click = async (el) => { await act(async () => el.click()); await flush(); };
  return { dom, container, requests, widgets, button, click, flush, act, unmount: () => act(async () => rootNode.unmount()) };
}

test('P0 étape 1 : ni champ Sport ni placeholder d’exemple, nom en casse réelle ; club-signup reçoit tennis', async () => {
  const t = await renderTunnel({});
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
  const t = await renderTunnel({ draft: { step: 2, name: 'TC Nouveau', city: 'Moissac', slug: 'tc-nouveau' } });
  try {
    assert.equal(t.button('Continuer').className, 'fl-cta');
    assert.equal(t.button('Passer cette étape').className, 'fl-link');
    await t.click(t.button(lib.COLOR_SAMPLES[1].label));
    assert.equal(t.button('Passer cette étape'), undefined, 'une couleur choisie : seulement Continuer');
    assert.equal(t.button('Continuer').className, 'fl-cta');
  } finally { await t.unmount(); }
});

test('P0 étape 4 : bouton jamais grisé ; envoi incomplet → message et focus sur le manque, aucune requête', async () => {
  const t = await renderTunnel({ draft: { step: 4, name: 'TC Nouveau', city: 'Moissac', slug: 'tc-nouveau' } });
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
    assert.equal(message('turnstile'), '', 'message retiré quand le jeton arrive');
    await t.click(submit());
    assert.equal(t.requests.length, 1);
    assert.equal(t.requests[0].form.get('sport'), 'tennis');
    assert.equal(t.requests[0].form.get('email'), 'president@club.fr');
  } finally { await t.unmount(); }
});

test('P0 étape 1 : bouton jamais grisé ; nom ou ville manquant → message sous le champ et focus, on reste', async () => {
  const t = await renderTunnel({});
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
  const t = await renderTunnel({ draft: { step: 3, name: 'TC Nouveau', city: 'Moissac', slug: 'ab', slugEdited: true } });
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
    await t.act(async () => { await new Promise(r => setTimeout(r, 400)); });
    await t.flush();
    assert.match(t.container.textContent, /Gardez votre club/);
  } finally { await t.unmount(); }
});

test('P0 en-tête : « Déjà un compte ? Connexion » reste visible sous 720 px', () => {
  const css = readFileSync(join(root, 'src/components/signup/signup.css'), 'utf8');
  const mobile = css.slice(css.indexOf('@media (max-width: 719px)'));
  assert.doesNotMatch(mobile, /\.fl-head-login\s*\{\s*display:\s*none/);
});

test('P0 mobile : vignette de l’app sous le titre, qui ouvre l’aperçu complet', async () => {
  const t = await renderTunnel({ mobile: true, draft: { step: 2, name: 'TC Nouveau', city: 'Moissac', slug: 'tc-nouveau' } });
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
  const desktop = await renderTunnel({ draft: { step: 2, name: 'TC Nouveau', city: 'Moissac', slug: 'tc-nouveau' } });
  try { assert.equal(desktop.container.querySelector('.fl-mini'), null, 'rien de plus sur ordinateur'); } finally { await desktop.unmount(); }
});

test('P0 : accountProblem dans l’ordre de l’écran', () => {
  assert.equal(lib.accountProblem({ email: ' ', consent: true, token: 't' }).field, 'email');
  assert.match(lib.accountProblem({ email: 'a@b', consent: true, token: 't' }).message, /incomplète/);
  assert.equal(lib.accountProblem({ email: 'a@b.fr', consent: false, token: null }).field, 'consent');
  assert.equal(lib.accountProblem({ email: 'a@b.fr', consent: true, token: null }).field, 'turnstile');
  assert.equal(lib.accountProblem({ email: 'a@b.fr', consent: true, token: 't' }), null);
});
