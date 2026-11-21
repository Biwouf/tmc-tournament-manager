// P0-a du brief « Mon compte » : un compte connecté non membre (demande en attente, refusée,
// retirée) ou privé de réseau doit pouvoir ouvrir /profil et se déconnecter.
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
const React = req('react'), { act, createElement: h } = React;
const { createRoot } = req('react-dom/client');
const { MemoryRouter, Routes, Route, useLocation } = req('react-router-dom');
const { QueryClient, QueryClientProvider } = req('@tanstack/react-query');
const src = resolve(new URL('../pwa/src', import.meta.url).pathname);

function api({ context = null, error = null } = {}) {
  const calls = [];
  return {
    calls,
    supabase: {
      auth: { signOut: async () => { calls.push('signOut'); return { error: null }; } },
      rpc(name, args) {
        calls.push(name);
        return {
          abortSignal: () => Promise.resolve(
            name === 'course_my_context'
              ? (error ? { data: null, error: { message: error } } : { data: structuredClone(context) })
              : { data: null },
          ),
        };
      },
    },
  };
}

function loader(mock, user) {
  const cache = new Map();
  const push = new Proxy({
    coursePushSupported: () => false,
    disableCoursePush: async () => { mock.calls.push('disableCoursePush'); },
  }, { get: (t, k) => (k in t ? t[k] : async () => null) });
  function load(file) {
    if (file.endsWith('.css')) return {};
    if (file.endsWith('/lib/supabase.ts')) return { supabase: mock.supabase };
    if (file.endsWith('/hooks/useAuth.ts')) return { useAuth: () => ({ user, loading: false }) };
    if (file.endsWith('/contexts/ClubContext.tsx')) return { useClub: () => ({ clubId: 'club-a' }) };
    if (file.endsWith('/lib/coursePush.ts')) return push;
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
const button = (label) => [...document.querySelectorAll('button')].find((b) => b.textContent === label);
const NON_MEMBER = { is_member: false, can_manage: false, signup_status: 'pending', profile: null };

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

test('RequireUser ouvre /profil à un compte connecté non membre', async () => {
  const mock = api({ context: NON_MEMBER });
  const screen = await mount(loader(mock, { id: 'me' }), 'RequireUser');
  try {
    assert.equal(screen.where(), '/profil');
    assert.match(document.body.textContent, /page profil/);
  } finally { await screen.close(); }
});

test('RequireUser renvoie un visiteur déconnecté vers /login', async () => {
  const mock = api({ context: NON_MEMBER });
  const screen = await mount(loader(mock, null), 'RequireUser');
  try {
    assert.equal(screen.where(), '/login');
  } finally { await screen.close(); }
});

test('RequireAuth garde les pages membres fermées à un non-membre', async () => {
  const mock = api({ context: NON_MEMBER });
  const screen = await mount(loader(mock, { id: 'me' }), 'RequireAuth');
  try {
    assert.equal(screen.where(), '/actu');
  } finally { await screen.close(); }
});

for (const status of ['pending', 'denied', 'revoked']) {
  test(`/profil d'un compte ${status} : un seul message et la déconnexion`, async () => {
    const mock = api({ context: { ...NON_MEMBER, signup_status: status } });
    const load = loader(mock, { id: 'me' });
    const ProfilePage = load('pages/ProfilePage.tsx').default;
    const SignupNotice = load('components/SignupNotice.tsx').default;
    const screen = await mount(load, 'RequireUser', h(React.Fragment, null, h(SignupNotice), h(ProfilePage)));
    try {
      assert.equal(screen.where(), '/profil');
      assert.doesNotMatch(document.body.textContent, /doit être rattaché/);
      assert.equal(document.querySelectorAll('aside[role=status]').length, 1);
      assert.ok(button('Se déconnecter'));
      await act(async () => button('Se déconnecter').click());
      await flush();
      assert.deepEqual(mock.calls.filter((c) => c !== 'course_my_context'), ['disableCoursePush', 'signOut']);
      assert.equal(screen.where(), '/actu');
    } finally { await screen.close(); }
  });
}

test('/profil sans demande d\'inscription garde le message de rattachement', async () => {
  const mock = api({ context: { ...NON_MEMBER, signup_status: null } });
  const load = loader(mock, { id: 'me' });
  const screen = await mount(load, 'RequireUser', h(load('pages/ProfilePage.tsx').default));
  try {
    assert.match(document.body.textContent, /doit être rattaché/);
    assert.ok(button('Se déconnecter'));
  } finally { await screen.close(); }
});

test('/profil reste ouvert et déconnectable quand course_my_context échoue', async () => {
  const mock = api({ error: 'Failed to fetch' });
  const load = loader(mock, { id: 'me' });
  const screen = await mount(load, 'RequireUser', h(load('pages/ProfilePage.tsx').default));
  try {
    assert.equal(screen.where(), '/profil');
    assert.ok(document.querySelector('[role=alert]'));
    assert.ok(button('Actualiser'));
    assert.ok(button('Se déconnecter'));
    await act(async () => button('Se déconnecter').click());
    await flush();
    assert.ok(mock.calls.includes('signOut'));
  } finally { await screen.close(); }
});

test('App.tsx protège /profil par RequireUser, pas par RequireAuth', () => {
  const app = readFileSync(resolve(src, 'App.tsx'), 'utf8');
  assert.match(app, /path="\/profil" element=\{<RequireUser><ProfilePage \/><\/RequireUser>\}/);
});
