import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { createRequire } from 'node:module';
import vm from 'node:vm';
import ts from 'typescript';
import { JSDOM } from 'jsdom';
const req = createRequire(new URL('../pwa/package.json', import.meta.url));
const dom = new JSDOM('<div id="root"></div>', {
  url: 'http://localhost/cours',
});
globalThis.window = dom.window;
globalThis.document = dom.window.document;
globalThis.HTMLElement = dom.window.HTMLElement;
globalThis.IS_REACT_ACT_ENVIRONMENT = true;
const React = req('react'),
  { act, createElement: h } = React;
const { createRoot } = req('react-dom/client');
const { MemoryRouter, Routes, Route } = req('react-router-dom');
const { QueryClient, QueryClientProvider } = req('@tanstack/react-query');
dom.window.HTMLDialogElement.prototype.showModal = function () {
  this.setAttribute('open', '');
  this.querySelector('button')?.focus();
};
dom.window.HTMLDialogElement.prototype.close = function () {
  this.removeAttribute('open');
};
const src = resolve(new URL('../pwa/src', import.meta.url).pathname);
function loader(api, user = { id: 'me' }) {
  const cache = new Map();
  function load(file) {
    if (file.endsWith('.css')) return {};
    if (file.endsWith('/lib/supabase.ts')) return { supabase: api };
    if (file.endsWith('/hooks/useAuth.ts'))
      return { useAuth: () => ({ user, loading: false }) };
    if (file.endsWith('/contexts/ClubContext.tsx'))
      return { useClub: () => ({ clubId: 'club-a' }) };
    if (file.endsWith('/components/layout/HeaderActionContext.tsx'))
      return { useHeaderAction: () => {} };
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
  return (path) => load(resolve(src, path));
}
const flush = () =>
  act(async () => {
    await new Promise((r) => setTimeout(r, 15));
  });
const button = (label) =>
  [...document.querySelectorAll('button')].find((b) => b.textContent === label);
async function click(label) {
  assert.ok(button(label), `button ${label}`);
  await act(async () => button(label).click());
  await flush();
}
async function change(el, value) {
  await act(async () =>
    el[Object.keys(el).find((k) => k.startsWith('__reactProps'))].onChange({
      target: { value },
    }),
  );
}
function mock() {
  const calls = [];
  let failure = null;
  let wait = false;
  let resolveCommand;
  const course = {
    id: 'course-a',
    name: 'Panier du club',
    type_name: 'Panier',
    image_path: null,
    owner_first_name: 'Alex',
    starts_at: new Date(Date.now() + 86400000).toISOString(),
    duration_minutes: 60,
    cancelled_at: null,
    capacity_female: 1,
    capacity_male: 1,
    approved_female: 0,
    approved_male: 0,
    can_manage: false,
    revision: 0,
    pending_count: 0,
    registration: null,
  };
  const context = {
    is_member: true,
    can_manage: false,
    profile: { prenom: 'Léa', nom: 'Martin', sex: 'female', revision: 1 },
    mine_count: 0,
    attention_count: 0,
  };
  const row = {
    id: 'r-a',
    prenom: 'Camille',
    nom: 'Martin',
    status: 'pending',
    quota_sex: 'female',
    revision: 0,
    requested_at: new Date().toISOString(),
    denial_reason: null,
  };
  const envelope = (items) => ({
    items: structuredClone(items),
    total: items.length,
    server_now: new Date().toISOString(),
    can_act: true,
  });
  const api = {
    storage: {
      from: () => ({
        getPublicUrl: () => ({
          data: { publicUrl: 'https://example.invalid/image.png' },
        }),
      }),
    },
    rpc(name, args) {
      calls.push({ name, args });
      return {
        abortSignal: () => {
          if (name === 'course_my_context')
            return Promise.resolve({ data: structuredClone(context) });
          if (name === 'course_catalog')
            return Promise.resolve({
              data: envelope([
                { ...course, registration: undefined, can_manage: undefined },
              ]),
            });
          if (name === 'course_my_page')
            return Promise.resolve({ data: envelope([course]) });
          if (name === 'course_manage_queue')
            return Promise.resolve({
              data: envelope(
                (args.p_filter === 'pending') === (row.status === 'pending')
                  ? [row]
                  : [],
              ),
            });
          const complete = () => {
            if (failure) return { error: { message: failure } };
            if (name === 'course_member_command') {
              course.registration = {
                id: 'mine',
                status:
                  args.p_operation === 'request' ? 'pending' : 'cancelled',
                revision: 0,
                quota_sex: 'female',
                denial_reason: null,
              };
              context.mine_count = args.p_operation === 'request' ? 1 : 0;
            }
            if (name === 'course_manage_command') {
              row.status = args.p_data.status;
              row.denial_reason = args.p_data.denial_reason ?? null;
              row.revision++;
            }
            if (name === 'course_save_my_profile') {
              context.profile = {
                prenom: args.p_prenom,
                nom: args.p_nom,
                sex: args.p_sex,
                revision: context.profile.revision + 1,
              };
            }
            return { data: { id: 'result', revision: 1 } };
          };
          if (wait)
            return new Promise((resolve) => {
              resolveCommand = () => resolve(complete());
            });
          return Promise.resolve(complete());
        },
      };
    },
  };
  return {
    api,
    calls,
    course,
    context,
    row,
    fail: (value) => (failure = value),
    hold: (value) => (wait = value),
    finish: () => resolveCommand(),
  };
}
async function mount(
  load,
  page = 'pages/CoursesPage.tsx',
  path = '/cours',
  props = {},
) {
  const root = createRoot(document.getElementById('root'));
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false, gcTime: 0 } },
  });
  const Component = load(page).default;
  await act(async () =>
    root.render(
      h(
        QueryClientProvider,
        { client },
        h(
          MemoryRouter,
          { initialEntries: [path] },
          h(
            Routes,
            null,
            h(Route, { path: '*', element: h(Component, props) }),
          ),
        ),
      ),
    ),
  );
  await flush();
  await flush();
  return {
    client,
    close: async () => {
      await act(async () => root.unmount());
      client.clear();
    },
  };
}

test('PWA client: personal state survives H−4 and ongoing courses; server time and Paris display', () => {
  const api = mock();
  const lib = loader(api.api)('lib/courses.ts');
  const start = Date.parse(api.course.starts_at);
  for (const status of ['pending', 'approved']) {
    const c = { ...api.course, registration: { status } };
    assert.equal(lib.bookingOpen(c, start - 4 * 3600000 - 1), true);
    assert.equal(lib.bookingOpen(c, start - 4 * 3600000), false);
    for (const now of [start - 3600000, start + 1])
      assert.equal(
        lib.courseState(c, now).label,
        status === 'approved' ? 'Inscrit·e' : 'Demande envoyée',
      );
  }
  assert.equal(
    lib.courseState(
      { ...api.course, registration: { status: 'pending' } },
      start + 3600000,
    ).note,
    'Terminé — demande non validée.',
  );
  assert.equal(lib.courseTime('2026-10-25T00:30:00Z'), '02:30');
  assert.equal(lib.courseTime('2026-10-25T01:30:00Z'), '02:30');
});

test('PWA client: visitor catalogue, contextual login, no automatic request', async () => {
  const api = mock();
  const screen = await mount(loader(api.api, null));
  try {
    assert.match(document.body.textContent, /Panier du club/);
    assert.ok(api.calls.some((c) => c.name === 'course_catalog'));
    assert.ok(
      !api.calls.some(
        (c) => c.name === 'course_my_page' || c.name === 'course_my_context',
      ),
    );
    await click('Demander une place');
    assert.match(
      document.querySelector('dialog').textContent,
      /Connectez-vous/,
    );
    assert.equal(
      document.querySelector('dialog a').getAttribute('href'),
      '/login',
    );
    assert.ok(!api.calls.some((c) => c.name === 'course_member_command'));
  } finally {
    await screen.close();
  }
});

test('PWA client: real response required, same-tick duplicate prevented, uncertain retry same key', async () => {
  const api = mock();
  const screen = await mount(loader(api.api));
  try {
    await click('Demander une place');
    api.hold(true);
    await act(async () => {
      button('Envoyer ma demande').click();
      button('Envoyer ma demande')?.click();
    });
    assert.equal(
      api.calls.filter((c) => c.name === 'course_member_command').length,
      1,
    );
    assert.doesNotMatch(document.body.textContent, /Demande envoyée/);
    api.fail('timeout');
    await act(async () => api.finish());
    await flush();
    assert.match(
      document.body.textContent,
      /réponse du serveur est incertaine/,
    );
    assert.ok(
      api.calls.filter((c) => c.name === 'course_my_page').length >= 3,
      're-read before retry',
    );
    api.hold(false);
    api.fail(null);
    await click('Envoyer ma demande');
    await flush();
    const writes = api.calls.filter((c) => c.name === 'course_member_command');
    assert.equal(writes[0].args.p_request_id, writes[1].args.p_request_id);
    assert.match(document.body.textContent, /Demande envoyée/);
    assert.equal(document.querySelector('dialog'), null);
  } finally {
    await screen.close();
  }
});

test('PWA client: closed course keeps confirmation and hides personal mutations', async () => {
  const api = mock();
  api.course.starts_at = new Date(Date.now() - 60000).toISOString();
  api.course.registration = { status: 'approved', revision: 0 };
  const screen = await mount(loader(api.api));
  try {
    assert.match(document.body.textContent, /Votre place est confirmée/);
    assert.match(document.body.textContent, /En cours/);
    assert.equal(button('Me désister'), undefined);
    assert.equal(button('Demander une place'), undefined);
  } finally {
    await screen.close();
  }
});

test('PWA client: incomplete profile link preserves course without requesting', async () => {
  const api = mock();
  api.context.profile.sex = null;
  const screen = await mount(loader(api.api));
  try {
    await click('Demander une place');
    assert.match(
      document.querySelector('dialog a').getAttribute('href'),
      /^\/profil\?returnTo=/,
    );
    assert.equal(button('Envoyer ma demande'), undefined);
    assert.ok(!api.calls.some((c) => c.name === 'course_member_command'));
  } finally {
    await screen.close();
  }
});

test('PWA client: owner decision quota error, empty refusal blocked and treated read-only', async () => {
  const api = mock();
  api.course.can_manage = true;
  const screen = await mount(
    loader(api.api),
    'components/courses/CourseQueue.tsx',
    '/cours',
    { clubId: 'club-a', course: api.course, onCancelled: () => {} },
  );
  try {
    api.fail('QUOTA_FULL');
    await click('Valider');
    assert.match(document.body.textContent, /quota est atteint/);
    assert.equal(api.row.status, 'pending');
    api.fail(null);
    await click('Refuser');
    assert.equal(document.querySelector('textarea').value, '');
    assert.ok(button('Envoyer le refus').disabled);
    await change(document.querySelector('textarea'), '  Niveau inadapté  ');
    await click('Envoyer le refus');
    const write = api.calls
      .filter((c) => c.name === 'course_manage_command')
      .at(-1);
    assert.equal(write.args.p_data.denial_reason, 'Niveau inadapté');
    await click('Traitées');
    assert.match(document.body.textContent, /Demande refusée/);
    assert.equal(button('Valider'), undefined);
    assert.equal(button('Refuser'), undefined);
  } finally {
    await screen.close();
  }
});

test('PWA client: self profile sends no target or roles, keeps revision until explicit reload', async () => {
  const api = mock();
  const screen = await mount(
    loader(api.api),
    'pages/ProfilePage.tsx',
    '/profil?returnTo=%2Fcours%3Fcourse%3Dcourse-a',
  );
  try {
    assert.equal(document.querySelectorAll('input').length, 2);
    assert.equal(document.querySelectorAll('select').length, 1);
    api.context.profile = {
      ...api.context.profile,
      prenom: 'Admin',
      revision: 2,
    };
    api.fail('VERSION_CONFLICT');
    await act(async () =>
      document
        .querySelector('form')
        .dispatchEvent(
          new window.Event('submit', { bubbles: true, cancelable: true }),
        ),
    );
    await flush();
    assert.match(document.body.textContent, /Les données ont changé/);
    assert.equal(document.querySelector('input').value, 'Léa');
    await click('Recharger le profil actuel');
    assert.equal(document.querySelector('input').value, 'Admin');
    api.fail(null);
    await act(async () =>
      document
        .querySelector('form')
        .dispatchEvent(
          new window.Event('submit', { bubbles: true, cancelable: true }),
        ),
    );
    await flush();
    const writes = api.calls.filter((c) => c.name === 'course_save_my_profile');
    assert.equal(writes[0].args.p_revision, 1);
    assert.equal(writes[1].args.p_revision, 2);
    for (const c of writes)
      assert.deepEqual(Object.keys(c.args).sort(), [
        'p_club',
        'p_nom',
        'p_prenom',
        'p_request_id',
        'p_revision',
        'p_sex',
      ]);
    assert.match(document.body.textContent, /Profil enregistré/);
  } finally {
    await screen.close();
  }
});

test('PWA client: failed profile read offers retry instead of indefinite loading', async () => {
  const api = mock();
  const screen = await mount(
    loader(api.api),
    'components/courses/CourseInteraction.tsx',
    '/cours',
    {
      clubId: 'club-a',
      course: api.course,
      authenticated: true,
      contextError: 'Profil indisponible',
      now: Date.now(),
      mode: 'request',
      setMode() {},
      onClose() {},
      onSuccess() {},
    },
  );
  try {
    assert.match(
      document.querySelector('[role=alert]').textContent,
      /Profil indisponible/,
    );
    assert.ok(button('Actualiser mon profil'));
    assert.equal(button('Envoyer ma demande'), undefined);
    assert.doesNotMatch(
      document.body.textContent,
      /Chargement de votre profil/,
    );
  } finally {
    await screen.close();
  }
});
