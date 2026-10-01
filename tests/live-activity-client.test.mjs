import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import { createRequire } from 'node:module';
import { resolve, dirname } from 'node:path';
import vm from 'node:vm';
import ts from 'typescript';
import { JSDOM } from 'jsdom';

const dom = new JSDOM('<div id="root"></div>', {
  url: 'http://localhost/matches/match-a',
});
globalThis.window = dom.window;
globalThis.document = dom.window.document;
globalThis.FormData = dom.window.FormData;
globalThis.IS_REACT_ACT_ENVIRONMENT = true;
dom.window.HTMLDialogElement.prototype.showModal = function () {
  this.setAttribute('open', '');
};
dom.window.HTMLDialogElement.prototype.close = function () {
  this.removeAttribute('open');
};
window.confirm = () => true;
const req = createRequire(new URL('../pwa/package.json', import.meta.url));
const React = req('react');
const { act, createElement: h } = React;
const { createRoot } = req('react-dom/client');
const { MemoryRouter, Routes, Route, useLocation } = req('react-router-dom');
const { QueryClient, QueryClientProvider } = req('@tanstack/react-query');
const src = resolve(new URL('../pwa/src', import.meta.url).pathname);

function loader(mocks) {
  const cache = new Map();
  function load(file) {
    if (file.endsWith('.css')) return {};
    for (const [suffix, value] of Object.entries(mocks))
      if (file.endsWith(suffix)) return value;
    if (cache.has(file)) return cache.get(file).exports;
    const module = { exports: {} };
    cache.set(file, module);
    const code = ts.transpileModule(readFileSync(file, 'utf8'), {
      compilerOptions: {
        target: ts.ScriptTarget.ES2022,
        module: ts.ModuleKind.CommonJS,
        jsx: ts.JsxEmit.ReactJSX,
      },
    }).outputText;
    const require = (name) => {
      if (!name.startsWith('.')) return req(name);
      const path = resolve(dirname(file), name);
      return load([path, `${path}.ts`, `${path}.tsx`].find(existsSync));
    };
    vm.runInThisContext(`(function(require,module,exports){${code}\n})`, {
      filename: file,
    })(require, module, module.exports);
    return module.exports;
  }
  return load;
}

function setup(user, canAnimate, finished = false, overrides = {}) {
  let match = {
    id: 'match-a',
    club_id: 'club-a',
    revision: 1,
    scored_by: 'other-member',
    status: finished ? 'finished' : 'live',
    match_type: 'simple',
    match_date: '2026-09-30',
    j1_prenom: 'Alex',
    j1_nom: 'A',
    j2_prenom: 'Sam',
    j2_nom: 'B',
    set1_j1: 4,
    set1_j2: 3,
    set1_tb_j1: null,
    set1_tb_j2: null,
    set2_j1: null,
    set2_j2: null,
    set2_tb_j1: null,
    set2_tb_j2: null,
    set3_j1: null,
    set3_j2: null,
    set3_tb_j1: null,
    set3_tb_j2: null,
    set3_format: null,
    retired_player: null,
    winner: null,
    finished_at: null,
    court: '2',
    created_at: new Date().toISOString(),
    ...overrides,
  };
  const posts = [
    {
      id: 'poll-a',
      sequence: 1,
      kind: 'poll',
      body: 'Qui gagne ?',
      author_name: 'Camille',
      created_at: new Date().toISOString(),
      score: {},
      options: ['Alex', 'Sam'],
      closed: false,
      total: 0,
      my_vote: null,
      counts: null,
    },
  ];
  const calls = [];
  const scoreWrites = [];
  const channels = new Set();
  let failAccepted = false;
  const supabase = {
    channel() {
      const handlers = [];
      const channel = {
        handlers,
        on(_event, filter, callback) {
          handlers.push({ filter, callback });
          return this;
        },
        subscribe(callback) {
          if (callback) queueMicrotask(() => callback('SUBSCRIBED'));
          return this;
        },
      };
      channels.add(channel);
      return channel;
    },
    removeChannel(channel) {
      channels.delete(channel);
    },
    from() {
      let patch;
      const filters = {};
      return {
        select() {
          return this;
        },
        eq(k, v) {
          filters[k] = v;
          return this;
        },
        update(value) {
          patch = value;
          return this;
        },
        abortSignal() {
          return this;
        },
        async single() {
          if (patch) {
            scoreWrites.push(patch);
            if (filters.revision !== match.revision)
              return { error: { message: 'Score changé' }, data: null };
            match = { ...match, ...patch, revision: match.revision + 1 };
          }
          return { data: { ...match }, error: null };
        },
      };
    },
    rpc(name, params) {
      return {
        abortSignal() {
          return Promise.resolve().then(() => {
            if (name === 'live_activity_page')
              return {
                data: {
                  items: posts.map((p) => ({
                    ...p,
                    closed: p.closed || match.status !== 'live',
                  })),
                  before: 1,
                  has_more: false,
                  can_animate: canAnimate,
                },
                error: null,
              };
            calls.push(params);
            const { p_action: action, p_data: data } = params;
            if (action === 'message' || action === 'poll') {
              if (!posts.some((p) => p.id === data.id))
                posts.push({
                  id: data.id,
                  sequence: posts.length + 1,
                  kind: action,
                  body: data.body,
                  options: data.options ?? [],
                  author_name: 'Vous',
                  created_at: new Date().toISOString(),
                  score: { set1_j1: match.set1_j1, set1_j2: match.set1_j2 },
                  closed: false,
                  my_vote: null,
                  total: 0,
                  counts: null,
                });
              if (failAccepted) {
                failAccepted = false;
                return {
                  error: { message: 'Connexion interrompue' },
                  data: null,
                };
              }
            } else if (action === 'vote') {
              const post = posts.find((p) => p.id === data.id);
              post.total = 1;
              post.my_vote = data.option;
              post.counts = post.options.map((_, i) =>
                i === data.option ? 1 : 0,
              );
            } else if (action === 'close')
              posts.find((p) => p.id === data.id).closed = true;
            else if (action === 'delete')
              posts.splice(
                posts.findIndex((p) => p.id === data.id),
                1,
              );
            return { data: { id: data.id }, error: null };
          });
        },
      };
    },
  };
  const load = loader({
    '/lib/supabase.ts': { supabase },
    '/contexts/ClubContext.tsx': { useClub: () => ({ clubId: 'club-a' }) },
    '/hooks/useAuth.ts': {
      useAuth: () => ({ user: user ? { id: user } : null, loading: false }),
    },
  });
  const Page = load(resolve(src, 'pages/LiveMatchPage.tsx')).default;
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false, gcTime: 0 } },
  });
  const root = createRoot(document.getElementById('root'));
  const flush = () =>
    act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 30));
    });
  let loginFrom;
  function Login() {
    loginFrom = useLocation().state?.from;
    return h('p', null, 'Connexion');
  }
  const mount = async () => {
    await act(async () =>
      root.render(
        h(
          QueryClientProvider,
          { client },
          h(
            MemoryRouter,
            { initialEntries: ['/matches/match-a'] },
            h(
              Routes,
              null,
              h(Route, { path: '/matches/:id', element: h(Page) }),
              h(Route, { path: '/login', element: h(Login) }),
            ),
          ),
        ),
      ),
    );
    await flush();
    await flush();
  };
  const dispose = async () => {
    await act(async () => root.unmount());
    client.clear();
  };
  const button = (label) =>
    [...document.querySelectorAll('button')].find(
      (b) =>
        b.getAttribute('aria-label') === label ||
        b.textContent.trim() === label,
    );
  const click = async (label) => {
    const el = typeof label === 'string' ? button(label) : label;
    assert.ok(el, `button ${label} exists`);
    await act(async () => el.click());
    await flush();
  };
  const type = async (selector, value) => {
    const input = document.querySelector(selector);
    assert.ok(input);
    const proto =
      input.tagName === 'TEXTAREA'
        ? window.HTMLTextAreaElement.prototype
        : window.HTMLInputElement.prototype;
    await act(async () => {
      Object.getOwnPropertyDescriptor(proto, 'value').set.call(input, value);
      input.dispatchEvent(new window.Event('input', { bubbles: true }));
    });
  };
  const emit = async (table, row) => {
    await act(async () => {
      for (const channel of channels)
        for (const { filter, callback } of channel.handlers)
          if (filter.table === table) callback({ new: row });
    });
    await flush();
  };
  return {
    mount,
    dispose,
    click,
    type,
    button,
    calls,
    scoreWrites,
    posts,
    load,
    flush,
    emit,
    match: () => match,
    remoteScore: async (patch) => {
      match = { ...match, ...patch, revision: match.revision + 1 };
      await emit('live_matches', { ...match });
    },
    failNextAccepted: () => {
      failAccepted = true;
    },
    loginFrom: () => loginFrom,
  };
}

test('Visitor: public live and login return path; finished live is read only', async () => {
  const screen = setup(null, false);
  try {
    await screen.mount();
    assert.match(document.body.textContent, /Alex A/);
    assert.equal(screen.button('Publier le commentaire'), undefined);
    assert.equal(screen.button('+ jeu pour Alex A'), undefined);
    await screen.click('Ouvrir les réactions');
    assert.equal(screen.loginFrom(), '/matches/match-a');
  } finally {
    await screen.dispose();
  }
  const ended = setup('spectator', false, true);
  try {
    await ended.mount();
    assert.equal(ended.button('Ouvrir les réactions'), undefined);
    await ended.click('Résultats');
    assert.ok(
      [...document.querySelectorAll('.poll-options button')].every(
        (b) => b.disabled,
      ),
    );
  } finally {
    await ended.dispose();
  }
});

test('Spectator: mutable unique vote, no text composer, unrestricted emoji combo and independent senders', async () => {
  const screen = setup('spectator', false);
  try {
    await screen.mount();
    assert.equal(document.querySelector('textarea'), null);
    await screen.click('Répondre');
    await screen.click(document.querySelectorAll('.poll-options button')[0]);
    assert.equal(screen.posts[0].total, 1);
    assert.equal(screen.posts[0].my_vote, 0);
    await screen.click(document.querySelectorAll('.poll-options button')[1]);
    assert.equal(screen.posts[0].total, 1);
    assert.equal(screen.posts[0].my_vote, 1);
    await screen.click('Fermer');
    await screen.click('Ouvrir les réactions');
    for (let i = 0; i < 4; i++) await screen.click('Applaudir');
    assert.equal(
      screen.calls.filter((c) => c.p_action === 'reaction').length,
      4,
      'no cooldown',
    );
    assert.equal(document.querySelectorAll('.emoji-combo').length, 1);
    assert.doesNotMatch(
      document.body.textContent,
      /encouragement envoyé|Un instant|Animation/,
    );
    await screen.emit('live_reactions', {
      id: 'remote-1',
      user_id: 'remote',
      match_id: 'match-a',
      emoji: '❤️',
      created_at: new Date().toISOString(),
    });
    for (let i = 0; i < 4; i++) await screen.click('Soutenir');
    assert.equal(
      document.querySelectorAll('.emoji-single').length,
      1,
      'a local combo leaves another sender reaction intact',
    );
  } finally {
    await screen.dispose();
  }
});

test('Member: shared scoring, successive undo, remote revision, durable retry and simultaneous polls', async () => {
  const screen = setup('member', true);
  try {
    await screen.mount();
    assert.equal(screen.button('Ouvrir les réactions'), undefined);
    await screen.click('+ jeu pour Alex A');
    await screen.click('+ jeu pour Sam B');
    assert.equal(screen.match().set1_j1, 5);
    assert.equal(screen.match().set1_j2, 4);
    await screen.click('↶ Annuler');
    assert.equal(screen.match().set1_j2, 3);
    await screen.click('↶ Annuler');
    assert.equal(screen.match().set1_j1, 4);
    await screen.click('+ jeu pour Alex A');
    await screen.remoteScore({ set1_j2: 4 });
    assert.equal(
      screen.button('↶ Annuler'),
      undefined,
      'never undo another member update',
    );
    await screen.type('textarea', 'Quel échange !');
    screen.failNextAccepted();
    await screen.click('Publier le commentaire');
    assert.match(document.body.textContent, /Connexion interrompue/);
    assert.equal(document.querySelector('textarea').value, 'Quel échange !');
    await screen.click('Publier le commentaire');
    const publishes = screen.calls.filter((c) => c.p_action === 'message');
    assert.equal(publishes.length, 2);
    assert.equal(publishes[0].p_data.id, publishes[1].p_data.id);
    assert.equal(screen.posts.filter((p) => p.kind === 'message').length, 1);
    assert.equal(document.querySelector('textarea').value, '');
    await screen.click('Options de publication');
    await screen.click(
      [...document.querySelectorAll('.dock-options button')][0],
    );
    await screen.type('#poll-question', 'Le prochain set ?');
    await screen.type('#poll-option-0', 'Alex');
    await screen.type('#poll-option-1', 'Sam');
    await screen.click('Publier le sondage');
    assert.equal(
      screen.posts.filter((p) => p.kind === 'poll' && !p.closed).length,
      2,
    );
    await screen.click('Informations du match');
    await screen.type('#live-court', '3');
    await screen.click('Enregistrer le court');
    assert.equal(screen.match().court, '3');
  } finally {
    await screen.dispose();
  }
});

test('Tennis controls: winning game, regular tie-break, decisive super tie-break and combo window', () => {
  const load = loader({});
  const actions = load(resolve(src, 'lib/liveScoreActions.ts'));
  const { nextReaction } = load(resolve(src, 'lib/reactionCombo.ts'));
  const base = {
    status: 'live',
    set1_j1: 6,
    set1_j2: 4,
    set1_tb_j1: null,
    set1_tb_j2: null,
    set2_j1: 5,
    set2_j2: 3,
    set2_tb_j1: null,
    set2_tb_j2: null,
    set3_format: null,
    retired_player: null,
  };
  let patch = actions.quickScore(base, 'j1');
  assert.equal(patch.set2_j1, 6);
  assert.equal(actions.finalScorePatch(base, patch).status, 'finished');
  const tb = { ...base, set2_j1: 6, set2_j2: 6, set2_tb_j1: 6, set2_tb_j2: 5 };
  patch = actions.quickScore(tb, 'j1');
  assert.equal(actions.quickScoreLabel(tb), '+ point');
  assert.equal(patch.set2_j1, 7);
  assert.equal(patch.set2_tb_j1, 7);
  const superTb = {
    ...base,
    set2_j1: 4,
    set2_j2: 6,
    set3_format: 'super_tiebreak',
    set3_j1: 9,
    set3_j2: 8,
  };
  patch = actions.quickScore(superTb, 'j1');
  assert.equal(patch.set3_j1, 10);
  assert.equal(actions.finalScorePatch(superTb, patch).winner, 'j1');
  assert.equal(
    actions.quickScore({ ...superTb, set3_format: null }, 'j1'),
    null,
  );
  let streak = null;
  for (let i = 0; i < 4; i++) {
    const result = nextReaction(streak, '🔥', i * 400);
    assert.equal(result.combo, i === 3);
    streak = result.streak;
  }
  assert.equal(
    nextReaction(streak, '🔥', 1700).combo,
    false,
    'a fifth starts a new quartet',
  );
  streak = nextReaction(null, '🔥', 0).streak;
  streak = nextReaction(streak, '🔥', 500).streak;
  streak = nextReaction(streak, '❤️', 700).streak;
  assert.equal(streak.count, 1);
  streak = nextReaction(streak, '❤️', 2700).streak;
  assert.equal(streak.count, 1, 'exactly two seconds resets');
});

test('Double: decisive super tie-break, automatic finish and undo of the winning point', async () => {
  const screen = setup('member', true, false, {
    match_type: 'double',
    j3_prenom: 'Camille',
    j3_nom: 'Long partner name',
    j4_prenom: 'Jo',
    j4_nom: 'Another partner',
    set1_j1: 6,
    set1_j2: 4,
    set2_j1: 4,
    set2_j2: 6,
    set3_format: 'super_tiebreak',
    set3_j1: 9,
    set3_j2: 8,
  });
  try {
    await screen.mount();
    assert.match(document.body.textContent, /Camille Long partner name/);
    await screen.click('+ point pour Alex A / Camille Long partner name');
    assert.equal(screen.match().status, 'finished');
    assert.equal(screen.match().set3_j1, 10);
    assert.equal(document.querySelector('textarea'), null);
    await screen.click('↶ Annuler');
    assert.equal(screen.match().status, 'live');
    assert.equal(screen.match().set3_j1, 9);
    assert.ok(document.querySelector('textarea'));
    await screen.remoteScore({
      status: 'finished',
      winner: 'j1',
      set2_j1: 6,
      set2_j2: 4,
      set3_j1: null,
      set3_j2: null,
    });
    assert.equal(
      document.querySelector('.score-table tbody tr td:nth-of-type(3)')
        .textContent,
      '–',
      'finished two-set matches do not invent a third-set 0',
    );
  } finally {
    await screen.dispose();
  }
});

test('Live cards: native full-card link and independent encounter footer, without nested links', async () => {
  const load = loader({
    '/contexts/ClubContext.tsx': { useClub: () => ({ clubId: 'club-a' }) },
    '/lib/liveMatchWrites.ts': {
      deleteLiveMatch: async () => {
        throw new Error('Test suppression');
      },
    },
  });
  const Card = load(resolve(src, 'components/matches/MatchCard.tsx')).default;
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  const root = createRoot(document.getElementById('root'));
  let path = '';
  function Location() {
    path = useLocation().pathname;
    return null;
  }
  const match = {
    id: 'linked-live',
    status: 'live',
    match_type: 'simple',
    j1_prenom: 'Alex',
    j1_nom: 'A',
    j2_prenom: 'Sam',
    j2_nom: 'B',
    set1_j1: 3,
    set1_j2: 2,
    set1_tb_j1: null,
    set1_tb_j2: null,
    set2_j1: null,
    set2_j2: null,
    set3_j1: null,
    set3_j2: null,
    team_rencontre_id: 'encounter-a',
  };
  const encounter = {
    id: 'encounter-a',
    club_adverse: 'Tennis voisin',
    wo: false,
    confirmed: false,
    score_club: 2,
    score_adverse: 1,
  };
  const mount = async (props) => {
    await act(async () =>
      root.render(
        h(
          QueryClientProvider,
          { client },
          h(
            MemoryRouter,
            { initialEntries: ['/matches'] },
            h(
              React.Fragment,
              null,
              h(Location),
              h(Card, { match, userId: null, canManage: false, ...props }),
            ),
          ),
        ),
      ),
    );
  };
  try {
    await mount({ encounter });
    const links = [...document.querySelectorAll('a')];
    assert.equal(links.length, 2);
    assert.equal(links[0].getAttribute('href'), '/matches/linked-live');
    assert.ok(
      links[0].classList.contains('inset-0'),
      'primary link stretches across the cell',
    );
    assert.equal(links[1].getAttribute('href'), '/matches-equipes/encounter-a');
    assert.equal(document.querySelector('a a, a button'), null);
    assert.match(links[1].textContent, /Provisoire · 2 – 1/);
    await act(async () => links[1].click());
    assert.equal(path, '/matches-equipes/encounter-a');
    await act(async () => links[0].click());
    assert.equal(path, '/matches/linked-live');
    await mount({
      match: { ...match, status: 'finished' },
      userId: 'member',
      canManage: true,
      encounter,
    });
    await act(async () =>
      [...document.querySelectorAll('button')]
        .find((b) => b.textContent === 'Supprimer')
        .click(),
    );
    assert.equal(
      path,
      '/matches/linked-live',
      'delete does not trigger the card link',
    );
    assert.match(document.body.textContent, /Test suppression/);
    await mount({ encounter, encounterError: true });
    assert.match(document.body.textContent, /Score à actualiser/);
    assert.doesNotMatch(document.body.textContent, /2 – 1/);
    await mount({ encounter: { ...encounter, wo: true } });
    assert.match(document.body.textContent, /WO/);
    await mount({ match: { ...match, team_rencontre_id: null } });
    assert.equal(
      document.querySelectorAll('a').length,
      1,
      'no footer for an independent match',
    );
  } finally {
    await act(async () => root.unmount());
    client.clear();
  }
});
