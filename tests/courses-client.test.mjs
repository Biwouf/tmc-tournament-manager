import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync, existsSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { createRequire } from "node:module";
import vm from "node:vm";
import ts from "typescript";
import { JSDOM } from "jsdom";
const dom = new JSDOM('<div id="root"></div>', { url: "http://localhost/" });
globalThis.window = dom.window;
globalThis.document = dom.window.document;
globalThis.IS_REACT_ACT_ENVIRONMENT = true;
window.confirm = () => true;
const req = createRequire(import.meta.url),
  React = req("react");
const { act, createElement: h } = React;
const { createRoot } = req("react-dom/client");
const { MemoryRouter, Routes, Route } = req("react-router-dom");
const src = resolve(new URL("../src", import.meta.url).pathname);
function loader(supabase) {
  const cache = new Map();
  function load(file) {
    if (file.endsWith("/lib/supabase.ts")) return { supabase };
    if (file.endsWith("/contexts/ClubContext.tsx"))
      return { useClub: () => ({ clubId: "club-a" }) };
    if (cache.has(file)) return cache.get(file).exports;
    const module = { exports: {} };
    cache.set(file, module);
    const code = ts.transpileModule(readFileSync(file, "utf8"), {
      compilerOptions: {
        target: ts.ScriptTarget.ES2022,
        module: ts.ModuleKind.CommonJS,
        jsx: ts.JsxEmit.ReactJSX,
      },
    }).outputText;
    const require = (name) => {
      if (!name.startsWith(".")) return req(name);
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
function mockApi() {
  const calls = [];
  const commands = [];
  const course = {
    id: "course-a",
    name: "Séance panier",
    type_id: "type-a",
    type_name: "Panier",
    owner_first_name: "Alex",
    starts_at: "2099-09-10T16:00:00Z",
    duration_minutes: 60,
    capacity_female: 1,
    capacity_male: 1,
    approved_female: 1,
    approved_male: 0,
    pending_count: 1,
    has_registrations: true,
    revision: 0,
    cancelled_at: null,
  };
  const registration = {
    id: "registration-a",
    user_id: "member-a",
    prenom: "Camille",
    nom: "Martin",
    status: "pending",
    quota_sex: "female",
    requested_at: "2099-09-01T09:00:00Z",
    revision: 0,
    denial_reason: null,
  };
  let failure = null;
  const supabase = {
    rpc(name, args) {
      calls.push({ name, args });
      return {
        abortSignal() {
          if (name === "course_admin_command") {
            commands.push(args);
            if (failure)
              return Promise.resolve({
                data: null,
                error: { message: failure },
              });
            if (args.p_operation === "set_status") {
              registration.status = args.p_data.status;
              registration.revision++;
              registration.denial_reason = args.p_data.denial_reason ?? null;
            }
            return Promise.resolve({
              data: { id: "result", revision: 1 },
              error: null,
            });
          }
          const data = {
            courses: [course],
            types: [
              {
                id: "type-a",
                name: "Panier",
                revision: 0,
                image_path: null,
                archived_at: null,
              },
            ],
            members: [
              {
                user_id: "member-a",
                prenom: "Camille",
                nom: "Martin",
                sex: null,
                revision: 0,
                complete: false,
              },
            ],
            registrations: [{ ...registration }],
            history: [
              {
                ...registration,
                course_name: course.name,
                starts_at: course.starts_at,
              },
            ],
            events: [],
          }[args.p_kind];
          return Promise.resolve({ data, error: null });
        },
      };
    },
  };
  return {
    supabase,
    calls,
    commands,
    course,
    registration,
    fail: (value) => {
      failure = value;
    },
  };
}
const flush = () =>
  act(async () => {
    await new Promise((r) => setTimeout(r, 0));
  });
const button = (text) =>
  [...document.querySelectorAll("button")].find((b) => b.textContent === text);
async function click(text) {
  const b = button(text);
  assert.ok(b, `button ${text}`);
  await act(async () => b.click());
  await flush();
}
async function mount(load, page, path = "/courses", route = "/courses") {
  const root = createRoot(document.getElementById("root"));
  const Component = load(page).default;
  await act(async () =>
    root.render(
      h(
        MemoryRouter,
        { initialEntries: [path] },
        h(Routes, null, h(Route, { path: route, element: h(Component) })),
      ),
    ),
  );
  await flush();
  return root;
}

test("Cours client: Europe/Paris DST gap, ambiguous hour and browser-independent conversion", () => {
  const { parisCandidates, parisInput } = loader({})("lib/courses.ts");
  assert.deepEqual(parisCandidates("2026-03-29T02:30"), []);
  assert.deepEqual(parisCandidates("2026-10-25T02:30"), [
    "2026-10-25T00:30:00.000Z",
    "2026-10-25T01:30:00.000Z",
  ]);
  assert.deepEqual(parisCandidates("2026-09-10T18:00"), [
    "2026-09-10T16:00:00.000Z",
  ]);
  assert.equal(parisInput("2026-12-10T17:00:00Z"), "2026-12-10T18:00");
  assert.deepEqual(parisCandidates("2026-02-30T18:00"), []);
});

test("Cours client: approval failure is not optimistic, refusal and history work", async () => {
  const api = mockApi();
  const load = loader(api.supabase);
  const root = await mount(
    load,
    "pages/CourseRegistrationsPage.tsx",
    "/courses/course-a/registrations",
    "/courses/:id/registrations",
  );
  try {
    assert.match(document.body.textContent, /Camille Martin/);
    await click("Toutes");
    assert.doesNotMatch(
      document.body.textContent,
      /Chargement des inscriptions/,
    );
    assert.ok(button("Ajouter").disabled, "incomplete profile cannot be added");
    api.fail("QUOTA_FULL");
    await click("Approuver");
    assert.match(document.body.textContent, /quota est atteint/);
    assert.equal(api.registration.status, "pending");
    assert.match(document.body.textContent, /En attente/);
    api.fail(null);
    await click("Refuser");
    assert.ok(
      button("Confirmer le refus").disabled,
      "empty refusal must be blocked",
    );
    const textarea = document.querySelector("textarea");
    assert.match(textarea.closest("article").textContent, /Camille Martin/);
    await act(async () => {
      const props =
        textarea[
          Object.keys(textarea).find((k) => k.startsWith("__reactProps"))
        ];
      props.onChange({ target: { value: "Cours inadapté au niveau" } });
    });
    await click("Confirmer le refus");
    assert.equal(api.registration.status, "denied");
    assert.match(document.body.textContent, /Refusée/);
    await act(async () =>
      document.querySelector(".registration-secondary > summary").click(),
    );
    await click("Historique");
    assert.match(
      document.querySelector("aside").textContent,
      /Historique — Camille Martin/,
    );
    assert.ok(
      api.calls.some(
        (c) =>
          c.args.p_kind === "history" &&
          c.args.p_club === "club-a" &&
          c.args.p_target === "member-a",
      ),
    );
  } finally {
    await act(async () => root.unmount());
  }
});

test("Cours client: existing registrations lock date and duration, but not quotas", async () => {
  const api = mockApi();
  const root = await mount(
    loader(api.supabase),
    "pages/CourseFormPage.tsx",
    "/courses/course-a/edit",
    "/courses/:id/edit",
  );
  try {
    assert.ok(document.querySelector("input[type=datetime-local]").disabled);
    const numbers = [...document.querySelectorAll("input[type=number]")];
    assert.ok(numbers[0].disabled);
    assert.ok(!numbers[1].disabled);
    assert.ok(!numbers[2].disabled);
    assert.match(document.body.textContent, /Europe\/Paris/);
    assert.doesNotMatch(document.body.textContent, /Entraîneur/);
    assert.equal(
      document
        .querySelector(
          'nav[aria-label="Administration du club"] [aria-current="page"]',
        )
        .getAttribute("href"),
      "/courses",
    );
  } finally {
    await act(async () => root.unmount());
  }
});

test("Cours client: profile form exposes only identity fields to admin RPC", async () => {
  const api = mockApi();
  const load = loader(api.supabase);
  const Component = load("components/courses/MemberProfileEditor.tsx").default;
  const root = createRoot(document.getElementById("root"));
  try {
    await act(async () =>
      root.render(
        h(Component, {
          clubId: "club-a",
          userId: "member-a",
          onClose() {},
          onSaved() {},
        }),
      ),
    );
    await flush();
    assert.equal(document.querySelectorAll("input").length, 2);
    assert.equal(document.querySelectorAll("select").length, 1);
    assert.match(document.body.textContent, /partagé entre les clubs/);
    assert.ok(!document.querySelector("input[type=email]"));
  } finally {
    await act(async () => root.unmount());
  }
});

test("Cours client: same-tick double click and uncertain retry reuse the command key", async () => {
  let pending;
  const calls = [];
  let state;
  const load = loader({
    rpc(name, args) {
      calls.push(args);
      return {
        abortSignal() {
          return new Promise((resolve) => {
            pending = resolve;
          });
        },
      };
    },
  });
  const { useCourseAdmin } = load("hooks/useCourseAdmin.ts");
  function Screen() {
    state = useCourseAdmin("club-a");
    return h("p", null, state.error);
  }
  const root = createRoot(document.getElementById("root"));
  try {
    await act(async () => root.render(h(Screen)));
    let first;
    await act(async () => {
      first = state.run("save_type", { name: "Physique" });
      void state.run("save_type", { name: "Physique" });
    });
    assert.equal(calls.length, 1);
    assert.equal(state.busy, true);
    await act(async () => {
      pending({ data: null, error: { message: "timeout" } });
      await first;
    });
    assert.equal(state.busy, false);
    let retry;
    await act(async () => {
      retry = state.run("save_type", { name: "Physique" });
    });
    assert.equal(calls[0].p_request_id, calls[1].p_request_id);
    await act(async () => {
      pending({ data: { id: "x", revision: 0 }, error: null });
      await retry;
    });
    assert.equal(state.error, null);
  } finally {
    await act(async () => root.unmount());
  }
});

test("Cours client: activation no longer writes a member profile", () => {
  const source = readFileSync(
    resolve(src, "pages/AcceptInvitePage.tsx"),
    "utf8",
  );
  assert.doesNotMatch(source, /\.upsert\(|\.from\('profiles'\)/);
  assert.match(source, /auth\.updateUser\(\{ password \}\)/);
});

test("Member autocomplete: keyboard selection, explicit identity, clear-on-edit and stale response rejection", async () => {
  const requests = [];
  let selected = null;
  const load = loader({
    rpc(name, args) {
      return {
        abortSignal() {
          return new Promise((resolve) => requests.push({ args, resolve }));
        },
      };
    },
  });
  const Component = load("components/courses/MemberAutocomplete.tsx").default;
  function Screen() {
    const [member, setMember] = React.useState(null);
    selected = member;
    return h(
      "form",
      null,
      h(Component, {
        clubId: "club-a",
        value: member,
        required: true,
        onChange: setMember,
      }),
    );
  }
  const root = createRoot(document.getElementById("root"));
  const settle = () =>
    act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 260));
    });
  const enter = async (input, value) =>
    act(async () => {
      Object.getOwnPropertyDescriptor(
        window.HTMLInputElement.prototype,
        "value",
      ).set.call(input, value);
      input.dispatchEvent(new window.Event("input", { bubbles: true }));
    });
  const key = async (input, value) =>
    act(async () =>
      input.dispatchEvent(
        new window.KeyboardEvent("keydown", { key: value, bubbles: true }),
      ),
    );
  try {
    await act(async () => root.render(h(Screen)));
    const input = document.querySelector("[role=combobox]");
    await act(async () => input.focus());
    await enter(input, "Ca");
    await settle();
    assert.equal(requests.at(-1).args.p_search, "Ca");
    const stale = requests.at(-1);
    await enter(input, "Cam");
    await settle();
    const latest = requests.at(-1);
    const member = {
      user_id: "camille",
      prenom: "Camille",
      nom: "Martin",
      sex: "female",
      complete: true,
      revision: 0,
    };
    await act(async () => latest.resolve({ data: [member], error: null }));
    await act(async () =>
      stale.resolve({
        data: [{ ...member, user_id: "old", prenom: "Ancienne" }],
        error: null,
      }),
    );
    assert.match(
      document.querySelector("[role=listbox]").textContent,
      /Camille/,
    );
    assert.doesNotMatch(
      document.querySelector("[role=listbox]").textContent,
      /Ancienne/,
    );
    assert.equal(selected, null, "typing a name does not select an account");
    assert.equal(input.validity.valid, false);
    await key(input, "ArrowDown");
    await key(input, "Enter");
    assert.equal(selected.user_id, "camille");
    assert.equal(input.value, "Camille Martin");
    assert.equal(input.getAttribute("aria-expanded"), "false");
    assert.equal(input.validity.valid, true);
    assert.equal(document.querySelector("select"), null);
    await enter(input, "Autre");
    assert.equal(
      selected,
      null,
      "editing invalidates the previous account selection",
    );
    assert.equal(input.validity.valid, false);
    await key(input, "Escape");
    assert.equal(input.getAttribute("aria-expanded"), "false");
  } finally {
    await act(async () => root.unmount());
  }
});
