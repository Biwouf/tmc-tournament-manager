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
const renders = [];
const updates = [];
const supabase = { from: table => ({ update: values => ({ eq: (_c1, id) => ({ eq: async (_c2, clubId) => { updates.push({ table, values, id, clubId }); return { error: null }; } }) }) }) };
const mocks = {
  '/contexts/ClubContext.tsx': { useClub: () => ({ club: { name: 'Club' }, clubId: 'c1' }) },
  '/hooks/useClubConfig.ts': { useClubConfig: () => ({ config: { brand: { name: 'Club' }, partners: [] }, loading: false }) },
  '/lib/supabase.ts': { supabase },
  '/poster/renderResultPoster.ts': { resultPosterFooterHeight: () => 190, renderResultPoster: async input => { renders.push(input); return `data:image/png;base64,${renders.length}`; } },
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
const Component = load(new URL('../src/components/ActuGenerateImages.tsx', import.meta.url).pathname).default;
const photo = 'https://example.test/photo.jpg';
const entry = {
  rencontre: { id: 'r1', club_adverse: 'Adversaires', score_club: 4, score_adverse: 2, wo: false, photo_urls: [photo], photo_crops: { [photo]: { x: 20, y: 30, zoom: 1.5 } } },
  competition: { nom: 'Interclubs', genre: 'hommes', categorie: 'seniors', format: '4S2D' }, equipe: { numero: 1 }, etape: { phase: 'poule', numero_journee: 1 }, state: 'won',
};
const wait = ms => act(async () => { await new Promise(r => setTimeout(r, ms)); });
const button = text => [...document.querySelectorAll('button')].find(node => node.textContent.includes(text));
const slide = (label, value) => act(async () => {
  const input = document.querySelector(`input[aria-label="${label}"]`);
  Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set.call(input, value);
  input.dispatchEvent(new window.Event('input', { bubbles: true }));
});

test('Actu : le visuel part du cadrage enregistré, se recadre sur place et le cadrage est enregistré', async () => {
  const reports = [];
  const root = createRoot(document.getElementById('root'));
  try {
    await act(async () => root.render(h(Component, { chosen: [entry], lines: { r1: [] }, onChange: images => reports.push(images) })));
    await wait(300);
    assert.deepEqual(renders.at(-1).crop, { x: 20, y: 30, zoom: 1.5 });
    assert.equal(document.querySelector('input[aria-label="Zoom"]'), null);
    await act(async () => button('Recadrer').dispatchEvent(new window.MouseEvent('click', { bubbles: true })));
    assert.equal(document.querySelector('input[aria-label="Zoom"]').value, '1.5');
    await slide('Zoom', '2');
    await wait(300);
    assert.deepEqual(renders.at(-1).crop, { x: 20, y: 30, zoom: 2 });
    const last = reports.at(-1);
    assert.equal(last.ready, true);
    assert.equal(last.texte[0].src, `data:image/png;base64,${renders.length}`);
    await wait(900);
    assert.deepEqual(updates, [{ table: 'team_rencontres', id: 'r1', clubId: 'c1', values: { photo_crops: { [photo]: { x: 20, y: 30, zoom: 2 } } } }]);
    assert.match(document.body.textContent, /Cadrage enregistré pour cette photo/);
    // Fermer avant la fin du délai enregistre quand même.
    await slide('Focus horizontal', '70');
    await act(async () => button('Fermer le cadrage').dispatchEvent(new window.MouseEvent('click', { bubbles: true })));
    await wait(20);
    assert.deepEqual(updates.at(-1).values.photo_crops[photo], { x: 70, y: 30, zoom: 2 });
  } finally { await act(async () => root.unmount()); }
});
