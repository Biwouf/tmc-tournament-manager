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
  const state = { context: structuredClone(context), error, failure: null, password: 'ancien-mdp', hold: null, updateError: null, signOutError: null, othersError: null, resetError: null };
  const session = { user: null, listeners: new Set(), set(user) { this.user = user; this.listeners.forEach((l) => l()); } };
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
    calls, state, session,
    supabase: {
      auth: {
        signOut: async (options) => {
          calls.push({ name: 'signOut', scope: options?.scope });
          if (options?.scope === 'others') return { error: state.othersError };
          if (state.signOutError) return { error: state.signOutError };
          session.set(null);
          return { error: null };
        },
        resetPasswordForEmail: async (email, options) => { calls.push({ name: 'resetPasswordForEmail', email, options }); return { error: state.resetError }; },
        signInWithPassword: async ({ password }) => {
          calls.push({ name: 'signInWithPassword' });
          return password === state.password ? { error: null } : { error: { message: 'Invalid login credentials' } };
        },
        updateUser: async ({ password }) => { calls.push({ name: 'updateUser' }); if (state.updateError) return { error: state.updateError }; state.password = password; return { error: null }; },
      },
      rpc(name, args) {
        calls.push({ name, args });
        return { abortSignal: async () => { const reply = respond(name, args); if (name === 'account_save_profile' && state.hold) await state.hold; return reply; } };
      },
    },
  };
}

function loader(mock, user, pushSupported = false) {
  mock.session.user = user;
  const useAuth = () => ({
    user: React.useSyncExternalStore((l) => { mock.session.listeners.add(l); return () => mock.session.listeners.delete(l); }, () => mock.session.user),
    loading: false,
  });
  const cache = new Map();
  const push = new Proxy({
    coursePushSupported: () => pushSupported,
    disableCoursePush: async () => { mock.calls.push({ name: 'disableCoursePush' }); },
  }, { get: (t, k) => (k in t ? t[k] : async () => null) });
  function load(file) {
    if (file.endsWith('.css')) return {};
    if (file.endsWith('/lib/supabase.ts')) return { supabase: mock.supabase };
    if (file.endsWith('/hooks/useAuth.ts')) return { useAuth };
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
const toast = () => document.querySelector('[role=status][aria-live] > div');
const names = (mock) => mock.calls.map((c) => c.name).filter((n) => n !== 'course_my_context');
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
    // Seul le bloc Profil joueur est en erreur : Connexion reste là.
    assert.ok(row('Mot de passe'));
    assert.equal(row('Classement'), undefined);
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

test('notifications d’un non-membre : « après validation » seulement pour une demande en attente', async () => {
  for (const signup_status of ['denied', 'revoked', null]) {
    const screen = await mountHub(api({ context: { ...NON_MEMBER, signup_status } }), { pushSupported: true });
    try {
      assert.match(document.body.textContent, /Réservées aux membres du club/, String(signup_status));
      assert.doesNotMatch(document.body.textContent, /après validation/, String(signup_status));
    } finally { await screen.close(); }
  }
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

test('déconnexion refusée : on reste sur la page, avec le message', async () => {
  const mock = api();
  mock.state.signOutError = { message: 'Boom' };
  const screen = await mountHub(mock);
  try {
    await click(button('Se déconnecter'), 'Se déconnecter');
    assert.equal(screen.where(), '/profil');
    assert.match(document.querySelector('[role=alert]').textContent, /Déconnexion impossible/);
    mock.state.signOutError = null;
    await click(button('Se déconnecter'), 'Se déconnecter');
    assert.equal(screen.where(), '/actu');
  } finally { await screen.close(); }
  // La destination ne sert qu'une fois : une session perdue ensuite mène à la connexion.
  const again = api();
  const second = await mountHub(again);
  try {
    await act(async () => again.session.set(null));
    await flush();
    assert.equal(second.where(), '/login');
  } finally { await second.close(); }
});

test('barème FFT : 5e série et numérotés, pas de case NC ; NC en base vaut « Non classé·e »', async () => {
  const mock = api({ context: { ...MEMBER, profile: { ...MEMBER.profile, classement: 'NC' } } });
  const screen = await mountHub(mock);
  try {
    assert.match(row('Classement').textContent, /Non classé·e/);
    await click(row('Classement'), 'Classement');
    assert.equal(button('NC'), undefined);
    assert.equal(button('-30'), undefined);
    assert.equal(button('Je ne sais pas / non classé·e').getAttribute('aria-pressed'), 'true');
    const series = [...document.querySelectorAll('dialog section')].map((s) => [s.querySelector('h3').textContent, [...s.querySelectorAll('button')].map((b) => b.textContent)]);
    assert.deepEqual(series, [
      ['5e série', ['40/2', '40/1']],
      ['4e série', ['40', '30/5', '30/4', '30/3', '30/2', '30/1']],
      ['3e série', ['30', '15/5', '15/4', '15/3', '15/2', '15/1']],
      ['2e série', ['15', '5/6', '4/6', '3/6', '2/6', '1/6', '0', '-2/6', '-4/6', '-15']],
    ]);
    await click(button('40/1'), '40/1');
    await click(row('Classement'), 'Classement');
    await click(button('Numéroté·e (Top 100 et au-dessus)'), 'Top');
    assert.deepEqual(mock.calls.filter((c) => c.name === 'account_save_profile').map((c) => c.args.p_classement), ['40/1', 'Top']);
    assert.match(row('Classement').textContent, /Top/);
  } finally { await screen.close(); }
});

test('classement : ligne à jour avant la réponse, second choix ignoré, retour en arrière sur échec', async () => {
  const mock = api();
  let release;
  mock.state.hold = new Promise((r) => { release = r; });
  const screen = await mountHub(mock);
  try {
    await click(row('Classement'), 'Classement');
    await click(button('15/4'), '15/4');
    assert.match(row('Classement').textContent, /15\/4/);
    await click(row('Classement'), 'Classement');
    assert.equal(document.querySelector('dialog'), null, 'aucune feuille pendant un enregistrement');
    mock.state.hold = null;
    await act(async () => release());
    await flush();
    assert.equal(mock.calls.filter((c) => c.name === 'account_save_profile').length, 1);
    mock.state.failure = 'Failed to fetch';
    await click(row('Classement'), 'Classement');
    await click(button('30'), '30');
    assert.match(status(), /Enregistrement impossible/);
    assert.match(row('Classement').textContent, /15\/4/);
  } finally { await screen.close(); }
});

test('profil incomplet : la ligne Classement ouvre la feuille Nom et sexe', async () => {
  const screen = await mountHub(api({ context: { ...MEMBER, profile: { ...MEMBER.profile, sex: null } } }));
  try {
    await click(row('Classement'), 'Classement');
    assert.ok(document.getElementById('account-prenom'));
  } finally { await screen.close(); }
});

test('essai abandonné mais abouti : la nouvelle tentative n’est pas un conflit', async () => {
  const mock = api();
  const screen = await mountHub(mock);
  try {
    await click(row('Nom'), 'Nom');
    await type(document.getElementById('account-prenom'), 'Léonie');
    // Le premier envoi a bien été écrit, mais sa réponse n'est jamais arrivée.
    Object.assign(mock.state.context.profile, { prenom: 'Léonie', revision: 2 });
    await submit();
    assert.equal(document.querySelector('dialog'), null);
    assert.match(status(), /Profil mis à jour/);
  } finally { await screen.close(); }
});

test('toast : au-dessus du bandeau d’installation, délai en pause au focus et au survol', async () => {
  const css = readFileSync(resolve(src, 'index.css'), 'utf8');
  const banner = Number(css.match(/\.install-banner \{[^}]*z-index: (\d+)/)[1]);
  const mock = api();
  const screen = await mountHub(mock);
  const realSet = globalThis.setTimeout, realClear = globalThis.clearTimeout;
  const timers = new Map();
  try {
    await click(row('Classement'), 'Classement');
    globalThis.setTimeout = (fn, ms, ...rest) => { if (ms !== 5000) return realSet(fn, ms, ...rest); const id = { fn }; timers.set(id, fn); return id; };
    globalThis.clearTimeout = (id) => { if (!timers.delete(id)) realClear(id); };
    await click(button('15/4'), '15/4');
    const region = document.querySelector('[role=status][aria-live]');
    assert.ok(Number(region.className.match(/z-\[(\d+)\]/)[1]) > banner);
    assert.match(readFileSync(resolve(src, 'components/account/AccountToast.tsx'), 'utf8'), /bottom: 'calc\(56px \+ var\(--install-banner-height, 0px\) \+ 16px \+ env\(safe-area-inset-bottom\)\)'/);
    assert.equal(timers.size, 1);
    await act(async () => button('Annuler').focus());
    assert.equal(timers.size, 0, 'pause au focus');
    await act(async () => button('Annuler').blur());
    assert.equal(timers.size, 1, 'repart à la sortie');
    const hover = (kind, to) => act(async () => toast().dispatchEvent(new window.MouseEvent(kind, { bubbles: true, relatedTarget: to })));
    await hover('mouseover', document.body);
    assert.equal(timers.size, 0, 'pause au survol');
    await hover('mouseout', document.body);
    assert.equal(timers.size, 1);
    await act(async () => [...timers.values()][0]());
    assert.equal(toast(), null);
  } finally {
    globalThis.setTimeout = realSet; globalThis.clearTimeout = realClear;
    await screen.close();
  }
});

test('mot de passe : autres appareils, oubli, reconnexion demandée', async () => {
  const mock = api();
  const screen = await mountHub(mock);
  const fill = async () => {
    await click(row('Mot de passe'), 'Mot de passe');
    await type(document.getElementById('account-current-password'), mock.state.password);
    await type(document.getElementById('account-new-password'), `${mock.state.password}-bis`);
  };
  const box = () => document.querySelector('dialog input[type=checkbox]');
  const others = () => mock.calls.filter((c) => c.name === 'signOut' && c.scope === 'others').length;
  try {
    await fill();
    assert.equal(box().checked, true);
    await submit();
    assert.equal(others(), 1);
    assert.match(status(), /Vos autres appareils sont déconnectés/);
    await fill();
    await click(box(), 'Déconnecter mes autres appareils');
    await submit();
    assert.equal(others(), 1);
    assert.equal(status(), 'Mot de passe modifié');
    // Changé, mais les autres sessions sont restées : on le dit.
    mock.state.othersError = { message: 'Failed to fetch' };
    await fill();
    await submit();
    assert.match(status(), /n’ont pas pu être déconnectés/);

    await click(row('Mot de passe'), 'Mot de passe');
    await click(button('Mot de passe oublié ?'), 'oublié');
    const reset = mock.calls.find((c) => c.name === 'resetPasswordForEmail');
    assert.equal(reset.email, 'lea@example.test');
    assert.match(reset.options.redirectTo, /\/reset-password$/);
    assert.match(document.querySelector('dialog').textContent, /Un lien vous a été envoyé à lea@example\.test\./);
    assert.equal(screen.where(), '/profil');

    // Jamais le message brut de Supabase, même sans mot anglais reconnu par uiMessage.
    for (const [updateError, pattern] of [[{ message: 'Password should be at least 12 characters' }, /Modification impossible/], [{ code: 'weak_password', message: 'Password should be stronger' }, /trop faible/]]) {
      mock.state.updateError = updateError;
      await type(document.getElementById('account-current-password'), mock.state.password);
      await type(document.getElementById('account-new-password'), 'encore-un-autre');
      await submit();
      assert.match(document.querySelector('dialog [role=alert]').textContent, pattern);
      assert.doesNotMatch(document.querySelector('dialog').textContent, /should/);
    }
    mock.state.updateError = { code: 'reauthentication_needed', message: 'Password update requires reauthentication' };
    await type(document.getElementById('account-current-password'), mock.state.password);
    await type(document.getElementById('account-new-password'), 'encore-un-autre');
    await submit();
    const alert = document.querySelector('dialog [role=alert]').textContent;
    assert.match(alert, /reconnectez-vous puis réessayez/);
    assert.doesNotMatch(alert, /reauthentication/);
    await click(button('Me reconnecter'), 'Me reconnecter');
    assert.equal(screen.where(), '/login');
  } finally { await screen.close(); }
});

test('connexion : retour sur Mon compte accepté, adresses externes refusées', () => {
  const login = readFileSync(resolve(src, 'pages/LoginPage.tsx'), 'utf8');
  const pattern = new RegExp(login.match(/requested && \/(.+?)\/\.test\(requested\)/)[1]);
  for (const ok of ['/profil', '/profil?returnTo=%2Fcours']) assert.ok(pattern.test(ok), ok);
  for (const bad of ['//profil', 'https://evil.test/profil', '/profilx', '/profil/../x']) assert.ok(!pattern.test(bad), bad);
});

test('accessibilité : le pourquoi est une description, pas le nom du bouton', async () => {
  const screen = await mountHub(api());
  try {
    const sex = row('Sexe');
    assert.equal(sex.getAttribute('aria-label'), 'Sexe, Femme');
    assert.match(document.getElementById(sex.getAttribute('aria-describedby')).textContent, /quotas des cours/);
    assert.doesNotMatch(document.body.textContent, /✓/);
  } finally { await screen.close(); }
});
