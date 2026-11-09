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
const clubContext = { club: { name: 'Club' }, clubId: 'c' };
const lineQueries = [];
const query = { select: () => query, eq: (column, value) => { if (column === 'rencontre_id') lineQueries.push(value); return query; }, order: () => Promise.resolve({ data: [], error: null }) };
const mocks = {
  '/lib/supabase.ts': { supabase: { from: () => query } },
  '/contexts/ClubContext.tsx': { useClub: () => clubContext },
  '/hooks/useClubConfig.ts': { useClubConfig: () => ({ config, loading: false }) },
  '/poster/renderResultPoster.ts': { resultPosterFooterHeight: () => 190, renderResultPoster: input => Promise.resolve(`data:image/png;base64,${input.rencontre.id}`) },
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
const Picker = load(new URL('../src/components/teamMatches/poster/SeasonResultPicker.tsx', import.meta.url).pathname).default;
const context = { competition: { nom: 'Interclubs', genre: 'hommes', categorie: 'seniors', format: '4S2D' }, equipe: { numero: 1 }, etape: { phase: 'poule', numero_journee: 1 } };
const entry = (id, date, score, photos = []) => ({ ...context, state: 'win', rencontre: { id, date_heure: date, score_club: score, score_adverse: score === null ? null : 2, wo: false, photo_urls: photos, club_adverse: `Adv ${id}` } });
const daysAgo = days => new Date(Date.now() - days * 86400000).toISOString();
const entries = [entry('old', daysAgo(30), 4), entry('a', daysAgo(5), 4), entry('b', daysAgo(2), 4, ['https://example.test/p.jpg']), entry('c', daysAgo(1), null), entry('d', daysAgo(0.5), 0)];
const button = text => [...document.querySelectorAll('button')].find(node => node.textContent.includes(text));
const settle = () => act(async () => { await new Promise(resolve => setTimeout(resolve, 230)); });

test('Batch: only finished rencontres (all points of the format awarded), most recent preselected, all checked ones previewed and downloaded', async () => {
  const root = createRoot(document.getElementById('root'));
  const clicked = [];
  const original = window.HTMLAnchorElement.prototype.click;
  window.HTMLAnchorElement.prototype.click = function () { clicked.push(this.download); };
  try {
    await act(async () => root.render(h(Picker, { entries })));
    const boxes = () => [...document.querySelectorAll('input[type=checkbox]')];
    // Last 7 days only; older rencontres are folded away.
    assert.equal(boxes().length, 2);
    assert.deepEqual(boxes().map(box => box.checked), [true, false]);
    assert.match(button('plus anciennes').textContent, /\(1\)/);
    await act(async () => button('plus anciennes').click());
    assert.equal(boxes().length, 3);
    await act(async () => button('plus anciennes').click());
    assert.equal(boxes().length, 2);
    assert.equal(button('Tout télécharger'), undefined);
    await act(async () => boxes()[1].click());
    // Lines load, then the debounced render runs.
    await settle(); await settle();
    assert.deepEqual(lineQueries.sort(), ['a', 'b']);
    assert.equal(document.querySelectorAll('a[download]').length, 2);
    assert.match(button('Tout télécharger').textContent, /2\/2/);
    await act(async () => button('Tout télécharger').click());
    await act(async () => { await new Promise(resolve => setTimeout(resolve, 500)); });
    // b has photos (team spirit preselected), a has none (detailed results).
    assert.deepEqual(clicked, ['resultat-b-photo.png', 'resultat-a-details.png']);
    await act(async () => button('Tout décocher').click());
    assert.equal(document.querySelectorAll('a[download]').length, 0);
  } finally { window.HTMLAnchorElement.prototype.click = original; await act(async () => root.unmount()); }
});

test('Without recent rencontres, older ones are unfolded and nothing is preselected', async () => {
  const root = createRoot(document.getElementById('root'));
  try {
    await act(async () => root.render(h(Picker, { entries: [entry('old', daysAgo(30), 4)] })));
    assert.match(document.getElementById('root').textContent, /Aucune rencontre terminée ces 7 derniers jours/);
    assert.equal(button('plus anciennes').getAttribute('aria-expanded'), 'true');
    assert.deepEqual([...document.querySelectorAll('input[type=checkbox]')].map(box => box.checked), [false]);
  } finally { await act(async () => root.unmount()); }
});
