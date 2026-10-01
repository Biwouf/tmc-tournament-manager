import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { readFileSync, existsSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import vm from 'node:vm';
import ts from 'typescript';
import { JSDOM } from 'jsdom';
const dom = new JSDOM('<div id="root"></div>', { url: 'http://localhost/' });
globalThis.window = dom.window; globalThis.document = dom.window.document; globalThis.IS_REACT_ACT_ENVIRONMENT = true;
const req = createRequire(import.meta.url);
const { createElement: h, act } = req('react'); const { createRoot } = req('react-dom/client');
const config = { brand: { name: 'Club' }, partners: [] };
const pending = [];
const club = { name: 'Club' };
const mocks = {
  '/contexts/ClubContext.tsx': { useClub: () => ({ club }) },
  '/hooks/useClubConfig.ts': { useClubConfig: () => ({ config, loading: false }) },
  '/poster/renderResultPoster.ts': { renderResultPoster: input => new Promise((resolve, reject) => pending.push({ input, resolve, reject })) },
};
const modules = new Map();
function load(file) {
  for (const [suffix, value] of Object.entries(mocks)) if (file.endsWith(suffix)) return value;
  if (modules.has(file)) return modules.get(file).exports;
  const module = { exports: {} }; modules.set(file, module);
  const code = ts.transpileModule(readFileSync(file, 'utf8'), { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX } }).outputText;
  const require = name => { if (!name.startsWith('.')) return req(name); const path = resolve(dirname(file), name); return load([path, `${path}.ts`, `${path}.tsx`].find(existsSync)); };
  vm.runInThisContext(`(function(require,module,exports){${code}\n})`, { filename: file })(require, module, module.exports);
  return module.exports;
}
const Component = load(new URL('../src/components/teamMatches/poster/ResultPosterSection.tsx', import.meta.url).pathname).default;
const props = { rencontre: { id: 'r', score_club: 4, score_adverse: 2, wo: false, photo_urls: ['https://example.test/photo.jpg'] }, lines: [], competition: { nom: 'Interclubs', genre: 'hommes', categorie: 'seniors', format: '4S2D' }, equipe: { numero: 1 }, etape: { phase: 'poule', numero_journee: 1 } };
const button = text => [...document.querySelectorAll('button')].find(node => node.textContent.includes(text));
const click = target => act(async () => target.dispatchEvent(new window.MouseEvent('click', { bubbles: true })));
const wait = () => act(async () => { await new Promise(resolve => setTimeout(resolve, 230)); });

test('Unavailable result disables generation and does not mount the editor', async () => {
  const root = createRoot(document.getElementById('root'));
  try {
    await act(async () => root.render(h(Component, { ...props, rencontre: { ...props.rencontre, score_club: null } })));
    assert.equal(button('Générer').disabled, true);
    assert.equal(document.querySelector('input[type=file]'), null);
  } finally { await act(async () => root.unmount()); }
});

test('Model changes invalidate downloads and stale renders cannot replace the current photo preview', async () => {
  pending.length = 0;
  const root = createRoot(document.getElementById('root'));
  try {
    await act(async () => root.render(h(Component, props)));
    await click(button('Générer')); await wait();
    const old = pending[0];
    await click(document.querySelectorAll('input[type=radio]')[0]); await wait();
    assert.equal(pending[1].input.model, 'photo');
    assert.equal(pending[1].input.photo, props.rencontre.photo_urls[0]);
    assert.ok(document.querySelector('input[type=file]'));
    await act(async () => old.resolve('data:image/png;base64,old'));
    assert.equal(document.querySelector('a[download]'), null);
    await act(async () => pending[1].resolve('data:image/png;base64,new'));
    assert.equal(document.querySelector('a[download]').href, 'data:image/png;base64,new');
    assert.equal(document.querySelector('img[alt^="Aperçu"]').src, document.querySelector('a[download]').href);
    await click(document.querySelectorAll('input[type=radio]')[1]);
    assert.equal(document.querySelector('a[download]'), null);
    await wait();
    await act(async () => pending[2].reject(new Error('Logo inaccessible')));
    assert.match(document.querySelector('[role=alert]').textContent, /Logo inaccessible/);
    await click(button('Réessayer')); await wait();
    await act(async () => pending[3].resolve('data:image/png;base64,retry'));
    assert.equal(document.querySelector('a[download]').href, 'data:image/png;base64,retry');
  } finally { await act(async () => root.unmount()); }
});

test('Photo focus can be moved on the source image and reset; export follows the focus', async () => {
  pending.length = 0;
  const root = createRoot(document.getElementById('root'));
  try {
    await act(async () => root.render(h(Component, props)));
    await click(button('Générer'));
    await click(document.querySelectorAll('input[type=radio]')[0]); await wait();
    await act(async () => pending.at(-1).resolve('data:image/png;base64,initial'));
    const focus = document.querySelector('[aria-describedby=photo-focus-help]');
    focus.setPointerCapture = () => {};
    focus.getBoundingClientRect = () => ({ left: 0, top: 0, width: 200, height: 100 });
    await act(async () => focus.dispatchEvent(new window.MouseEvent('pointerdown', { bubbles: true, button: 0, clientX: 150, clientY: 25 })));
    assert.equal(document.querySelector('input[aria-label="Focus horizontal"]').value, '75');
    assert.equal(document.querySelector('input[aria-label="Focus vertical"]').value, '25');
    assert.equal(document.querySelector('a[download]'), null);
    await wait();
    assert.deepEqual(pending.at(-1).input.crop, { x: 75, y: 25, zoom: 1 });
    await act(async () => pending.at(-1).resolve('data:image/png;base64,focused'));
    assert.equal(document.querySelector('a[download]').href, 'data:image/png;base64,focused');
    await click(button('Recentrer')); await wait();
    assert.deepEqual(pending.at(-1).input.crop, { x: 50, y: 50, zoom: 1 });
  } finally { await act(async () => root.unmount()); }
});
