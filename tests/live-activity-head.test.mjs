import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import vm from 'node:vm';
import ts from 'typescript';

const file = new URL('../pwa/src/lib/liveActivity.ts', import.meta.url);
const code = ts.transpileModule(readFileSync(file, 'utf8'), {
  compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS },
}).outputText;
const module = { exports: {} };
vm.runInThisContext(`(function(require,module,exports){${code}\n})`)(() => ({}), module, module.exports);
const { mergeActivityHead } = module.exports;

const post = (sequence, body = `#${sequence}`) => ({ id: `p${sequence}`, sequence, body });
const page = (sequences, extra = {}) => ({
  items: sequences.map((s) => post(s)),
  before: sequences.length ? Math.min(...sequences) : null,
  has_more: true,
  can_animate: true,
  ...extra,
});

test('Live feed: the head read refreshes the first page without reloading older pages', () => {
  // Première page chargée : 10..14 (page suivante à partir de 10) ; 3 nouveaux posts, la tête relue en fait 13..17.
  const first = page([10, 11, 12, 13, 14]);
  const head = page([13, 15, 16, 17], { can_animate: false });
  head.items[0].body = 'modifié';
  const merged = mergeActivityHead(first, head);
  assert.deepEqual(merged.items.map((p) => p.sequence), [10, 11, 12, 13, 15, 16, 17], '14 deleted, 15–17 added, below the head kept');
  assert.equal(merged.items.find((p) => p.sequence === 13).body, 'modifié');
  assert.equal(merged.before, 10, 'next page cursor unchanged');
  assert.equal(merged.has_more, true);
  assert.equal(merged.can_animate, false);

  // Tête qui descend sous la première page (suppressions) : rien de la page suivante n'est dupliqué.
  assert.deepEqual(mergeActivityHead(first, page([8, 9, 11])).items.map((p) => p.sequence), [11]);
  // Plus aucun post visible.
  assert.deepEqual(mergeActivityHead(first, page([])).items, []);
});
