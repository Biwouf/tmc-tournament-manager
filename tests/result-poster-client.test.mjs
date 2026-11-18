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
const updates = [];
const supabase = { from: table => ({ update: values => ({ eq: (_c1, id) => ({ eq: async (_c2, clubId) => { updates.push({ table, values, id, clubId }); return { error: null }; } }) }) }) };
const mocks = {
  '/contexts/ClubContext.tsx': { useClub: () => ({ club, clubId: 'c1' }) },
  '/lib/supabase.ts': { supabase },
  '/hooks/useClubConfig.ts': { useClubConfig: () => ({ config, loading: false }) },
  '/poster/renderResultPoster.ts': { resultPosterFooterHeight: () => 190, renderResultPoster: input => new Promise((resolve, reject) => pending.push({ input, resolve, reject })) },
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
    // The rencontre has photos: the team-spirit model is preselected.
    assert.equal(pending[0].input.model, 'photo');
    await click(document.querySelectorAll('input[type=radio]')[1]); await wait();
    const old = pending[1];
    await click(document.querySelectorAll('input[type=radio]')[0]); await wait();
    assert.equal(pending[2].input.model, 'photo');
    assert.equal(pending[2].input.photo, props.rencontre.photo_urls[0]);
    assert.ok(document.querySelector('input[type=file]'));
    await act(async () => old.resolve('data:image/png;base64,old'));
    assert.equal(document.querySelector('a[download]'), null);
    await act(async () => pending[2].resolve('data:image/png;base64,new'));
    assert.equal(document.querySelector('a[download]').href, 'data:image/png;base64,new');
    assert.equal(document.querySelector('img[alt^="Aperçu"]').src, document.querySelector('a[download]').href);
    await click(document.querySelectorAll('input[type=radio]')[1]);
    assert.equal(document.querySelector('a[download]'), null);
    await wait();
    await act(async () => pending[3].reject(new Error('Logo inaccessible')));
    assert.match(document.querySelector('[role=alert]').textContent, /Logo inaccessible/);
    await click(button('Réessayer')); await wait();
    await act(async () => pending[4].resolve('data:image/png;base64,retry'));
    assert.equal(document.querySelector('a[download]').href, 'data:image/png;base64,retry');
  } finally { await act(async () => root.unmount()); }
});

test('Photo focus can be moved on the source image and reset; export follows the focus', async () => {
  pending.length = 0;
  const root = createRoot(document.getElementById('root'));
  try {
    await act(async () => root.render(h(Component, props)));
    await click(button('Générer')); await wait();
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

test('Without uploaded photos, the detailed results model is preselected', async () => {
  pending.length = 0;
  const root = createRoot(document.getElementById('root'));
  try {
    await act(async () => root.render(h(Component, { ...props, rencontre: { ...props.rencontre, photo_urls: [] } })));
    await click(button('Générer')); await wait();
    assert.equal(pending[0].input.model, 'details');
    assert.equal(document.querySelectorAll('input[type=radio]')[1].checked, true);
  } finally { await act(async () => root.unmount()); }
});

test('Photo crop is restored from the rencontre and saved after a pause', async () => {
  pending.length = 0; updates.length = 0;
  const photo = props.rencontre.photo_urls[0];
  const other = 'https://example.test/other.jpg';
  const rencontre = { ...props.rencontre, id: 'r-crop', photo_urls: [photo, other], photo_crops: { [photo]: { x: 20, y: 30, zoom: 1.5 } } };
  const root = createRoot(document.getElementById('root'));
  try {
    await act(async () => root.render(h(Component, { ...props, rencontre })));
    await click(button('Générer')); await wait();
    assert.deepEqual(pending.at(-1).input.crop, { x: 20, y: 30, zoom: 1.5 });
    assert.equal(updates.filter(update => update.id === 'r-crop').length, 0);
    const zoom = document.querySelector('input[aria-label="Zoom"]');
    await act(async () => {
      Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set.call(zoom, '2');
      zoom.dispatchEvent(new window.Event('input', { bubbles: true }));
    });
    await act(async () => { await new Promise(resolve => setTimeout(resolve, 1100)); });
    const mine = () => updates.filter(update => update.id === 'r-crop');
    assert.deepEqual(mine(), [{ table: 'team_rencontres', id: 'r-crop', clubId: 'c1', values: { photo_crops: { [photo]: { x: 20, y: 30, zoom: 2 } } } }]);
    assert.match(document.body.textContent, /Cadrage enregistré pour cette photo/);
    // Switching photos: the other one starts centred, and coming back restores the saved crop.
    const select = document.querySelector('select');
    await act(async () => { select.value = other; select.dispatchEvent(new window.Event('change', { bubbles: true })); });
    await wait();
    assert.deepEqual(pending.at(-1).input.crop, { x: 50, y: 50, zoom: 1 });
    await act(async () => { select.value = photo; select.dispatchEvent(new window.Event('change', { bubbles: true })); });
    await wait();
    assert.deepEqual(pending.at(-1).input.crop, { x: 20, y: 30, zoom: 2 });
    assert.equal(mine().length, 1);
  } finally { await act(async () => root.unmount()); }
});

test('A crop change is saved when the preview closes before the pause ends', async () => {
  pending.length = 0; updates.length = 0;
  const root = createRoot(document.getElementById('root'));
  try {
    await act(async () => root.render(h(Component, { ...props, rencontre: { ...props.rencontre, id: 'r-close' } })));
    await click(button('Générer')); await wait();
    const x = document.querySelector('input[aria-label="Focus horizontal"]');
    await act(async () => {
      Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set.call(x, '10');
      x.dispatchEvent(new window.Event('input', { bubbles: true }));
    });
    await click(button('Fermer'));
    await act(async () => { await new Promise(resolve => setTimeout(resolve, 20)); });
    assert.deepEqual(updates.filter(update => update.id === 'r-close').map(update => update.values.photo_crops), [{ [props.rencontre.photo_urls[0]]: { x: 10, y: 50, zoom: 1 } }]);
  } finally { await act(async () => root.unmount()); }
});
