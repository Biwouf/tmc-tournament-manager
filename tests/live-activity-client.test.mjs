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
// Pas d'affichage dans jsdom : une image = une tâche (sélecteur d'emojis progressif).
globalThis.requestAnimationFrame = (callback) => setTimeout(callback, 0);
globalThis.cancelAnimationFrame = clearTimeout;
// Pas de canvas dans jsdom : la compression est simulée (4000×3000 → 1600×1200).
globalThis.createImageBitmap = async () => ({
  width: 4000,
  height: 3000,
  close() {},
});
const drawn = [];
dom.window.HTMLCanvasElement.prototype.getContext = function () {
  return { drawImage: (_b, _x, _y, w, h) => drawn.push([w, h]) };
};
dom.window.HTMLCanvasElement.prototype.toBlob = function (callback, type) {
  callback(new Blob(['jpeg'], { type }));
};
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
    if (file.endsWith('.json'))
      return { default: JSON.parse(readFileSync(file, 'utf8')) };
    for (const [suffix, value] of Object.entries(mocks))
      if (file.endsWith(suffix)) return value;
    if (cache.has(file)) return cache.get(file).exports;
    const module = { exports: {} };
    cache.set(file, module);
    const code = ts.transpileModule(readFileSync(file, 'utf8').replace(/import\.meta\.env\.VITE_VAPID_PUBLIC_KEY/g, 'undefined'), {
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
  const uploads = [];
  const removed = [];
  const scoreWrites = [];
  const views = [];
  const recapReads = [];
  let recap = null;
  const channels = new Set();
  let failAccepted = false;
  const supabase = {
    channel(topic, params) {
      assert.match(topic, /^live:(match|club):/);
      assert.equal(params.config.private, false);
      const handlers = [];
      const channel = {
        topic,
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
    async removeChannel(channel) {
      channels.delete(channel);
    },
    storage: {
      from() {
        return {
          async upload(path, blob, options) {
            uploads.push({ path, type: blob.type, options });
            return { error: null };
          },
          async remove(paths) {
            removed.push(...paths);
            return { error: null };
          },
          getPublicUrl: (path) => ({
            data: { publicUrl: `https://cdn.test/${path}` },
          }),
        };
      },
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
      if (name === 'live_match_view') {
        views.push(params);
        return Promise.resolve({ data: null, error: null });
      }
      return {
        abortSignal() {
          return Promise.resolve().then(() => {
            if (name === 'live_match_recap') {
              recapReads.push(params);
              return { data: match.status === 'finished' ? recap : null, error: null };
            }
            if (name === 'live_activity_page')
              return {
                data: {
                  items: posts.map((p) => ({
                    ...p,
                    closed: p.closed || match.status !== 'live',
                    my_reaction: p.my_reaction ?? null,
                    // Noms réservés aux comptes connectés, comme le serveur.
                    reactions: (p.reactions ?? []).map((r) => ({
                      ...r,
                      names: user ? r.names : null,
                    })),
                  })),
                  before: 1,
                  has_more: false,
                  can_animate: canAnimate,
                },
                error: null,
              };
            calls.push(params);
            const { p_action: action, p_data: data } = params;
            if (['message', 'poll', 'photo'].includes(action)) {
              if (!posts.some((p) => p.id === data.id))
                posts.push({
                  id: data.id,
                  sequence: posts.length + 1,
                  kind: action,
                  body: data.body,
                  image_path:
                    action === 'photo'
                      ? `${params.p_club}/${params.p_match}/${data.id}.jpg`
                      : null,
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
            } else if (action === 'react') {
              const post = posts.find((p) => p.id === data.id);
              post.reactions = (post.reactions ?? [])
                .map((r) =>
                  r.emoji === post.my_reaction
                    ? {
                        ...r,
                        count: r.count - 1,
                        names: r.names.filter((n) => n !== 'Vous'),
                      }
                    : r,
                )
                .filter((r) => r.count > 0);
              if (data.emoji) {
                const r = post.reactions.find((r) => r.emoji === data.emoji);
                if (r) {
                  r.count++;
                  r.names.push('Vous');
                } else
                  post.reactions.push({
                    emoji: data.emoji,
                    count: 1,
                    names: ['Vous'],
                  });
              }
              post.my_reaction = data.emoji;
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
  // Broadcast publié en base : 'score' (ligne complète) ou 'post' sur live:match:<id>.
  const emit = async (table, row) => {
    const message =
      table === 'live_matches'
        ? { event: 'score', payload: { row } }
        : { event: 'post', payload: { id: row.id, sequence: row.sequence, op: 'UPDATE' } };
    const topic = `live:match:${table === 'live_matches' ? row.id : row.match_id}`;
    await act(async () => {
      for (const channel of channels)
        if (channel.topic === topic)
          for (const { callback } of channel.handlers) callback(message);
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
    uploads,
    removed,
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
    views,
    recapReads,
    setRecap: (value) => {
      recap = value;
    },
  };
}

const message = (reactions = []) => ({
  id: 'message-a',
  sequence: 2,
  kind: 'message',
  body: 'Quel revers !',
  image_path: null,
  author_name: 'Camille',
  created_at: new Date().toISOString(),
  score: {},
  options: [],
  closed: false,
  total: 0,
  my_vote: null,
  counts: null,
  my_reaction: null,
  reactions,
});

test('Visitor: public live, reaction counts without names and login return path; finished live is read only', async () => {
  const screen = setup(null, false);
  try {
    screen.posts.push(message([{ emoji: '🔥', count: 2, names: ['A', 'B'] }]));
    await screen.mount();
    assert.match(document.body.textContent, /Alex A/);
    assert.equal(screen.button('Publier le commentaire'), undefined);
    assert.equal(screen.button('+ jeu pour Alex A'), undefined);
    assert.equal(document.querySelector('.reaction-dock'), null, 'no floating button');
    assert.ok(screen.button('Quel match ! : 2'));
    assert.equal(document.querySelectorAll('.poll-summary .post-reactions').length, 0, 'polls are not reactable');
    await screen.click('Réagir');
    assert.equal(screen.loginFrom(), '/matches/match-a');
    assert.equal(screen.calls.length, 0);
  } finally {
    await screen.dispose();
  }
  const ended = setup('spectator', false, true);
  try {
    ended.posts.push(message());
    await ended.mount();
    await ended.click('Réagir');
    await ended.click('Célébrer');
    assert.equal(ended.posts[1].my_reaction, '🎉', 'reactions stay open after the match');
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

test('Spectator: mutable unique vote, no text composer, one toggleable reaction per post, who reacted on other chips', async () => {
  const screen = setup('spectator', false);
  try {
    screen.posts.push(message([{ emoji: '🔥', count: 1, names: ['Camille'] }]));
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
    const before = screen.calls.length;
    await screen.click('Quel match ! : 1');
    assert.equal(screen.calls.length, before, "tapping someone else's chip does not react");
    assert.match(document.querySelector('.reaction-people').textContent, /Camille/);
    await screen.click('Fermer');
    await screen.click('Réagir');
    await screen.click('Applaudir');
    assert.deepEqual(
      screen.calls.at(-1).p_data,
      { id: 'message-a', emoji: '👏' },
    );
    assert.equal(screen.button('Applaudir : 1').getAttribute('aria-pressed'), 'true');
    await screen.click('Réagir');
    await screen.click('Quel match !');
    assert.equal(screen.button('Applaudir : 1'), undefined, 'one reaction per account');
    assert.equal(screen.button('Quel match ! : 2').getAttribute('aria-pressed'), 'true');
    await screen.click('Quel match ! : 2');
    assert.deepEqual(screen.calls.at(-1).p_data, { id: 'message-a', emoji: null });
    assert.equal(screen.posts[1].my_reaction, null);
    assert.ok(screen.button('Quel match ! : 1'));
    await screen.click('Réagir');
    await screen.click('Autre emoji');
    assert.ok(
      document.querySelectorAll('.emoji-grid button').length > 1500,
      'every emoji is one tap away, without the native keyboard',
    );
    assert.equal(document.querySelectorAll('.emoji-tabs button').length, 8);
    const calls = screen.calls.length;
    await screen.type('.emoji-search', 'Cœur  ENFLAMMÉ');
    assert.deepEqual(
      [...document.querySelectorAll('.emoji-grid button')].map((b) => b.textContent),
      ['❤️‍🔥'],
      'French search, case, accent and ligature insensitive',
    );
    assert.equal(screen.button('Catégories'), undefined);
    await screen.type('.emoji-search', 'xylophage');
    assert.match(document.querySelector('.emoji-picker').textContent, /Aucun emoji trouvé/);
    await screen.type('.emoji-search', 'tennis');
    assert.equal(screen.calls.length, calls, 'searching is not reacting');
    await screen.click('tennis');
    assert.deepEqual(screen.calls.at(-1).p_data, { id: 'message-a', emoji: '🎾' });
    assert.equal(document.querySelector('.emoji-picker'), null, 'picking closes the sheet');
    assert.ok(screen.button('🎾 : 1'), 'any picked emoji becomes a chip');
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

test('Member photo: system picker, compressed upload, retry without re-upload, optional caption and file cleanup', async () => {
  const screen = setup('member', true);
  const pick = async () => {
    const input = document.querySelector('input[type="file"]');
    assert.equal(input.getAttribute('accept'), 'image/*');
    assert.equal(input.hasAttribute('capture'), false, 'library or camera');
    Object.defineProperty(input, 'files', {
      configurable: true,
      value: [new File(['raw'], 'IMG_0001.HEIC', { type: 'image/heic' })],
    });
    await act(async () =>
      input.dispatchEvent(new window.Event('change', { bubbles: true })),
    );
    await screen.flush();
  };
  try {
    await screen.mount();
    await screen.click('Options de publication');
    assert.deepEqual(
      [...document.querySelectorAll('.dock-options button')].map((b) =>
        b.textContent.trim(),
      ),
      ['Lancer un sondage', 'Ajouter une photo'],
      'no quick replies in the menu',
    );
    await screen.click('Ajouter une photo');
    assert.equal(document.querySelector('.dock-options'), null);
    assert.equal(screen.button('Publier le commentaire').disabled, true);
    await pick();
    assert.deepEqual(drawn.at(-1), [1600, 1200], 'resized before upload');
    assert.ok(document.querySelector('.dock-photo img'));
    assert.match(
      document.querySelector('textarea').placeholder,
      /légende/,
    );
    assert.equal(
      screen.button('Publier le commentaire').disabled,
      false,
      'caption is optional',
    );
    screen.failNextAccepted();
    await screen.click('Publier le commentaire');
    assert.match(document.body.textContent, /Connexion interrompue/);
    assert.ok(document.querySelector('.dock-photo img'), 'photo kept');
    await screen.click('Publier le commentaire');
    assert.equal(screen.uploads.length, 1, 'no second upload on retry');
    const [upload] = screen.uploads;
    assert.equal(upload.type, 'image/jpeg');
    assert.equal(upload.options.upsert, false);
    const publishes = screen.calls.filter((c) => c.p_action === 'photo');
    assert.equal(publishes.length, 2);
    assert.equal(publishes[0].p_data.id, publishes[1].p_data.id);
    assert.equal(upload.path, `club-a/match-a/${publishes[0].p_data.id}.jpg`);
    assert.equal(publishes[1].p_data.body, '');
    assert.equal(document.querySelector('.dock-photo'), null);
    const img = document.querySelector('.post-photo img');
    assert.equal(img.getAttribute('src'), `https://cdn.test/${upload.path}`);
    await screen.click('Supprimer cette photo');
    assert.deepEqual(screen.removed, [upload.path], 'file removed with post');
    assert.equal(document.querySelector('.post-photo'), null);
    await pick();
    await screen.click('Retirer la photo');
    assert.equal(document.querySelector('.dock-photo'), null);
    assert.equal(screen.removed.length, 1, 'nothing uploaded, nothing removed');
    await pick();
    await screen.type('textarea', 'Balle de match !');
    await screen.click('Publier le commentaire');
    assert.equal(screen.calls.at(-1).p_data.body, 'Balle de match !');
    assert.equal(document.querySelector('textarea').value, '');
    assert.match(
      document.querySelector('.post-photo').parentElement.textContent,
      /Balle de match !/,
    );
  } finally {
    await screen.dispose();
  }
});

test('Members and owners: reactions preserve the comment draft and score controls', async () => {
  for (const user of ['member', 'owner']) {
    const screen = setup(user, true);
    try {
      screen.posts.push(message());
      await screen.mount();
      const before = { ...screen.match() };
      await screen.type('textarea', 'Quel échange !');
      await screen.click('Réagir');
      await screen.click('Applaudir');
      assert.equal(screen.calls.filter(c => c.p_action === 'react').length, 1);
      assert.equal(document.querySelector('textarea').value, 'Quel échange !');
      assert.deepEqual(screen.match(), before, 'reactions do not change the score');
      assert.ok(screen.button('+ jeu pour Alex A'));
      await screen.click('Publier le commentaire');
      assert.equal(screen.calls.filter(c => c.p_action === 'message').length, 1);
      assert.equal(document.querySelector('textarea').value, '');
    } finally {
      await screen.dispose();
    }
  }
});

test('Tennis controls: winning game, regular tie-break and decisive super tie-break', () => {
  const load = loader({});
  const actions = load(resolve(src, 'lib/liveScoreActions.ts'));
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
  // Rouvert à 8/10 au super tie-break : aucun point possible, la clôture doit rester accessible.
  const reopened = { ...superTb, set3_j1: 8, set3_j2: 10, winner: null, finished_at: null };
  assert.equal(actions.quickScore(reopened, 'j1'), null);
  assert.equal(actions.canFinish(reopened), true);
  const closing = actions.finalScorePatch(reopened, {});
  assert.equal(closing.status, 'finished');
  assert.equal(closing.winner, 'j2');
  assert.equal(actions.canFinish(superTb), false, 'match still in play');
  assert.equal(actions.canFinish({ ...reopened, status: 'finished' }), false);
  assert.equal(actions.canFinish({ ...reopened, retired_player: 'j1' }), false);
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
    assert.equal(
      document.querySelector('textarea').placeholder,
      'Un mot sur le match…',
      'comments stay open after the match',
    );
    await screen.click('Options de publication');
    assert.deepEqual(
      [...document.querySelectorAll('.dock-options button')].map((b) =>
        b.textContent.trim(),
      ),
      ['Ajouter une photo'],
      'no poll once the match is over',
    );
    await screen.click('Options de publication');
    await screen.type('textarea', 'Bravo à tous les quatre !');
    await screen.click('Publier le commentaire');
    assert.deepEqual(
      { ...screen.calls.at(-1).p_data, id: undefined },
      { body: 'Bravo à tous les quatre !', id: undefined },
    );
    assert.equal(screen.calls.at(-1).p_action, 'message');
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
    '/lib/supabase.ts': { supabase: { rpc: async () => ({ data: [], error: null }) } },
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

test('Recap: unique viewer counted once while live, story replay of the finished live, viewers hidden up to 10', async () => {
  // Stockage de l'appareil : celui de jsdom, conservé d'un montage à l'autre.
  globalThis.localStorage = window.localStorage;
  window.localStorage.clear();
  const live = setup(null, false);
  try {
    await live.mount();
    assert.equal(live.views.length, 1, 'counted while live');
    assert.match(live.views[0].p_viewer, /^[0-9a-f-]{36}$/);
    assert.equal(live.recapReads.length, 0, 'no recap read while live');
    assert.equal(document.querySelector('.live-recap'), null);
  } finally {
    await live.dispose();
  }
  const again = setup('spectator', false);
  try {
    await again.mount();
    assert.equal(again.views.length, 0, 'same device, same match: not counted twice');
  } finally {
    await again.dispose();
  }
  const final = {
    set1_j1: 6, set1_j2: 4, set2_j1: 7, set2_j2: 6, set2_tb_j1: 7, set2_tb_j2: 5,
    winner: 'j1', finished_at: new Date().toISOString(),
  };
  const ended = setup(null, false, true, final);
  try {
    const at = (min) => `2026-10-22T14:${String(min).padStart(2, '0')}:00Z`;
    ended.setRecap({
      messages: 3, photos: 1, polls: 1, reactions: 9,
      top_reactions: [{ emoji: '🔥', count: 6 }, { emoji: '👏', count: 3 }],
      viewers: null,
      score: [
        { set1_j1: 0, set1_j2: 0, at: at(0) },
        { set1_j1: 1, set1_j2: 0, at: at(4) },
        { set1_j1: 6, set1_j2: 4, set2_j1: 0, set2_j2: 0, at: at(40) },
      ],
      moments: [
        { id: 'm1', kind: 'message', body: 'Quel revers !', image_path: null, author_name: 'Camille',
          created_at: at(5), score: {}, reactions: 4, emoji: '🔥' },
      ],
      photos_top: [
        { id: 'p1', kind: 'photo', body: 'Balle de match', image_path: 'club-a/match-a/p1.jpg', author_name: 'Léo',
          created_at: at(50), score: {}, reactions: 2, emoji: '👏' },
      ],
    });
    await ended.mount();
    assert.equal(ended.views.length, 0, 'not counted once finished');
    const card = document.querySelector('.live-recap');
    assert.ok(card, 'recap shown at the end of the feed');
    assert.match(card.textContent, /Victoire de Alex A/);
    assert.deepEqual(
      [...card.querySelectorAll('.recap-set-score')].map((s) => s.textContent),
      ['6–4', '7–65'],
      'tie-break loser points in superscript',
    );
    assert.equal(card.querySelector('.recap-stats').textContent, '5 publications · 9 réactions', 'no viewers at 10 or fewer');
    await ended.click('▶ Revivre le match');
    const story = () => document.querySelector('dialog.replay[open]');
    assert.ok(story(), 'full screen story opens');
    assert.match(story().textContent, /REVIVEZ LE MATCH/);
    await ended.click('Scène suivante');
    assert.match(story().textContent, /LE MATCH EN ACCÉLÉRÉ/);
    assert.equal(story().querySelectorAll('.replay-board > div').length, 2);
    await ended.click('Scène suivante');
    assert.match(story().textContent, /Un set arraché au tie-break/);
    await ended.click('Scène suivante');
    assert.match(story().querySelector('.replay-photo img').src, /club-a\/match-a\/p1\.jpg/);
    assert.match(story().textContent, /Balle de match/);
    await ended.click('Scène précédente');
    assert.match(story().textContent, /LE MOMENT FORT/, 'tap left goes back');
    await ended.click('Scène suivante');
    await ended.click('Scène suivante');
    assert.match(story().textContent, /EN TRIBUNE/);
    assert.doesNotMatch(story().textContent, /spectateurs/);
    await ended.click('Mettre en pause');
    assert.ok(ended.button('Reprendre'));
    await ended.click('Scène suivante');
    assert.match(story().textContent, /VAINQUEUR/);
    assert.match(story().textContent, /Alex A/);
    await ended.click('Scène suivante');
    assert.ok(ended.button('↻ Revoir'), 'end screen');
    assert.ok(story().querySelector('.replay-curve svg'), 'score curve instead of game squares');
    assert.match(story().querySelector('.replay-caption').textContent, /Jeu, set et match/, 'skipping to the end draws the whole curve');
    await ended.click('Retour au live');
    assert.equal(document.querySelector('dialog.replay'), null, 'story closed');
  } finally {
    await ended.dispose();
  }
  const crowd = setup(null, false, true, final);
  try {
    crowd.setRecap({ messages: 0, photos: 0, polls: 0, reactions: 0, top_reactions: [], viewers: 24, score: [], moments: [], photos_top: [] });
    await crowd.mount();
    assert.match(document.querySelector('.recap-stats').textContent, /24 spectateurs/);
    await crowd.click('▶ Revivre le match');
    assert.match(document.querySelector('dialog.replay').textContent, /REVIVEZ/);
    await crowd.click('Scène suivante');
    assert.match(document.querySelector('dialog.replay').textContent, /Un set arraché au tie-break/, 'no history: no replay scene');
    await crowd.click('Scène suivante');
    assert.match(document.querySelector('dialog.replay').textContent, /24\s*spectateurs ont suivi le live/);
  } finally {
    await crowd.dispose();
  }
});

test('Recap: game by game flow keeps corrections out and flags unknown order', () => {
  const { recapSets } = loader({ '/lib/supabase.ts': { supabase: {} } })(
    resolve(src, 'lib/liveRecap.ts'),
  );
  const match = {
    set1_j1: 6, set1_j2: 3, set1_tb_j1: null, set1_tb_j2: null,
    set2_j1: 4, set2_j2: 6, set2_tb_j1: null, set2_tb_j2: null,
    set3_j1: 10, set3_j2: 8, set3_tb_j1: null, set3_tb_j2: null, set3_format: 'super_tiebreak',
  };
  const flow = (games) => games.map((g) => (g.known ? g.side : `${g.side}?`)).join(' ');
  const [set1, set2, set3] = recapSets(match, [
    { set1_j1: 2, set1_j2: 0 },
    { set1_j1: 2, set1_j2: 1 },
    { set1_j1: 3, set1_j2: 1 },
    { set1_j1: 3, set1_j2: 2 }, // jeu attribué par erreur…
    { set1_j1: 3, set1_j2: 1 }, // …puis annulé
    { set1_j1: 4, set1_j2: 2 }, // deux jeux en une saisie : ordre inconnu
    { set1_j1: 6, set1_j2: 3, set2_j1: 0, set2_j2: 1 },
  ]);
  assert.equal(flow(set1.games), 'j1? j1? j2 j1 j1? j2? j1? j1? j2?');
  assert.equal(set2.games.length, 10, 'set 2 completed from the final score');
  assert.deepEqual([set3.superTiebreak, set3.games, set3.score], [true, null, [10, 8]]);
  assert.deepEqual(recapSets(match, []).map((s) => s.games), [null, null, null]);
});

test('Recap: replay frames drop corrections and find breaks, highlight picks the comeback', () => {
  const { replayFrames, recapSets, matchHighlight } = loader({ '/lib/supabase.ts': { supabase: {} } })(
    resolve(src, 'lib/liveRecap.ts'),
  );
  const base = {
    set1_tb_j1: null, set1_tb_j2: null, set2_j1: null, set2_j2: null, set2_tb_j1: null, set2_tb_j2: null,
    set3_j1: null, set3_j2: null, set3_tb_j1: null, set3_tb_j2: null, set3_format: null,
    retired_player: null, finished_at: '2026-10-22T15:00:00Z',
  };
  const snap = (a, b) => ({ set1_j1: a, set1_j2: b, at: `2026-10-22T14:${String(a + b).padStart(2, '0')}:00Z` });
  const frames = replayFrames({ ...base, set1_j1: 2, set1_j2: 2, first_server: 'j1', winner: null }, [
    snap(0, 0), snap(1, 0), snap(1, 1), snap(1, 2), snap(2, 2), snap(1, 2), snap(2, 2),
  ]);
  assert.deepEqual(frames.map((f) => f.sets[0].join('-')), ['0-0', '1-0', '1-1', '1-2', '2-2']);
  assert.deepEqual(
    frames.map((f) => f.game && `${f.game.side}${f.game.isBreak ? ' break' : ''}`),
    [null, 'j1', 'j2', 'j2 break', 'j1 break'],
  );
  assert.equal(replayFrames({ ...base, set1_j1: 1, set1_j2: 0, first_server: null, winner: null }, [snap(0, 0)])[1].game.isBreak, null, 'unknown server');
  // Mené 2–5, Alex remporte 5 jeux de suite : 7–5.
  const path = [[0, 0], [1, 0], [1, 1], [1, 2], [2, 2], [2, 3], [2, 4], [2, 5], [3, 5], [4, 5], [5, 5], [6, 5], [7, 5]];
  const match = { ...base, set1_j1: 7, set1_j2: 5, winner: 'j1', first_server: null };
  const sets = recapSets(match, path.map(([a, b]) => snap(a, b)));
  const name = (side) => (side === 'j1' ? 'A. Martin' : 'S. Bernard');
  assert.deepEqual(matchHighlight(match, sets, name), {
    title: 'Mené 2–5, A. Martin retourne la situation',
    detail: 'Set 1 remporté 7–5',
  });
  const run = recapSets({ ...match, set1_j1: 6, set1_j2: 1 }, [[0, 0], [0, 1], [1, 1], [2, 1], [3, 1], [4, 1], [5, 1], [6, 1]].map(([a, b]) => snap(a, b)));
  assert.equal(matchHighlight({ ...match, set1_j1: 6, set1_j2: 1 }, run, name).title, '6 jeux de suite pour A. Martin');
  assert.equal(matchHighlight({ ...match, set1_j1: 6, set1_j2: 4 }, recapSets({ ...match, set1_j1: 6, set1_j2: 4 }, []), name), null);
});

test('Recap: progression climbs set by set, merges unknown order, flags streaks and set ends', () => {
  const { progression, winnerFirst } = loader({ '/lib/supabase.ts': { supabase: {} } })(
    resolve(src, 'lib/liveRecap.ts'),
  );
  const games = (flow) => flow.split(' ').map((g) => ({ side: g.slice(0, 2), known: !g.endsWith('?') }));
  const { sets, total, events } = progression([
    { set: 1, score: [6, 4], tiebreak: null, superTiebreak: false, games: games('j2 j2 j2 j1 j1 j1 j1 j1 j2 j1') },
    { set: 2, score: [2, 1], tiebreak: null, superTiebreak: false, games: games('j1? j2? j1') },
    { set: 3, score: [10, 7], tiebreak: null, superTiebreak: true, games: null },
  ]);
  const flow = (p) => p.points.map((q) => `${q.x}:${q.games.join('-')}${q.known ? '' : '?'}`).join(' ');
  assert.equal(flow(sets[0]), '0:0-0 1:0-1 2:0-2 3:0-3 4:1-3 5:2-3 6:3-3 7:4-3 8:5-3 9:5-4 10:6-4');
  assert.equal(flow(sets[1]), '10:0-0 12:1-1? 13:2-1', 'each set starts again from 0');
  assert.equal(flow(sets[2]), '13:0-0 17:10-7?', 'super tie-break: one dashed stretch');
  assert.equal(total, 17);
  assert.deepEqual(
    events.map((e) => (e.kind === 'streak' ? `streak ${e.side} ${e.from}-${e.to} @${e.x}` : `set${e.set.set} ${e.side} @${e.x}`)),
    ['streak j1 3-8 @7', 'set1 j1 @10', 'set2 j1 @13', 'set3 j1 @17'],
    'three straight games are not a streak; the curve shows it once the fourth is drawn',
  );
  assert.deepEqual(
    [[6, 4], [3, 6], [6, 10]].map((score) => winnerFirst(score, 'j2').join('–')),
    ['4–6', '6–3', '10–6'],
    'match winner always first',
  );
  assert.deepEqual(winnerFirst([6, 4], null), [6, 4]);
  assert.equal(flow(progression([{ set: 1, score: [3, 6], tiebreak: null, superTiebreak: false, games: null }]).sets[0]), '0:0-0 9:3-6?');
});
