import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { createRequire } from 'node:module';
import vm from 'node:vm';
import ts from 'typescript';
import { JSDOM } from 'jsdom';
const dom = new JSDOM('<div id="root"></div>', { url: 'https://club.example/reset-password' });
globalThis.window = dom.window;
globalThis.document = dom.window.document;
globalThis.sessionStorage = dom.window.sessionStorage;
globalThis.HTMLElement = dom.window.HTMLElement;
globalThis.IS_REACT_ACT_ENVIRONMENT = true;
const base = resolve(new URL('..', import.meta.url).pathname);

for (const app of ['', 'pwa']) {
  const req = createRequire(resolve(base, app, 'package.json'));
  const { act, createElement: h } = req('react');
  const { createRoot } = req('react-dom/client');
  const { MemoryRouter } = req('react-router-dom');
  function fixture(clubSlug = 'cac-tennis') {
    sessionStorage.clear();
    window.history.replaceState(null, '', '/reset-password');
    let session = null;
    const callbacks = [];
    const calls = [];
    let failure = null;
    let pending = null;
    const api = { auth: {
      onAuthStateChange(cb) { callbacks.push(cb); return { data: { subscription: { unsubscribe() { const i = callbacks.indexOf(cb); if (i >= 0) callbacks.splice(i, 1); } } } }; },
      async getSession() { return { data: { session }, error: null }; },
      async resetPasswordForEmail(...args) { calls.push(['request', ...args]); if (pending) await pending; if (failure instanceof Error) throw failure; return { error: failure }; },
      async updateUser(...args) { calls.push(['update', ...args]); return { error: failure }; },
    } };
    const cache = new Map();
    let recovery;
    function load(file) {
      if (file.endsWith('/contexts/ClubContext.tsx')) return { useClub: () => ({ club: { slug: clubSlug } }) };
      if (file.endsWith('/lib/supabase.ts')) return { supabase: api, passwordRecovery: recovery };
      if (cache.has(file)) return cache.get(file).exports;
      const module = { exports: {} }; cache.set(file, module);
      const code = ts.transpileModule(readFileSync(file, 'utf8'), { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX } }).outputText;
      const require = (name) => {
        if (!name.startsWith('.')) return req(name);
        const p = resolve(dirname(file), name);
        return load([p, `${p}.ts`, `${p}.tsx`].find(existsSync));
      };
      vm.runInThisContext(`(function(require,module,exports){${code}\n})`, { filename: file })(require, module, module.exports);
      return module.exports;
    }
    const track = load(resolve(base, app, 'src/lib/passwordRecovery.ts')).trackPasswordRecovery;
    recovery = track(api);
    const Page = load(resolve(base, app, 'src/pages/PasswordRecoveryPage.tsx')).default;
    let root;
    return {
      calls, recovery,
      set failure(v) { failure = v; }, set pending(v) { pending = v; },
      async emit(event, id = 'member') { session = id ? { user: { id } } : null; await act(async () => { for (const cb of [...callbacks]) cb(event, session); }); },
      async mount(reset) { await act(async () => { root = createRoot(document.getElementById('root')); root.render(h(MemoryRouter, null, h(Page, { reset }))); }); },
      async close() { await act(async () => root.unmount()); },
      async change(id, value) { const el = document.getElementById(id); assert.ok(el, id); await act(async () => el[Object.keys(el).find(k => k.startsWith('__reactProps'))].onChange({ target: { value } })); },
      async submit() { await act(async () => document.querySelector('form').dispatchEvent(new window.Event('submit', { bubbles: true, cancelable: true }))); },
      restartTracker() { return track(api); },
    };
  }
  const label = app || 'BO';
  test(`${label}: demande neutre, redirection sur le domaine courant et pas de renvoi immédiat`, async () => {
    const f = fixture(); await f.mount(false);
    try {
      await f.change('recovery-email', ' membre@example.com '); await f.submit();
      assert.deepEqual(f.calls, [['request', 'membre@example.com', { redirectTo: 'https://club.example/reset-password' }]]);
      assert.match(document.body.textContent, /Si un compte correspond/);
      assert.equal(document.querySelector('form'), null);
    } finally { await f.close(); }
  });
  if (app === 'pwa') test('PWA locale : le club courant accompagne chaque demande, sans fixer CAC', async () => {
    dom.reconfigure({ url: 'http://localhost:5173/forgot-password' });
    try {
      for (const slug of ['cac-tennis', 'tc-moissac']) {
        const f = fixture(slug); await f.mount(false);
        try {
          await f.change('recovery-email', 'membre@example.com'); await f.submit();
          assert.equal(f.calls[0][2].redirectTo, `http://localhost:5173/reset-password?club_slug=${slug}`);
        } finally { await f.close(); }
      }
    } finally { dom.reconfigure({ url: 'https://club.example/reset-password' }); }
  });
  test(`${label}: erreurs quota/réseau, reprise et double soumission`, async () => {
    const f = fixture(); await f.mount(false);
    try {
      await f.change('recovery-email', 'membre@example.com');
      f.failure = { status: 429 }; await f.submit(); assert.match(document.body.textContent, /Trop de demandes/);
      f.failure = { status: 500, code: 'unexpected_failure' }; await f.submit(); assert.match(document.body.textContent, /service de récupération rencontre un problème/);
      f.failure = { status: 504, code: 'request_timeout' }; await f.submit(); assert.match(document.body.textContent, /Consultez votre boîte mail/);
      f.failure = new Error('offline'); await f.submit(); assert.match(document.body.textContent, /connexion internet/);
      f.failure = null;
      let release; f.pending = new Promise(r => { release = r; });
      await f.submit(); await f.submit(); assert.equal(f.calls.length, 5);
      await act(async () => { release(); }); assert.match(document.body.textContent, /Si un compte correspond/);
    } finally { await f.close(); }
  });
  test(`${label}: session ordinaire refusée, récupération valide même avant montage, rechargement`, async () => {
    const f = fixture(); await f.emit('SIGNED_IN'); await f.mount(true);
    try {
      assert.match(document.body.textContent, /invalide ou a expiré/);
      assert.equal(document.querySelector('input[type=password]'), null);
      await f.emit('PASSWORD_RECOVERY'); assert.ok(document.getElementById('recovery-password'));
      assert.equal(f.restartTracker().isReady('member'), true);
      await f.change('recovery-password', 'password-new'); await f.change('recovery-confirm', 'different'); await f.submit();
      assert.match(document.body.textContent, /ne correspondent pas/); assert.equal(f.calls.length, 0);
      await f.change('recovery-confirm', 'password-new');
      f.failure = { code: 'weak_password' }; await f.submit(); assert.match(document.body.textContent, /trop faible/);
      f.failure = null; await f.submit();
      assert.match(document.body.textContent, /Votre mot de passe a été modifié/);
      assert.equal(f.recovery.isReady('member'), false);
      assert.equal(document.querySelector('a').getAttribute('href'), app ? '/cours' : '/');
    } finally { await f.close(); }
    const early = fixture(); await early.emit('PASSWORD_RECOVERY'); await early.mount(true);
    try { assert.ok(document.getElementById('recovery-password')); } finally { await early.close(); }
  });
  test(`${label}: lien expiré malgré session existante, changement de compte et déconnexion`, async () => {
    const f = fixture(); await f.emit('PASSWORD_RECOVERY');
    window.history.replaceState(null, '', '/reset-password#error=access_denied&error_code=otp_expired');
    assert.equal(f.restartTracker().isReady('member'), false);
    await f.emit('SIGNED_IN', 'someone-else'); assert.equal(f.recovery.isReady('member'), false);
    await f.emit('PASSWORD_RECOVERY'); await f.emit('SIGNED_OUT', null); assert.equal(f.recovery.isReady('member'), false);
  });
}
