import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { createRequire } from 'node:module';
import vm from 'node:vm';
import ts from 'typescript';
import { JSDOM } from 'jsdom';
const req = createRequire(new URL('../pwa/package.json', import.meta.url));
const dom = new JSDOM('<div id="root"></div>', { url: 'http://localhost/matches' });
globalThis.window = dom.window;
globalThis.document = dom.window.document;
globalThis.HTMLElement = dom.window.HTMLElement;
globalThis.localStorage = dom.window.localStorage;
globalThis.IS_REACT_ACT_ENVIRONMENT = true;
const React = req('react'), { act, createElement: h } = React;
const { createRoot } = req('react-dom/client');
const { MemoryRouter } = req('react-router-dom');
const { QueryClient, QueryClientProvider } = req('@tanstack/react-query');
const src = resolve(new URL('../pwa/src', import.meta.url).pathname);

function harness({ prefs = null, supported = true } = {}) {
  const calls = [];
  let follows = [];
  const push = {
    coursePushSupported: () => supported,
    syncPush: async () => prefs,
    enablePush: async (_club, _user, patch) => {
      calls.push(['enablePush', patch]);
      prefs = { courses: prefs?.courses ?? false, live: patch.live ?? prefs?.live ?? false };
      return prefs;
    },
    disablePushCategory: async (_club, _user, patch) => {
      calls.push(['disablePushCategory', patch]);
      prefs = { ...prefs, ...patch };
      return prefs;
    },
    onPushPreferences: () => () => {},
  };
  const supabase = {
    rpc: async (name, args) => {
      calls.push([name, args]);
      if (name === 'live_my_follows') return { data: follows, error: null };
      if (name === 'live_follow') {
        follows = args.p_on ? [...follows, args.p_match] : follows.filter((id) => id !== args.p_match);
        return { data: args.p_on, error: null };
      }
      return { data: null, error: null };
    },
  };
  const cache = new Map();
  function load(file) {
    if (file.endsWith('.css')) return {};
    if (file.endsWith('/lib/supabase.ts')) return { supabase };
    if (file.endsWith('/lib/coursePush.ts')) return push;
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
  return { calls, live: load(resolve(src, 'components/live/LivePush.tsx')) };
}

const flush = () => act(async () => { await new Promise((r) => setTimeout(r, 15)); });
const buttons = () => [...document.querySelectorAll('button')];
const button = (text) => buttons().find((b) => b.textContent.includes(text));
async function click(text) {
  assert.ok(button(text), `button ${text}`);
  await act(async () => button(text).click());
  await flush();
}
async function mount(element) {
  const root = createRoot(document.getElementById('root'));
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } });
  await act(async () => root.render(h(QueryClientProvider, { client }, h(MemoryRouter, null, element))));
  await flush();
  return { close: () => act(async () => root.unmount()) };
}

test('follow bell subscribes the device first, then toggles the match alerts', async () => {
  const { calls, live } = harness();
  const screen = await mount(h(live.LiveFollowButton, { clubId: 'club', userId: 'me', matchId: 'm1' }));
  try {
    assert.equal(button('Alertes').getAttribute('aria-pressed'), 'false');
    await click('Alertes');
    assert.deepEqual(calls.filter(([n]) => n !== 'live_my_follows').map(([n]) => n), ['enablePush', 'live_follow']);
    assert.deepEqual(calls.find(([n]) => n === 'enablePush')[1], {}, 'following never changes the device preferences');
    assert.match(document.body.textContent, /Alertes activées/);
    await click('Alertes activées');
    assert.equal(calls.filter(([n]) => n === 'enablePush').length, 1);
    assert.equal(calls.at(-1)[1].p_on, false);
    assert.doesNotMatch(document.body.textContent, /Alertes activées/);
  } finally { await screen.close(); }
});

test('list cards show the bell alone, with an accessible name and tooltip', async () => {
  const { live } = harness();
  const screen = await mount(h(live.LiveFollowButton, { clubId: 'club', userId: 'me', matchId: 'm1', iconOnly: true }));
  try {
    const bell = buttons()[0];
    assert.equal(bell.textContent, '');
    assert.equal(bell.getAttribute('aria-label'), 'Recevoir les alertes de ce match');
    assert.equal(bell.getAttribute('title'), 'Alertes');
    await act(async () => bell.click());
    await flush();
    assert.equal(buttons()[0].getAttribute('aria-pressed'), 'true');
    assert.equal(buttons()[0].getAttribute('title'), 'Alertes activées');
  } finally { await screen.close(); }
});

test('follow bell reports each successful change (live page toast)', async () => {
  const { live } = harness();
  const changes = [];
  const screen = await mount(h(live.LiveFollowButton, {
    clubId: 'club', userId: 'me', matchId: 'm1', iconOnly: true, onChange: (on) => changes.push(on),
  }));
  try {
    await act(async () => buttons()[0].click()); await flush();
    await act(async () => buttons()[0].click()); await flush();
    assert.deepEqual(changes, [true, false]);
  } finally { await screen.close(); }
});

test('follow bell is hidden where push is unsupported', async () => {
  const { live } = harness({ supported: false });
  const screen = await mount(h(live.LiveFollowButton, { clubId: 'club', userId: 'me', matchId: 'm1' }));
  try { assert.equal(buttons().length, 0); } finally { await screen.close(); }
});

test('live home banner: visitors are invited to log in, « Plus tard » is remembered', async () => {
  localStorage.clear();
  const { live } = harness();
  let screen = await mount(h(live.LivePushBanner, { clubId: 'club', userId: null, isMember: false }));
  try {
    assert.ok([...document.querySelectorAll('a')].some((a) => a.textContent === 'Se connecter'));
    await click('Plus tard');
    assert.doesNotMatch(document.body.textContent, /Se connecter/);
  } finally { await screen.close(); }
  screen = await mount(h(live.LivePushBanner, { clubId: 'club', userId: null, isMember: false }));
  try { assert.doesNotMatch(document.body.textContent, /Se connecter/); } finally { await screen.close(); }
});

test('live home banner: a member turns Live alerts on; nothing shows once they are on', async () => {
  localStorage.clear();
  const { calls, live } = harness({ prefs: { courses: true, live: false } });
  let screen = await mount(h(live.LivePushBanner, { clubId: 'club', userId: 'me', isMember: true }));
  try {
    await click('Activer');
    assert.deepEqual(calls.find(([n]) => n === 'enablePush')[1], { live: true });
    assert.match(document.body.textContent, /Alertes Live activées/);
  } finally { await screen.close(); }
  const on = harness({ prefs: { courses: false, live: true } });
  screen = await mount(h(on.live.LivePushBanner, { clubId: 'club', userId: 'me', isMember: true }));
  try { assert.equal(buttons().length, 0); } finally { await screen.close(); }
});

test('profile switch is disabled where push is unsupported', async () => {
  const { live } = harness({ supported: false });
  const screen = await mount(h(live.LivePushSettings, { clubId: 'club', userId: 'me' }));
  try { assert.equal(document.querySelector('[role="switch"]').disabled, true); } finally { await screen.close(); }
});

test('profile switch turns Live alerts on and off without unsubscribing the device', async () => {
  const { calls, live } = harness({ prefs: { courses: true, live: false } });
  const screen = await mount(h(live.LivePushSettings, { clubId: 'club', userId: 'me' }));
  try {
    const toggle = async () => {
      const row = document.querySelector('[role="switch"]');
      await act(async () => row.click());
      await flush();
      return document.querySelector('[role="switch"]').getAttribute('aria-checked');
    };
    assert.equal(document.querySelector('[role="switch"]').getAttribute('aria-label'), 'Live');
    assert.match(document.body.textContent, /Début des matchs du club\./);
    assert.equal(await toggle(), 'true');
    assert.equal(await toggle(), 'false');
    assert.deepEqual(calls.map(([n, a]) => [n, a]), [['enablePush', { live: true }], ['disablePushCategory', { live: false }]]);
  } finally { await screen.close(); }
});
