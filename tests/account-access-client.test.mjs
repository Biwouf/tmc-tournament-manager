// Brief « Mon compte » : P0-a (un compte connecté non membre ouvre /profil et se déconnecte)
// et P0-b (hub « Mon compte » : lignes, feuilles, classement avec Annuler, mot de passe).
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
globalThis.window = dom.window;
globalThis.document = dom.window.document;
globalThis.HTMLElement = dom.window.HTMLElement;
globalThis.IS_REACT_ACT_ENVIRONMENT = true;
dom.window.HTMLDialogElement.prototype.showModal = function () { this.setAttribute('open', ''); };
dom.window.HTMLDialogElement.prototype.close = function () { this.removeAttribute('open'); };
const React = req('react'), { act, createElement: h } = React;
const { createRoot } = req('react-dom/client');
const { MemoryRouter, Routes, Route, useLocation } = req('react-router-dom');
const { QueryClient, QueryClientProvider } = req('@tanstack/react-query');
const src = resolve(new URL('../pwa/src', import.meta.url).pathname);

const MEMBER = {
  is_member: true, can_manage: false, signup_status: 'approved', signup_requested_at: '2026-11-17T10:00:00Z',
  captain_teams: [{ genre: 'hommes', categorie: '35_ans', numero: 1 }],
  profile: { prenom: 'Léa', nom: 'Martin', sex: 'female', classement: '30/1', revision: 1 },
};
const NON_MEMBER = { ...MEMBER, is_member: false, signup_status: 'pending', captain_teams: [] };

function api({ context = MEMBER, error = null } = {}) {
  const calls = [];
  const state = { context: structuredClone(context), error, failure: null, password: 'ancien-mdp' };
  const respond = (name, args) => {
    if (name === 'course_my_context')
      return state.error ? { data: null, error: { message: state.error } } : { data: structuredClone(state.context) };
    if (name === 'account_save_profile') {
      if (state.failure) return { data: null, error: { message: state.failure } };
      const profile = state.context.profile;
      if (args.p_revision !== profile.revision) return { data: null, error: { message: 'VERSION_CONFLICT' } };
      Object.assign(profile, {
        prenom: args.p_prenom, nom: args.p_nom, sex: args.p_sex, revision: profile.revision + 1,
        ...('p_classement' in args ? { classement: args.p_classement || null } : {}),
      });
      return { data: { revision: profile.revision } };
    }
    return { data: null };
  };
  return {
    calls, state,
    supabase: {
      auth: {
        signOut: async () => { calls.push({ name: 'signOut' }); return { error: null }; },
        signInWithPassword: async ({ password }) => {
          calls.push({ name: 'signInWithPassword' });
          return password === state.password ? { error: null } : { error: { message: 'Invalid login credentials' } };
        },
        updateUser: async ({ password }) => { calls.push({ name: 'updateUser' }); state.password = password; return { error: null }; },
      },
      rpc(name, args) {
        calls.push({ name, args });
        return { abortSignal: () => Promise.resolve(respond(name, args)) };
      },
    },
  };
}

function loader(mock, user, pushSupported = false) {
  const cache = new Map();
  const push = new Proxy({
    coursePushSupported: () => pushSupported,
    disableCoursePush: async () => { mock.calls.push({ name: 'disableCoursePush' }); },
  }, { get: (t, k) => (k in t ? t[k] : async () => null) });
  function load(file) {
    if (file.endsWith('.css')) return {};
    if (file.endsWith('/lib/supabase.ts')) return { supabase: mock.supabase };
    if (file.endsWith('/hooks/useAuth.ts')) return { useAuth: () => ({ user, loading: false }) };
    if (file.endsWith('/contexts/ClubContext.tsx')) return { useClub: () => ({ clubId: 'club-a', club: { name: 'CAC Tennis' } }) };
    if (file.endsWith('/lib/coursePush.ts')) return push;
    if (file.endsWith('/hooks/usePush.ts')) return { usePush: () => ({ supported: true, prefs: {}, busy: false, error: '', set: async () => {} }) };
    if (file.endsWith('/components/layout/HeaderActionContext.tsx')) return { useHeaderAction: () => {} };
    if (cache.has(file)) return cache.get(file).exports;
    const module = { exports: {} };
    cache.set(file, module);
    const code = ts.transpileModule(readFileSync(file, 'utf8').replace(/import\.meta\.env\.\w+/g, 'undefined'), {
      compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX },
    }).outputText;
    const require = (name) => {
      if (!name.startsWith('.')) return req(name);
      const path = resolve(dirname(file), name);
      return load([path, `${path}.ts`, `${path}.tsx`].find(existsSync));
    };
    vm.runInThisContext(`(function(require,module,exports){${code}\n})`, { filename: file })(require, module, module.exports);
    return module.exports;
  }
  return (path) => load(resolve(src, path));
}

const flush = () => act(async () => { await new Promise((r) => setTimeout(r, 15)); });
const buttons = () => [...document.querySelectorAll('button')];
const button = (label) => buttons().find((b) => b.textContent === label);
const row = (label) => buttons().find((b) => b.textContent.startsWith(label));
async function click(el, what) {
  assert.ok(el, `bouton ${what}`);
  await act(async () => el.click());
  await flush();
}
async function type(el, value) {
  await act(async () => el[Object.keys(el).find((k) => k.startsWith('__reactProps'))].onChange({ target: { value } }));
}
async function submit() {
  await act(async () => document.querySelector('dialog form').dispatchEvent(new window.Event('submit', { bubbles: true, cancelable: true })));
  await flush();
}
const status = () => document.querySelector('[role=status][aria-live]').textContent;

function Where() {
  return h('output', { id: 'where' }, useLocation().pathname);
}

// Monte /profil derrière le garde demandé, comme dans App.tsx.
async function mount(load, guard, page = h('p', null, 'page profil')) {
  const Guard = load('components/AuthGuards.tsx')[guard];
  const root = createRoot(document.getElementById('root'));
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } });
  await act(async () => root.render(
    h(QueryClientProvider, { client },
      h(MemoryRouter, { initialEntries: ['/profil?returnTo=%2Factu'] },
        h(Where),
        h(Routes, null,
          h(Route, { path: '/profil', element: h(Guard, null, page) }),
          h(Route, { path: '/actu', element: h('p', null, 'page actu') }),
          h(Route, { path: '/login', element: h('p', null, 'page login') }),
        ))),
  ));
  await flush();
  await flush();
  return {
    where: () => document.getElementById('where').textContent,
    close: async () => { await act(async () => root.unmount()); client.clear(); },
  };
}

async function mountHub(mock, { pushSupported = false, withNotice = false } = {}) {
  const load = loader(mock, { id: 'me', email: 'lea@example.test', user_metadata: {} }, pushSupported);
  const page = h(load('pages/ProfilePage.tsx').default);
  return mount(load, 'RequireUser', withNotice ? h(React.Fragment, null, h(load('components/SignupNotice.tsx').default), page) : page);
}

// ── P0-a : accès et déconnexion ──────────────────────────────────────────────

test('RequireUser ouvre /profil à un compte connecté non membre', async () => {
  const screen = await mount(loader(api({ context: NON_MEMBER }), { id: 'me' }), 'RequireUser');
  try {
    assert.equal(screen.where(), '/profil');
    assert.match(document.body.textContent, /page profil/);
  } finally { await screen.close(); }
});

test('RequireUser renvoie un visiteur déconnecté vers /login', async () => {
  const screen = await mount(loader(api({ context: NON_MEMBER }), null), 'RequireUser');
  try { assert.equal(screen.where(), '/login'); } finally { await screen.close(); }
});

test('RequireAuth garde les pages membres fermées à un non-membre', async () => {
  const screen = await mount(loader(api({ context: NON_MEMBER }), { id: 'me' }), 'RequireAuth');
  try { assert.equal(screen.where(), '/actu'); } finally { await screen.close(); }
});

for (const [signup, text] of [['pending', /pas encore validé votre demande.*Envoyée le 17 novembre/], ['denied', /n’a pas accepté/], ['revoked', /accès membre à CAC Tennis a été retiré/]]) {
  test(`/profil d'un compte ${signup} : une seule carte d'état et la déconnexion`, async () => {
    const mock = api({ context: { ...NON_MEMBER, signup_status: signup } });
    const screen = await mountHub(mock, { withNotice: true });
    try {
      assert.equal(screen.where(), '/profil');
      // SignupNotice se tait sur /profil : la carte de la page est le seul message.
      assert.equal(document.querySelectorAll('aside').length, 1);
      assert.match(document.querySelector('aside').textContent, text);
      assert.doesNotMatch(document.body.textContent, /doit être rattaché/);
      await click(button('Se déconnecter'), 'Se déconnecter');
      assert.deepEqual(mock.calls.map((c) => c.name).filter((n) => n !== 'course_my_context'), ['disableCoursePush', 'signOut']);
      assert.equal(screen.where(), '/actu');
    } finally { await screen.close(); }
  });
}

test('/profil reste ouvert et déconnectable quand course_my_context échoue', async () => {
  const mock = api({ error: 'Failed to fetch' });
  const screen = await mountHub(mock);
  try {
    assert.equal(screen.where(), '/profil');
    assert.match(document.querySelector('[role=alert]').textContent, /Impossible de charger votre profil joueur/);
    assert.match(document.body.textContent, /lea@example\.test/);
    mock.state.error = null;
    await click(button('Réessayer'), 'Réessayer');
    assert.ok(row('Classement'));
    await click(button('Se déconnecter'), 'Se déconnecter');
    assert.ok(mock.calls.some((c) => c.name === 'signOut'));
  } finally { await screen.close(); }
});

test('App.tsx protège /profil par RequireUser, pas par RequireAuth', () => {
  const app = readFileSync(resolve(src, 'App.tsx'), 'utf8');
  assert.match(app, /path="\/profil" element=\{<RequireUser><ProfilePage \/><\/RequireUser>\}/);
});

// ── P0-b : hub « Mon compte » ────────────────────────────────────────────────

test('hub membre : identité, pastilles, lignes ; ni double titre, ni Retour, ni suppression', async () => {
  const screen = await mountHub(api());
  try {
    const text = document.body.textContent;
    assert.match(text, /Léa Martin/);
    assert.match(text, /Membre · CAC Tennis/);
    assert.match(text, /Capitaine · Messieurs \+35/);
    assert.match(row('Nom').textContent, /Léa Martin/);
    assert.match(row('Sexe').textContent, /Femme/);
    assert.match(row('Classement').textContent, /30\/1/);
    assert.equal(document.querySelector('h1').className, 'sr-only');
    assert.equal(button('Retour'), undefined);
    assert.equal(row('Supprimer'), undefined);
  } finally { await screen.close(); }
});

test('Nom et sexe : feuille avec radios, enregistrement sans navigation, toast', async () => {
  const mock = api();
  const screen = await mountHub(mock);
  try {
    await click(row('Nom'), 'Nom');
    assert.equal(document.querySelectorAll('dialog input[type=radio]').length, 2);
    assert.equal(document.querySelectorAll('dialog select').length, 0);
    await type(document.getElementById('account-prenom'), 'Léonie');
    await click(document.querySelector('dialog input[value=male]'), 'Homme');
    await submit();
    const write = mock.calls.find((c) => c.name === 'account_save_profile');
    assert.deepEqual(write.args, { p_prenom: 'Léonie', p_nom: 'Martin', p_sex: 'male', p_revision: 1 });
    assert.equal(document.querySelector('dialog'), null);
    assert.equal(screen.where(), '/profil');
    assert.match(status(), /Profil mis à jour/);
    assert.match(row('Nom').textContent, /Léonie Martin/);
    assert.match(row('Sexe').textContent, /Homme/);
  } finally { await screen.close(); }
});

test('conflit de révision : message, « Recharger le profil actuel », puis la nouvelle révision', async () => {
  const mock = api();
  const screen = await mountHub(mock);
  try {
    await click(row('Nom'), 'Nom');
    // Le profil a été modifié ailleurs (un autre appareil) entre-temps.
    Object.assign(mock.state.context.profile, { prenom: 'Admin', revision: 2 });
    await submit();
    assert.match(document.querySelector('dialog [role=alert]').textContent, /a changé entre-temps/);
    assert.equal(document.getElementById('account-prenom').value, 'Léa');
    await click(button('Recharger le profil actuel'), 'Recharger');
    assert.equal(document.getElementById('account-prenom').value, 'Admin');
    await submit();
    const writes = mock.calls.filter((c) => c.name === 'account_save_profile');
    assert.deepEqual(writes.map((c) => c.args.p_revision), [1, 2]);
    assert.equal(document.querySelector('dialog'), null);
  } finally { await screen.close(); }
});

test('classement : enregistré au toucher, toast avec Annuler qui remet l’ancien', async () => {
  const mock = api();
  const screen = await mountHub(mock);
  try {
    await click(row('Classement'), 'Classement');
    await click(button('15/4'), '15/4');
    assert.equal(document.querySelector('dialog'), null);
    assert.match(status(), /Classement : 15\/4/);
    assert.match(row('Classement').textContent, /15\/4/);
    await click(button('Annuler'), 'Annuler');
    const writes = mock.calls.filter((c) => c.name === 'account_save_profile');
    assert.deepEqual(writes.map((c) => [c.args.p_classement, c.args.p_revision]), [['15/4', 1], ['30/1', 2]]);
    assert.match(row('Classement').textContent, /30\/1/);
  } finally { await screen.close(); }
});

test('notifications : une seule ligne quand le push est indisponible, les trois interrupteurs sinon', async () => {
  let screen = await mountHub(api());
  try {
    assert.match(document.body.textContent, /Notifications indisponibles ici/);
    assert.equal(document.querySelectorAll('[role=switch]').length, 0);
  } finally { await screen.close(); }
  screen = await mountHub(api(), { pushSupported: true });
  try {
    assert.equal(document.querySelectorAll('[role=switch]').length, 3);
  } finally { await screen.close(); }
});

test('compte en attente : profil modifiable, notifications après validation', async () => {
  const mock = api({ context: NON_MEMBER });
  const screen = await mountHub(mock, { pushSupported: true });
  try {
    assert.match(document.body.textContent, /Demande en attente · CAC Tennis/);
    assert.match(document.body.textContent, /Disponibles après validation/);
    assert.equal(document.querySelectorAll('[role=switch]').length, 0);
    await click(row('Classement'), 'Classement');
    await click(button('15/4'), '15/4');
    assert.ok(mock.calls.some((c) => c.name === 'account_save_profile' && c.args.p_classement === '15/4'));
  } finally { await screen.close(); }
});

test('mot de passe : l’actuel est vérifié avant le changement', async () => {
  const mock = api();
  const screen = await mountHub(mock);
  try {
    await click(row('Mot de passe'), 'Mot de passe');
    await type(document.getElementById('account-current-password'), 'faux');
    await type(document.getElementById('account-new-password'), 'nouveau-mdp');
    await submit();
    assert.match(document.querySelector('dialog [role=alert]').textContent, /actuel incorrect/);
    assert.equal(mock.calls.filter((c) => c.name === 'updateUser').length, 0);
    await type(document.getElementById('account-current-password'), 'ancien-mdp');
    await submit();
    assert.equal(mock.calls.filter((c) => c.name === 'updateUser').length, 1);
    assert.equal(document.querySelector('dialog'), null);
    assert.match(status(), /Mot de passe modifié/);
  } finally { await screen.close(); }
});
