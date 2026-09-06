import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import { createRequire } from 'node:module';
import { resolve, dirname } from 'node:path';
import test from 'node:test';
import vm from 'node:vm';
import ts from 'typescript';
import { JSDOM } from 'jsdom';

const dom = new JSDOM('<div id="root"></div>', { url: 'http://localhost/' });
globalThis.window = dom.window;
globalThis.document = dom.window.document;
globalThis.sessionStorage = dom.window.sessionStorage;
globalThis.IS_REACT_ACT_ENVIRONMENT = true;
const requirePwa = createRequire(new URL('../pwa/package.json', import.meta.url));
const React = requirePwa('react');
const { act, createElement: h, StrictMode } = React;
const { createRoot } = requirePwa('react-dom/client');
const { useQueryClient } = requirePwa('@tanstack/react-query');
let activeClient;
function Probe({ children }) { activeClient = useQueryClient(); return children; }
const src = resolve(new URL('../pwa/src', import.meta.url).pathname);
const clients = [];
const counters = {};
let session = null;
const authListeners = new Set();
const channels = [];
let clubId = 'club-a';
let refreshFeed;
const records = {
  club_settings: { config: { brand: { color: '#112233' } } },
  actus: [],
  live_matches: [{ id: 'match-a', scored_by: 'scorer-a', status: 'live', match_date: '2099-01-01' }],
  profiles: [{ id: 'scorer-a', prenom: 'Test', nom: 'Score' }],
};
const supabase = {
  auth: {
    onAuthStateChange(callback) {
      authListeners.add(callback);
      queueMicrotask(() => { if (authListeners.has(callback)) callback('INITIAL_SESSION', session); });
      return { data: { subscription: { unsubscribe: () => authListeners.delete(callback) } } };
    },
  },
  from(table) {
    const builder = {
      select() { return this; }, eq() { return this; }, gte() { return this; },
      order() { return this; }, in() { return this; }, range() { return this; },
      maybeSingle() { return this; },
      then(done, fail) {
        counters[table] = (counters[table] ?? 0) + 1;
        return Promise.resolve({ data: structuredClone(records[table]), error: null }).then(done, fail);
      },
    };
    return builder;
  },
  channel(name) {
    const channel = {
      name, handlers: [], removed: false,
      on(_type, filter, callback) { this.handlers.push({ filter, callback }); return this; },
      subscribe(callback) { this.status = callback; callback?.('SUBSCRIBED'); return this; },
    };
    channels.push(channel);
    return channel;
  },
  removeChannel(channel) { channel.removed = true; },
};
const modules = new Map();
const mocks = new Map([
  ['lib/supabase.ts', { supabase }],
  ['contexts/ClubContext.tsx', { useClub: () => ({ clubId }) }],
  ['components/layout/HeaderActionContext.tsx', { useHeaderAction() {} }],
  ['components/matches/MatchCard.tsx', { default: ({ match }) => h('p', null, match.id) }],
  ['components/actus/ActuCard.tsx', { default: () => null }],
  ['components/layout/PullToRefreshWrapper.tsx', { default: ({ children, onRefresh }) => { refreshFeed = onRefresh; return children; } }],
].map(([file, value]) => [resolve(src, file), { ...value, __esModule: true }]));
function load(file) {
  const full = resolve(src, file);
  if (mocks.has(full)) return mocks.get(full);
  if (modules.has(full)) return modules.get(full).exports;
  const module = { exports: {} };
  modules.set(full, module);
  const code = ts.transpileModule(readFileSync(full, 'utf8'), {
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX, esModuleInterop: true },
  }).outputText;
  const require = (name) => {
    if (name === 'react-router-dom') return { useNavigate: () => () => {} };
    if (!name.startsWith('.')) return requirePwa(name);
    const base = resolve(dirname(full), name);
    const path = [base, `${base}.ts`, `${base}.tsx`].find(p => existsSync(p));
    return load(path);
  };
  vm.runInThisContext(`(function(require,module,exports){${code}\n})`, { filename: full })(require, module, module.exports);
  if (full.endsWith('/lib/queryClient.ts')) {
    const create = module.exports.createPwaQueryClient;
    module.exports.createPwaQueryClient = () => { const client = create(); clients.push(client); return client; };
  }
  return module.exports;
}
const { AuthProvider } = load('contexts/AuthProvider.tsx');
const { SessionQueryProvider } = load('contexts/SessionQueryProvider.tsx');
const { useClubConfig } = load('hooks/useClubConfig.ts');
const { default: MatchesPage } = load('pages/MatchesPage.tsx');
const { default: ActusFeed } = load('components/actu/ActusFeed.tsx');
const { createPwaQueryClient } = load('lib/queryClient.ts');
const { subscribeToMatchList } = load('lib/liveMatchesSubscription.ts');
const wait = (ms = 25) => new Promise(resolve => setTimeout(resolve, ms));
async function settle() { await act(async () => { await wait(); }); }
function Config() { return h('span', null, useClubConfig().config.brand.color ?? 'default'); }
function tree(children) { return h(StrictMode, null, h(AuthProvider, null, h(SessionQueryProvider, null, h(Probe, null, children)))); }
async function emit(event, user) {
  await act(async () => {
    session = user ? { user: { id: user } } : null;
    for (const callback of authListeners) callback(event, session);
  });
  await settle();
}
async function mount(children) {
  const root = createRoot(document.getElementById('root'));
  await act(async () => root.render(tree(children)));
  await settle();
  return root;
}
async function cleanup(root) {
  await act(async () => root.unmount());
  for (const client of clients.splice(0)) client.clear();
  for (const key of Object.keys(counters)) delete counters[key];
  channels.length = 0;
  clubId = 'club-a';
  session = null;
}

test('three config consumers: one authenticated request, none anon, stable on token refresh, isolated on logout', async () => {
  const root = await mount(h(React.Fragment, null, h(Config), h(Config), h(Config)));
  try {
    assert.equal(counters.club_settings ?? 0, 0);
    assert.equal(authListeners.size, 1, 'one shared auth subscription, including StrictMode');
    await emit('SIGNED_IN', 'user-a');
    assert.equal(counters.club_settings, 1);
    assert.equal(document.querySelectorAll('span')[0].textContent, '#112233');
    const accountClient = activeClient;
    accountClient.setQueryData(['private'], 'account A');
    await emit('TOKEN_REFRESHED', 'user-a');
    await emit('SIGNED_IN', 'user-a');
    assert.equal(counters.club_settings, 1);
    await emit('SIGNED_OUT', null);
    assert.equal(document.querySelectorAll('span')[0].textContent, 'default');
    assert.equal(activeClient.getQueryData(['private']), undefined);
    await emit('SIGNED_IN', 'user-b');
    assert.equal(counters.club_settings, 2);
    assert.equal(activeClient.getQueryData(['private']), undefined);
  } finally { await cleanup(root); }
});

test('feed navigation reuses fresh data; manual refresh, stale data and a different club fetch again', async () => {
  const root = await mount(h(ActusFeed));
  try {
    assert.equal(counters.actus, 1);
    await act(async () => root.render(tree(null)));
    await act(async () => root.render(tree(h(ActusFeed))));
    await settle();
    assert.equal(counters.actus, 1, 'return within 60 seconds');
    await act(async () => { await refreshFeed(); });
    assert.equal(counters.actus, 2, 'explicit refresh bypasses freshness');
    const client = activeClient;
    await act(async () => root.render(tree(null)));
    client.setQueryData(['actus', clubId], client.getQueryData(['actus', clubId]), { updatedAt: Date.now() - 61_000 });
    await act(async () => root.render(tree(h(ActusFeed))));
    await settle();
    assert.equal(counters.actus, 3, 'expired cache refetches');
    clubId = 'club-b';
    await act(async () => root.render(tree(h(ActusFeed))));
    await settle();
    assert.equal(counters.actus, 4, 'another club never reuses the first club feed');
  } finally { await cleanup(root); }
});

test('Live: a score burst causes one list request and no repeated profile request; new scorer fetches profiles', async () => {
  const root = await mount(h(MatchesPage));
  try {
    for (let i = 0; i < 10 && !counters.profiles; i++) await settle();
    assert.equal(counters.live_matches, 1);
    assert.equal(counters.profiles, 1, JSON.stringify(activeClient.getQueryCache().getAll().map(q => ({key:q.queryKey,state:q.state})), null, 2));
    const channel = channels.findLast(c => !c.removed);
    const update = channel.handlers.find(h => h.filter.event === 'UPDATE');
    assert.equal(update.filter.filter, 'club_id=eq.club-a');
    assert.equal(activeClient.getQueryCache().find({ queryKey: ['matches', clubId] }).options.refetchInterval, 30_000);
    records.live_matches[0].set1_j1 = 2;
    await act(async () => {
      for (let i = 0; i < 10; i++) update.callback({});
      await wait(300);
    });
    await settle();
    assert.equal(counters.live_matches, 2);
    assert.equal(counters.profiles, 1);
    records.live_matches[0].scored_by = 'scorer-b';
    await act(async () => { update.callback({}); await wait(300); });
    await settle();
    assert.equal(counters.profiles, 2);
  } finally { records.live_matches[0].scored_by = 'scorer-a'; await cleanup(root); }
});

test('Live: deletes, reconnect and cleanup invalidate only the current club', async () => {
  const client = createPwaQueryClient();
  client.setQueryData(['matches', 'club-a'], [{ id: 'match-a' }]);
  client.setQueryData(['matches', 'club-b'], [{ id: 'match-b' }]);
  const stop = subscribeToMatchList(supabase, client, 'club-a');
  try {
    const channel = channels.at(-1);
    const remove = channel.handlers.find(h => h.filter.event === 'DELETE').callback;
    remove({ old: { id: 'match-b' } });
    await wait(300);
    assert.equal(client.getQueryState(['matches', 'club-a']).isInvalidated, false);
    remove({ old: { id: 'match-a' } });
    await wait(300);
    assert.equal(client.getQueryState(['matches', 'club-a']).isInvalidated, true);
    assert.equal(client.getQueryState(['matches', 'club-b']).isInvalidated, false);
    client.setQueryData(['matches', 'club-a'], [{ id: 'match-a' }]);
    channel.status('CHANNEL_ERROR'); channel.status('SUBSCRIBED');
    await wait(300);
    assert.equal(client.getQueryState(['matches', 'club-a']).isInvalidated, true);
    client.setQueryData(['matches', 'club-a'], [{ id: 'match-a' }]);
    remove({ old: { id: 'match-a' } });
    stop();
    await wait(300);
    assert.equal(client.getQueryState(['matches', 'club-a']).isInvalidated, false);
    assert.equal(channel.removed, true);
  } finally { stop(); client.clear(); }
});
