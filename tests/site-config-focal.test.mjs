import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import { createRequire } from 'node:module';
import { resolve, dirname } from 'node:path';
import test from 'node:test';
import vm from 'node:vm';

const project = resolve(import.meta.dirname, '..');
const require = createRequire(resolve(project, 'package.json'));
const ts = require('typescript');
const { JSDOM } = require('jsdom');
const React = require('react');
const { act, createElement: h } = React;
const dom = new JSDOM('<div id="root"></div>', { url: 'http://localhost/' });
globalThis.window = dom.window;
globalThis.document = dom.window.document;
globalThis.IS_REACT_ACT_ENVIRONMENT = true;
const { createRoot } = require('react-dom/client');
let stored;
const supabase = {
  from(table) {
    assert.equal(table, 'club_settings');
    let patch;
    return {
      eq(key, value) { assert.equal(key, 'club_id'); assert.equal(value, 'test-club'); return this; },
      update(value) { patch = value; return this; },
      select() {
        if (!patch) return this;
        stored = JSON.parse(JSON.stringify(patch.config));
        return Promise.resolve({ data: [{ club_id: 'test-club' }], error: null });
      },
      maybeSingle() { return Promise.resolve({ data: { config: stored }, error: null }); },
    };
  },
};
const modules = new Map();
function load(file) {
  if (file.endsWith('/lib/supabase.ts')) return { supabase };
  if (modules.has(file)) return modules.get(file).exports;
  const module = { exports: {} };
  modules.set(file, module);
  const code = ts.transpileModule(readFileSync(file, 'utf8'), {
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX },
  }).outputText;
  const localRequire = name => {
    if (!name.startsWith('.')) return require(name);
    const path = resolve(dirname(file), name);
    return load([path, `${path}.ts`, `${path}.tsx`].find(existsSync));
  };
  vm.runInThisContext(`(function(require,module,exports){${code}\n})`, { filename: file })(localRequire, module, module.exports);
  return module.exports;
}
const { asFocal, CLUB_CONFIG_GROUPS, groupValueFromConfig, validateClubConfigGroup } = load(resolve(project, 'src/lib/clubConfigWrite.ts'));
const { parseClubConfig } = load(resolve(project, 'src/lib/clubConfig.ts'));
const { default: Panel } = load(resolve(project, 'src/components/siteConfig/SiteConfigPanel.tsx'));
const { focalPointStyle } = load(resolve(project, 'web/src/lib/focalPoint.ts'));

for (const scenario of [
  { group: 'home', data: { hero_image: 'https://example.com/photo.jpg' }, focal: config => config.home.hero_image_focal },
  { group: 'club', data: { board: [{ name: 'Camille', role: 'Présidence', photo: 'https://example.com/photo.jpg' }] }, focal: config => config.club.board[0].photo_focal },
  { group: 'infra', data: { clubhouse: { images: ['https://example.com/photo.jpg'] } }, focal: config => config.infra.clubhouse.images_focal?.[0] },
]) {
  test(`${scenario.group}: selected subject stays selected through save, reload and reset`, async () => {
    stored = { [scenario.group]: scenario.data, future_key: { keep: true } };
    const group = CLUB_CONFIG_GROUPS.find(g => g.key === scenario.group);
    const root = createRoot(document.getElementById('root'));
    let revision = 0;
    const render = () => act(async () => root.render(h(Panel, {
      key: revision++, group, initial: groupValueFromConfig(group, parseClubConfig(stored)),
      clubId: 'test-club', defaultOpen: true, onSaved() {},
    })));
    const picture = () => [...document.querySelectorAll('img')].at(-1);
    const marker = () => picture().parentElement.querySelector('[aria-hidden]');
    const button = text => [...document.querySelectorAll('button')].find(b => b.textContent.includes(text));
    const click = element => act(async () => element.dispatchEvent(new window.MouseEvent('click', { bubbles: true })));
    try {
      await render();
      await act(async () => picture().dispatchEvent(new window.Event('load')));
      const overlay = picture().parentElement.querySelector('[title="Cliquez pour définir le point d’intérêt"]');
      overlay.getBoundingClientRect = () => ({ left: 100, top: 200, width: 400, height: 300 });
      for (let i = 0; i < 2; i++) {
        await act(async () => overlay.dispatchEvent(new window.MouseEvent('click', { bubbles: true, clientX: 420, clientY: 230 })));
        assert.equal(marker().style.left, '80%', 'the marker must follow the clicked subject immediately');
        assert.equal(marker().style.top, '10%');
        assert.ok(button('Recentrer'), 'reset is available before saving');
      }
      await click(button('Enregistrer'));
      assert.deepEqual(scenario.focal(stored), { x: 80, y: 10 });
      assert.deepEqual(stored.future_key, { keep: true });
      assert.equal(marker().style.left, '80%', 'validated object still displays after save');
      assert.deepEqual(focalPointStyle(scenario.focal(parseClubConfig(stored))), { objectPosition: '80% 10%' });
      await render();
      await act(async () => picture().dispatchEvent(new window.Event('load')));
      assert.equal(marker().style.left, '80%', 'saved point survives reopening the panel');
      await click(button('Recentrer'));
      assert.equal(marker().style.left, '50%');
      await click(button('Enregistrer'));
      assert.equal(scenario.focal(stored), undefined, 'reset removes the stored focal');
      assert.deepEqual(focalPointStyle(scenario.focal(parseClubConfig(stored))), { objectPosition: '50% 50%' });
    } finally { await act(async () => root.unmount()); }
  });
}

test('form strings and saved objects use the same focal coordinates', () => {
  for (const value of ['37 62', ' 37   62 ', { x: 37, y: 62 }]) assert.equal(asFocal(value), '37 62');
  for (const value of [undefined, null, '', 'abc', '101 50', { x: -1, y: 50 }, { x: Infinity, y: 2 }]) assert.equal(asFocal(value), '');
});

test('validation rejects out-of-range coordinates in strings and objects', () => {
  const group = CLUB_CONFIG_GROUPS.find(g => g.key === 'home');
  const value = groupValueFromConfig(group, parseClubConfig({ home: { hero_image: 'https://example.com/photo.jpg' } }));
  for (const focal of ['101 50', '-1 50', { x: 101, y: 50 }, { x: 50, y: -1 }]) {
    assert.equal(validateClubConfigGroup(group, { ...value, hero_image_focal: focal }).valid, false);
  }
});
