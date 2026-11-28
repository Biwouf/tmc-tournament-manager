// P1-b du brief « Mon compte » : feuille photo, année de naissance, mineurs, recadrage, export,
// envoi (progression, échec, reprise), toasts « Annuler », corbeille des anciennes versions.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { createRequire } from 'node:module';
import vm from 'node:vm';
import ts from 'typescript';
import { JSDOM } from 'jsdom';

const req = createRequire(new URL('../pwa/package.json', import.meta.url));
const dom = new JSDOM('<div id="root"></div>', { url: 'http://localhost/profil' });
const { window } = dom;
globalThis.window = window;
globalThis.document = window.document;
globalThis.HTMLElement = window.HTMLElement;
globalThis.localStorage = window.localStorage;
globalThis.IS_REACT_ACT_ENVIRONMENT = true;
window.HTMLDialogElement.prototype.showModal = function () { this.setAttribute('open', ''); };
window.HTMLDialogElement.prototype.close = function () { this.removeAttribute('open'); };
const React = req('react'), { act, createElement: h } = React;
const { createRoot } = req('react-dom/client');
const { MemoryRouter } = req('react-router-dom');
const { QueryClient, QueryClientProvider } = req('@tanstack/react-query');
const src = resolve(new URL('../pwa/src', import.meta.url).pathname);
const YEAR = Number(new Intl.DateTimeFormat('fr-FR', { timeZone: 'Europe/Paris', year: 'numeric' }).format(new Date()));
const ME = '11111111-1111-4111-8111-111111111111';
const OLD = `${ME}/aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa`;

// ── Navigateur simulé : décodage, canvas, envoi ────────────────────────────

const browser = { webp: true, draws: [], blobs: [] };
globalThis.createImageBitmap = async (file, options) => {
  assert.equal(options?.imageOrientation, 'from-image');
  if (file.name === 'casse.jpg') throw new Error('decode');
  const [width, height] = file.name === 'petite.jpg' ? [150, 300] : [4032, 3024];
  return { width, height, close() {} };
};
window.HTMLCanvasElement.prototype.getContext = function () {
  const canvas = this;
  return { canvas, fillRect() {}, drawImage: (...args) => browser.draws.push({ width: canvas.width, args }) };
};
window.HTMLCanvasElement.prototype.toBlob = function (done, type, quality) {
  // Safari sans WebP : un PNG à la place.
  const out = type === 'image/webp' && !browser.webp ? 'image/png' : type;
  browser.blobs.push({ width: this.width, type, quality });
  setTimeout(() => done(new window.Blob(['x'.repeat(this.width * 10)], { type: out })), 0);
};
let urls = 0;
URL.createObjectURL = () => `blob:local-${++urls}`;
URL.revokeObjectURL = () => {};

/** `server.files` : objets reçus par Storage ; `xhr.fail` : nombre d'envois qui échouent ensuite. */
function api({ birth_year = 1985, avatar_path = null, member = true } = {}) {
  const calls = [];
  const server = {
    profile: { prenom: 'Léa', nom: 'Martin', sex: 'female', classement: '30/1', revision: 1, avatar_path, birth_year, email: 'lea@example.test' },
    files: new Map(avatar_path ? [[`${avatar_path}-512`, 'image/webp'], [`${avatar_path}-128`, 'image/webp']] : []),
    removed: [], fail: 0, lockedYear: false,
  };
  class FakeXHR {
    upload = {};
    open(method, url) { this.url = url; }
    setRequestHeader(name, value) { (this.headers ??= {})[name] = value; }
    send(body) {
      const name = this.url.split('/object/avatars/')[1];
      calls.push({ name: 'upload', file: name, type: this.headers['Content-Type'], size: body.size });
      setTimeout(async () => {
        if (server.fail > 0) { server.fail--; return this.onerror(); }
        this.upload.onprogress?.({ loaded: body.size / 2 });
        await server.hold;
        server.files.set(name, this.headers['Content-Type']);
        this.status = 200;
        this.responseText = '{}';
        this.onload();
      }, 0);
    }
  }
  globalThis.XMLHttpRequest = FakeXHR;
  const respond = (name, args) => {
    const p = server.profile;
    if (name === 'course_my_context')
      return { data: { is_member: member, can_manage: false, signup_status: member ? 'approved' : null, captain_teams: [], profile: structuredClone(p) } };
    if (name === 'profile_set_avatar') {
      const path = `${ME}/${args.p_version}`;
      if (!server.files.has(`${path}-512`) || !server.files.has(`${path}-128`)) return { data: null, error: { message: 'AVATAR_MISSING' } };
      const old = p.avatar_path;
      p.avatar_path = path;
      return { data: old === path ? null : old };
    }
    if (name === 'profile_clear_avatar') { const old = p.avatar_path; p.avatar_path = null; return { data: old }; }
    if (name === 'profile_set_birth_year') {
      if (server.lockedYear) { p.birth_year = 1970; return { data: null, error: { message: 'BIRTH_YEAR_LOCKED' } }; }
      p.birth_year = args.p_year;
      return { data: args.p_year };
    }
    return { data: null };
  };
  return {
    calls, server,
    supabase: {
      auth: { getSession: async () => ({ data: { session: { access_token: 'jeton' } } }) },
      rpc(name, args) {
        calls.push({ name, args });
        return { abortSignal: async () => respond(name, args) };
      },
      storage: { from: () => ({
        createSignedUrls: async (paths) => ({ error: null, data: paths.map((path) => ({ path, error: null, signedUrl: `https://x.test/${path}?t=1` })) }),
        remove: async (names) => { calls.push({ name: 'remove', names }); names.forEach((n) => server.files.delete(n)); server.removed.push(...names); return { data: [], error: null }; },
      }) },
    },
  };
}

function loader(mock) {
  const cache = new Map();
  const useAuth = () => ({ user: { id: ME, email: 'lea@example.test', user_metadata: {} }, loading: false });
  function load(file) {
    if (file.endsWith('.css')) return {};
    if (file.endsWith('/lib/supabase.ts')) return { supabase: mock.supabase };
    if (file.endsWith('/hooks/useAuth.ts')) return { useAuth };
    if (file.endsWith('/contexts/ClubContext.tsx')) return { useClub: () => ({ clubId: 'club-a', club: { name: 'CAC Tennis' } }) };
    if (file.endsWith('/lib/coursePush.ts')) return { coursePushSupported: () => false, disableCoursePush: async () => {} };
    if (cache.has(file)) return cache.get(file).exports;
    const module = { exports: {} };
    cache.set(file, module);
    const code = ts.transpileModule(readFileSync(file, 'utf8').replace(/import\.meta\.env\.\w+/g, 'undefined'), {
      compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX },
    }).outputText;
    const require = (name) => {
      if (name === 'heic-to') return { isHeic: async () => false, heicTo: async () => { throw new Error('heic'); } };
      if (!name.startsWith('.')) return req(name);
      const path = resolve(dirname(file), name);
      return load([path, `${path}.ts`, `${path}.tsx`].find(existsSync));
    };
    vm.runInThisContext(`(function(require,module,exports){${code}\n})`, { filename: file })(require, module, module.exports);
    return module.exports;
  }
  return (path) => load(resolve(src, path));
}

const flush = (ms = 15) => act(async () => { await new Promise((r) => setTimeout(r, ms)); });
const buttons = () => [...document.querySelectorAll('button')];
const button = (label) => buttons().find((b) => b.textContent === label || b.getAttribute('aria-label') === label);
const row = (label) => buttons().find((b) => b.getAttribute('aria-label')?.startsWith(`${label},`));
const status = () => document.querySelector('[role=status][aria-live]').textContent;
const dialog = () => document.querySelector('dialog');
const names = (mock, kind) => mock.calls.filter((c) => c.name === kind);
async function click(el, what) {
  assert.ok(el, `bouton ${what}`);
  await act(async () => el.click());
  await flush();
}
async function choose(input, name = 'photo.jpg') {
  Object.defineProperty(input, 'files', { value: [new window.File(['x'], name, { type: 'image/jpeg' })], configurable: true });
  await act(async () => input.dispatchEvent(new window.Event('change', { bubbles: true })));
  await flush();
}
const pickInput = () => [...dialog().querySelectorAll('input[type=file]')].find((i) => !i.hasAttribute('capture'));
async function key(el, k) {
  await act(async () => el.dispatchEvent(new window.KeyboardEvent('keydown', { key: k, bubbles: true })));
}
/** Délai du toast (5 s) déclenché à la main. */
function toastTimers() {
  const realSet = globalThis.setTimeout, realClear = globalThis.clearTimeout, timers = new Map();
  globalThis.setTimeout = (fn, ms, ...rest) => { if (ms !== 5000) return realSet(fn, ms, ...rest); const id = { fn }; timers.set(id, fn); return id; };
  globalThis.clearTimeout = (id) => { if (!timers.delete(id)) realClear(id); };
  return {
    fire: () => act(async () => { const fns = [...timers.values()]; timers.clear(); fns.forEach((fn) => fn()); }),
    restore: () => { globalThis.setTimeout = realSet; globalThis.clearTimeout = realClear; },
  };
}

async function mount(mock) {
  const load = loader(mock);
  const Page = load('pages/ProfilePage.tsx').default;
  const root = createRoot(document.getElementById('root'));
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } });
  await act(async () => root.render(h(QueryClientProvider, { client }, h(MemoryRouter, { initialEntries: ['/profil'] }, h(Page)))));
  await flush();
  await flush();
  return { load, close: async () => { await act(async () => root.unmount()); client.clear(); } };
}
test.beforeEach(() => {
  localStorage.clear();
  browser.webp = true;
  browser.draws = [];
  browser.blobs = [];
  delete window.matchMedia;
});

/** Rond → feuille → photo → recadrage → « Utiliser ». */
async function addPhoto(mock, { keys = [] } = {}) {
  await click(button('Changer la photo de profil'), 'rond');
  await choose(pickInput());
  const area = document.querySelector('[role=application]');
  assert.ok(area, 'recadrage ouvert');
  for (const k of keys) await key(area, k);
  await click(button('Utiliser'), 'Utiliser');
  await flush(30);
}

// ── Hub et feuille ─────────────────────────────────────────────────────────

test('sans photo : pastille, carte « Ajoutez une photo » et ligne Photo ouvrent la même feuille', async () => {
  const screen = await mount(api());
  try {
    assert.ok(document.querySelector('button[aria-label="Changer la photo de profil"] svg'), 'pastille appareil photo');
    assert.match(document.body.textContent, /Ajoutez une photo/);
    assert.equal(row('Photo').getAttribute('aria-label'), 'Photo, Ajouter');
    for (const trigger of [() => button('Changer la photo de profil'), () => button('Ajouter'), () => row('Photo')]) {
      await click(trigger(), 'ouvrir la feuille');
      assert.match(dialog().textContent, /Photo de profilVisible uniquement par les membres de vos clubs/);
      assert.deepEqual([...dialog().querySelectorAll('button')].map((b) => b.textContent), ['Prendre une photo', 'Choisir une photo', 'Annuler']);
      await click(button('Annuler'), 'Annuler');
      assert.equal(dialog(), null);
    }
  } finally { await screen.close(); }
});

test('carte d’incitation masquable, et masquée durablement', async () => {
  let screen = await mount(api());
  try {
    await click(button('Masquer cette suggestion'), 'Masquer');
    assert.doesNotMatch(document.body.textContent, /Ajoutez une photo/);
  } finally { await screen.close(); }
  screen = await mount(api());
  try { assert.doesNotMatch(document.body.textContent, /Ajoutez une photo/); } finally { await screen.close(); }
});

test('caméra refusée : la feuille reste ouverte et « Choisir une photo » fonctionne', async () => {
  const screen = await mount(api());
  try {
    await click(button('Changer la photo de profil'), 'rond');
    const [take, pick] = dialog().querySelectorAll('input[type=file]');
    assert.equal(take.getAttribute('capture'), 'user');
    assert.equal(take.getAttribute('accept'), 'image/*');
    assert.equal(pick.hasAttribute('capture'), false);
    await click(button('Prendre une photo'), 'Prendre');
    // Refus de la caméra : aucun fichier ne revient, rien ne change.
    assert.ok(dialog());
    await choose(pick);
    assert.ok(document.querySelector('[role=application]'));
  } finally { await screen.close(); }
});

test('ordinateur : menu ancré, sans « Prendre une photo »', async () => {
  window.matchMedia = (query) => ({ matches: true, media: query });
  const screen = await mount(api());
  try {
    await click(button('Changer la photo de profil'), 'rond');
    assert.equal(button('Prendre une photo'), undefined);
    assert.ok(button('Choisir une photo'));
    assert.match(dialog().getAttribute('style'), /top: \d+px/);
  } finally { await screen.close(); }
});

test('photo trop petite ou illisible : message dans la feuille, aucun envoi', async () => {
  const mock = api();
  const screen = await mount(mock);
  try {
    await click(button('Changer la photo de profil'), 'rond');
    await choose(pickInput(), 'petite.jpg');
    assert.match(dialog().querySelector('[role=alert]').textContent, /au moins 200 pixels/);
    await choose(pickInput(), 'casse.jpg');
    assert.match(dialog().querySelector('[role=alert]').textContent, /ne peut pas être ouverte/);
    // Une erreur inattendue du navigateur n'est jamais montrée telle quelle.
    const real = URL.createObjectURL;
    URL.createObjectURL = () => { throw new TypeError('The "obj" argument must be an instance of Blob'); };
    await choose(pickInput());
    URL.createObjectURL = real;
    assert.match(dialog().querySelector('[role=alert]').textContent, /ne peut pas être ouverte/);
    assert.equal(names(mock, 'upload').length, 0);
  } finally { await screen.close(); }
});

// ── Année et mineurs ───────────────────────────────────────────────────────

test('année inconnue : demandée avant la première photo, une seule fois', async () => {
  const mock = api({ birth_year: null });
  const screen = await mount(mock);
  try {
    await click(button('Changer la photo de profil'), 'rond');
    assert.match(dialog().textContent, /Elle sert à protéger les joueurs mineurs/);
    assert.match(dialog().textContent, /seul votre club pourra la corriger/);
    assert.equal(button('Choisir une photo'), undefined);
    const input = document.getElementById('photo-birth-year');
    const type = (v) => act(async () => input[Object.keys(input).find((k) => k.startsWith('__reactProps'))].onChange({ target: { value: v } }));
    const submit = () => act(async () => dialog().querySelector('form').dispatchEvent(new window.Event('submit', { bubbles: true, cancelable: true })));
    await type('1890');
    await submit();
    assert.match(dialog().querySelector('[role=alert]').textContent, /4 chiffres/);
    assert.equal(names(mock, 'profile_set_birth_year').length, 0);
    await type('1985');
    await submit();
    await flush();
    assert.deepEqual(names(mock, 'profile_set_birth_year').map((c) => c.args), [{ p_year: 1985 }]);
    assert.ok(button('Choisir une photo'), 'adulte : la feuille propose la photo');
  } finally { await screen.close(); }
});

test('année déjà enregistrée ailleurs : message, et la feuille suit l’année en base', async () => {
  const mock = api({ birth_year: null });
  mock.server.lockedYear = true;
  const screen = await mount(mock);
  try {
    await click(button('Changer la photo de profil'), 'rond');
    const input = document.getElementById('photo-birth-year');
    await act(async () => input[Object.keys(input).find((k) => k.startsWith('__reactProps'))].onChange({ target: { value: '1986' } }));
    await act(async () => dialog().querySelector('form').dispatchEvent(new window.Event('submit', { bubbles: true, cancelable: true })));
    await flush();
    assert.match(dialog().querySelector('[role=alert]').textContent, /déjà enregistrée/);
    assert.ok(button('Choisir une photo'));
  } finally { await screen.close(); }
});

test('mineur : initiales, ni pastille ni carte, une ligne d’explication, feuille « Compris »', async () => {
  const mock = api({ birth_year: YEAR - 15 });
  const screen = await mount(mock);
  try {
    assert.equal(document.querySelector('button[aria-label="Photo de profil"] svg'), null, 'pas de pastille');
    assert.doesNotMatch(document.body.textContent, /Ajoutez une photo/);
    assert.equal(row('Photo'), undefined, 'ligne Photo sans action');
    assert.match(document.body.textContent, /Les photos des joueurs mineurs arrivent bientôt/);
    await click(button('Photo de profil'), 'rond');
    assert.equal(button('Choisir une photo'), undefined);
    assert.equal(button('Retirer la photo'), undefined);
    await click(button('Compris'), 'Compris');
    assert.equal(dialog(), null);
  } finally { await screen.close(); }
});

test('mineur avec une ancienne photo : ni affichée ni signée, « Retirer » sans Annuler', async () => {
  const mock = api({ birth_year: YEAR - 15, avatar_path: OLD });
  const screen = await mount(mock);
  try {
    assert.equal(document.querySelector('img'), null);
    await click(button('Photo de profil'), 'rond');
    await click(button('Retirer la photo'), 'Retirer');
    assert.equal(names(mock, 'profile_clear_avatar').length, 1);
    assert.equal(status(), 'Photo retirée');
    assert.equal(button('Annuler'), undefined);
    await flush(30);
    assert.deepEqual(mock.server.removed.sort(), [`${OLD}-128`, `${OLD}-512`]);
  } finally { await screen.close(); }
});

// ── Recadrage et export ────────────────────────────────────────────────────

test('recadrage au clavier (flèches, + et −), export 512 et 128 en WebP 0,82', async () => {
  const mock = api();
  const screen = await mount(mock);
  try {
    await click(button('Changer la photo de profil'), 'rond');
    await choose(pickInput());
    const area = document.querySelector('[role=application]');
    const zoom = document.querySelector('input[type=range]');
    assert.equal(zoom.value, '1');
    assert.equal(document.querySelectorAll('figure').length, 3, 'aperçus 88, 36 et 26');
    await key(area, '+');
    await key(area, '+');
    await key(area, '-');
    assert.equal(zoom.getAttribute('aria-valuetext'), '125 %');
    await click(button('Zoomer'), '+');
    await click(button('Dézoomer'), '−');
    await key(area, 'ArrowRight');
    await key(area, 'ArrowDown');
    browser.draws = [];
    await click(button('Utiliser'), 'Utiliser');
    await flush(30);
    const side = 3024 / 1.25;
    const [sx, sy, sw, sh, , , dw, dh] = browser.draws.find((d) => d.width === 512).args.slice(1);
    assert.deepEqual([sx, sy, sw, sh, dw, dh].map((n) => Math.round(n * 100) / 100),
      [2016 + side * 0.05 - side / 2, 1512 + side * 0.05 - side / 2, side, side, 512, 512].map((n) => Math.round(n * 100) / 100));
    assert.deepEqual(browser.blobs.filter((b) => b.width >= 128 && b.width <= 512), [
      { width: 512, type: 'image/webp', quality: 0.82 }, { width: 128, type: 'image/webp', quality: 0.82 }]);
    const uploads = names(mock, 'upload');
    assert.deepEqual(uploads.map((u) => [u.file.replace(/^.*-/, ''), u.type]), [['512', 'image/webp'], ['128', 'image/webp']]);
  } finally { await screen.close(); }
});

test('WebP non supporté (Safari) : repli en JPEG 0,85, jamais de PNG', async () => {
  browser.webp = false;
  const mock = api();
  const screen = await mount(mock);
  try {
    await addPhoto(mock);
    assert.deepEqual(names(mock, 'upload').map((u) => u.type), ['image/jpeg', 'image/jpeg']);
    assert.ok(browser.blobs.some((b) => b.width === 512 && b.type === 'image/jpeg' && b.quality === 0.85));
  } finally { await screen.close(); }
});

// ── Envoi ──────────────────────────────────────────────────────────────────

test('envoi : progression, enregistrement, toast « Photo mise à jour », ligne « Modifier »', async () => {
  const mock = api();
  let release;
  mock.server.hold = new Promise((r) => { release = r; });
  const screen = await mount(mock);
  try {
    await addPhoto(mock);
    // 512 px : 5 120 octets, 128 px : 1 280 ; la moitié du premier fichier est partie.
    const bar = document.querySelector('[role=progressbar]');
    assert.equal(bar.textContent, 'Envoi de la photo… 40 %');
    assert.equal(bar.getAttribute('aria-valuenow'), '40');
    assert.ok(document.querySelector('button[aria-label="Changer la photo de profil"]').disabled, 'pas de second envoi pendant le premier');
    assert.match(document.querySelector('img').getAttribute('src'), /^blob:local-/, 'la photo recadrée s’affiche tout de suite');
    mock.server.hold = null;
    await act(async () => release());
    await flush(40);
    assert.equal(document.querySelector('[role=progressbar]'), null);
    const [set] = names(mock, 'profile_set_avatar');
    assert.match(set.args.p_version, /^[0-9a-f-]{36}$/);
    assert.equal(mock.server.profile.avatar_path, `${ME}/${set.args.p_version}`);
    assert.match(status(), /Photo mise à jour/);
    assert.equal(row('Photo').getAttribute('aria-label'), 'Photo, Modifier');
    assert.doesNotMatch(document.body.textContent, /Ajoutez une photo/);
    // L'original n'est jamais envoyé : seulement les deux fichiers recadrés.
    assert.deepEqual(names(mock, 'upload').map((u) => u.size), [5120, 1280]);
  } finally { await screen.close(); }
});

test('échec d’envoi : l’ancienne photo reste, « Réessayer » reprend la même image', async () => {
  const mock = api({ avatar_path: OLD });
  mock.server.fail = 1;
  const screen = await mount(mock);
  try {
    await addPhoto(mock);
    const alert = [...document.querySelectorAll('[role=alert]')].find((a) => /n’a pas été envoyée/.test(a.textContent));
    assert.match(alert.textContent, /Votre ancienne photo reste affichée/);
    assert.equal(mock.server.profile.avatar_path, OLD);
    assert.equal(names(mock, 'profile_set_avatar').length, 0);
    await click(button('Réessayer'), 'Réessayer');
    await flush(40);
    const files = names(mock, 'upload').map((u) => u.file);
    assert.equal(new Set(files.map((f) => f.replace(/-(512|128)$/, ''))).size, 1, 'même version');
    assert.match(status(), /Photo mise à jour/);
    assert.notEqual(mock.server.profile.avatar_path, OLD);
  } finally { await screen.close(); }
});

test('échec puis « Annuler » : rien n’est enregistré, les fichiers envoyés partent', async () => {
  const mock = api();
  mock.server.fail = 1;
  const screen = await mount(mock);
  try {
    await addPhoto(mock);
    assert.match(document.body.textContent, /Vos initiales restent affichées/);
    await click(buttons().find((b) => b.textContent === 'Annuler'), 'Annuler');
    await flush(30);
    assert.equal(mock.server.profile.avatar_path, null);
    assert.equal(names(mock, 'profile_set_avatar').length, 0);
    assert.doesNotMatch(document.body.textContent, /n’a pas été envoyée/);
  } finally { await screen.close(); }
});

test('« Annuler » après une nouvelle photo : l’ancienne revient, la nouvelle est supprimée', async () => {
  const mock = api({ avatar_path: OLD });
  const screen = await mount(mock);
  try {
    await addPhoto(mock);
    const fresh = mock.server.profile.avatar_path;
    await click(button('Annuler'), 'Annuler du toast');
    await flush(30);
    assert.deepEqual(names(mock, 'profile_set_avatar').map((c) => c.args.p_version), [fresh.split('/')[1], OLD.split('/')[1]]);
    assert.equal(mock.server.profile.avatar_path, OLD);
    assert.equal(status(), 'Profil mis à jour');
    assert.deepEqual(mock.server.removed.sort(), [`${fresh}-128`, `${fresh}-512`]);
    assert.ok(mock.server.files.has(`${OLD}-512`));
  } finally { await screen.close(); }
});

test('fin du toast : l’ancienne version est supprimée par l’API Storage, pas avant', async () => {
  const mock = api({ avatar_path: OLD });
  const screen = await mount(mock);
  const timers = toastTimers();
  try {
    await addPhoto(mock);
    assert.deepEqual(mock.server.removed, [], 'gardée tant que « Annuler » est possible');
    await timers.fire();
    await flush(30);
    assert.deepEqual(mock.server.removed.sort(), [`${OLD}-128`, `${OLD}-512`]);
  } finally { timers.restore(); await screen.close(); }
});

test('retirer : immédiat, toast « Photo retirée · Annuler » qui la remet', async () => {
  const mock = api({ avatar_path: OLD });
  const screen = await mount(mock);
  try {
    await click(button('Changer la photo de profil'), 'rond');
    await click(button('Retirer la photo'), 'Retirer');
    assert.equal(dialog(), null);
    assert.equal(mock.server.profile.avatar_path, null);
    assert.match(status(), /Photo retirée/);
    assert.equal(row('Photo').getAttribute('aria-label'), 'Photo, Ajouter');
    await click(button('Annuler'), 'Annuler');
    await flush(30);
    assert.equal(mock.server.profile.avatar_path, OLD);
    assert.deepEqual(mock.server.removed, []);
  } finally { await screen.close(); }
});

test('corbeille : une version laissée par une app fermée part à la prochaine ouverture, jamais la photo en cours', async () => {
  const stale = `${ME}/bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb`;
  localStorage.setItem(`avatar-trash:${ME}`, JSON.stringify([stale, OLD]));
  const mock = api({ avatar_path: OLD });
  const screen = await mount(mock);
  try {
    await flush(30);
    assert.deepEqual(names(mock, 'remove').map((c) => c.names), [[`${stale}-512`, `${stale}-128`]]);
    assert.equal(localStorage.getItem(`avatar-trash:${ME}`), null);
  } finally { await screen.close(); }
});
