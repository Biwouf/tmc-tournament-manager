// P1-a du brief « Mon compte » : photo dans `Avatar` et URLs signées par lot (`useAvatarUrls`).
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { createRequire } from 'node:module';
import vm from 'node:vm';
import ts from 'typescript';
import { JSDOM } from 'jsdom';

const req = createRequire(new URL('../pwa/package.json', import.meta.url));
const dom = new JSDOM('<div id="root"></div>', { url: 'http://localhost/' });
globalThis.window = dom.window;
globalThis.document = dom.window.document;
globalThis.IS_REACT_ACT_ENVIRONMENT = true;
const React = req('react'), { act, createElement: h } = React;
const { createRoot } = req('react-dom/client');
const { QueryClient, QueryClientProvider } = req('@tanstack/react-query');
const src = resolve(new URL('../pwa/src', import.meta.url).pathname);

function loader(supabase) {
  const cache = new Map();
  function load(file) {
    if (file.endsWith('/lib/supabase.ts')) return { supabase };
    if (cache.has(file)) return cache.get(file).exports;
    const module = { exports: {} };
    cache.set(file, module);
    const code = ts.transpileModule(readFileSync(file, 'utf8'), {
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

/** Storage simulé : `unreadable` n'est pas signé, `fail` échoue les n premiers appels. */
function storage({ unreadable = [], fail = 0 } = {}) {
  const calls = [];
  const state = { fail };
  return {
    calls,
    supabase: { storage: { from: (bucket) => ({
      createSignedUrls: async (paths, ttl) => {
        calls.push({ bucket, paths, ttl });
        if (state.fail-- > 0) return { data: null, error: new Error('réseau') };
        return { error: null, data: paths.map((path) => (unreadable.some((u) => path.startsWith(u))
          ? { path, error: 'Either the object does not exist or you do not have access to it', signedUrl: 'https://x.test/storage/v1null' }
          : { path, error: null, signedUrl: `https://x.test/${path}?token=${calls.length}` })) };
      },
    }) } },
  };
}

const wait = (ms = 40) => act(async () => { await new Promise((r) => setTimeout(r, ms)); });

async function mount(element, options = {}) {
  const root = createRoot(document.getElementById('root'));
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, ...options } } });
  const render = (el) => act(async () => root.render(h(QueryClientProvider, { client }, el)));
  await render(element);
  await wait();
  return { client, render, close: async () => { await act(async () => root.unmount()); client.clear(); } };
}

/** Deux composants de la même page, comme une liste et l'en-tête. */
function page(load, seen) {
  const { useAvatarUrls } = load('hooks/useAvatarUrls.ts');
  const Part = ({ name, paths, size }) => { seen[name] = useAvatarUrls(paths, size); return null; };
  return (parts) => h(React.Fragment, null, parts.map((p) => h(Part, { key: p.name, ...p })));
}

test('useAvatarUrls : un seul appel par lot, doublons et vides écartés, 128 px ou 512 px', async () => {
  const mock = storage(), seen = {};
  const el = page(loader(mock.supabase), seen)([
    { name: 'liste', paths: ['u1/v1', null, 'u2/v1', 'u1/v1', undefined, ''], size: 40 },
    { name: 'hub', paths: ['u1/v1'], size: 88 },
    { name: 'vide', paths: [null], size: 26 },
  ]);
  const screen = await mount(el);
  try {
    assert.deepEqual(mock.calls, [{ bucket: 'avatars', paths: ['u1/v1-128', 'u2/v1-128', 'u1/v1-512'], ttl: 3600 }]);
    assert.deepEqual([...seen.liste.keys()], ['u1/v1', 'u2/v1']);
    assert.equal(seen.liste.get('u2/v1'), 'https://x.test/u2/v1-128?token=1');
    assert.equal(seen.hub.get('u1/v1'), 'https://x.test/u1/v1-512?token=1');
    assert.equal(seen.vide.size, 0);
  } finally { await screen.close(); }
});

test('useAvatarUrls : cache par chemin, seule une nouvelle version est signée', async () => {
  const mock = storage(), seen = {};
  const make = page(loader(mock.supabase), seen);
  const screen = await mount(make([{ name: 'a', paths: ['u1/v1', 'u2/v1'], size: 32 }]));
  try {
    await screen.render(make([{ name: 'b', paths: ['u2/v1', 'u1/v2'], size: 32 }]));
    await wait();
    assert.deepEqual(mock.calls.map((c) => c.paths), [['u1/v1-128', 'u2/v1-128'], ['u1/v2-128']]);
    assert.equal(seen.b.size, 2);
    const [query] = screen.client.getQueryCache().findAll({ queryKey: ['avatar-url', 'u1/v2-128'] });
    assert.equal(query.observers[0].options.staleTime, 50 * 60_000);
  } finally { await screen.close(); }
});

test('useAvatarUrls : une photo non visible garde les initiales sans gêner les autres', async () => {
  const mock = storage({ unreadable: ['u2/'] }), seen = {};
  const screen = await mount(page(loader(mock.supabase), seen)([{ name: 'a', paths: ['u1/v1', 'u2/v1'], size: 32 }]));
  try {
    assert.deepEqual([...seen.a.keys()], ['u1/v1']);
    assert.equal(mock.calls.length, 1);
  } finally { await screen.close(); }
});

test('useAvatarUrls : la nouvelle tentative et le rafraîchissement restent groupés', async () => {
  const mock = storage({ fail: 1 }), seen = {};
  const screen = await mount(page(loader(mock.supabase), seen)([{ name: 'a', paths: ['u1/v1', 'u2/v1', 'u3/v1'], size: 32 }]), { retry: 1, retryDelay: 20 });
  try {
    await wait(120);
    assert.equal(mock.calls.length, 2);
    assert.equal(mock.calls[1].paths.length, 3);
    assert.equal(seen.a.size, 3);
    await act(async () => { await screen.client.refetchQueries({ queryKey: ['avatar-url'] }); });
    await wait();
    assert.equal(mock.calls.length, 3);
    assert.equal(seen.a.get('u1/v1'), 'https://x.test/u1/v1-128?token=3');
  } finally { await screen.close(); }
});

test('Avatar : initiales pendant le chargement et en erreur, photo ensuite, jamais d’icône cassée', async () => {
  const Avatar = loader({})('components/Avatar.tsx').default;
  const person = { id: 'u1', prenom: 'Léa', nom: 'Martin' };
  const screen = await mount(h(Avatar, { person, size: 40 }));
  const span = () => document.querySelector('#root > span');
  const img = () => document.querySelector('img');
  const fire = (type) => act(async () => img().dispatchEvent(new dom.window.Event(type)));
  const hidden = () => img().className.includes('opacity-0');
  try {
    assert.equal(span().textContent, 'LM');
    assert.equal(img(), null);

    const url = 'https://x.test/u1/v1-128?token=1';
    await screen.render(h(Avatar, { person, size: 40, src: url }));
    assert.equal(img().getAttribute('src'), url);
    assert.equal(img().getAttribute('alt'), '');
    assert.equal(img().getAttribute('loading'), 'lazy');
    assert.equal(img().getAttribute('decoding'), 'async');
    assert.equal(span().getAttribute('aria-hidden'), 'true');
    assert.ok(hidden());
    assert.equal(span().textContent, 'LM');
    await fire('error');
    assert.ok(hidden());
    await fire('load');
    assert.ok(!hidden());

    // Re-signée : la photo affichée reste. Nouvelle version : initiales jusqu'au chargement.
    await screen.render(h(Avatar, { person, size: 40, src: url.replace('token=1', 'token=2') }));
    assert.ok(!hidden());
    await screen.render(h(Avatar, { person, size: 40, src: 'https://x.test/u1/v2-128?token=3' }));
    assert.ok(hidden());

    await screen.render(h(Avatar, { person: null, size: 40, src: url }));
    assert.equal(img(), null);
    assert.equal(span().textContent, '');
  } finally { await screen.close(); }
});
