import test from 'node:test';
import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { mkdir } from 'node:fs/promises';

const dir = new URL('../node_modules/.tmp/tenup-batch/', import.meta.url);
await mkdir(dir, { recursive: true });
const output = new URL('batch.mjs', dir);
await build({ entryPoints: [new URL('../src/components/teamMatches/tenupBatch.ts', import.meta.url).pathname], outfile: output.pathname, bundle: true, packages: 'external', platform: 'node', format: 'esm' });
const { tenupBatchCandidates, runTenupBatch, TENUP_BATCH_SPACING_MS } = await import(output.href);

const NOW = Date.parse('2026-10-31T12:00:00Z');
const day = 86_400_000;
const entry = (id, offsetDays, extra = {}) => ({ rencontre: { id, wo: false, tenup_url: `https://tenup.fft.fr/championnat/1/division/2/phase/3/poule/4/rencontre/${id}`, tenup_side: 1, tenup_synced_at: null, date_heure: new Date(NOW + offsetDays * day).toISOString(), ...extra } });

test('candidates: Ten’Up-created, unsynced, not WO, within the period, oldest first', () => {
  const entries = [
    entry('recent', -1), entry('old', -6), entry('out', -8), entry('future', 1),
    entry('manual', -2, { tenup_url: null }), entry('noside', -2, { tenup_side: null }),
    entry('wo', -2, { wo: true }), entry('done', -2, { tenup_synced_at: '2026-10-30T10:00:00Z' }),
  ];
  assert.deepEqual(tenupBatchCandidates(entries, 7, NOW).map(e => e.rencontre.id), ['old', 'recent']);
  assert.deepEqual(tenupBatchCandidates(entries, 10, NOW).map(e => e.rencontre.id), ['out', 'old', 'recent']);
});

test('run: paces previews, retries once on quota, continues past failures, applies with stored side', async () => {
  let clock = 0; const sleeps = []; const starts = []; const updates = []; const applied = [];
  const quotaOnce = new Set(['b']);
  const deps = {
    now: () => clock,
    sleep: async ms => { sleeps.push(ms); clock += ms; },
    shouldStop: () => false,
    onUpdate: (id, status, message) => updates.push([id, status, message]),
    clientFor: id => ({
      preview: async () => {
        starts.push(clock); clock += 5_000;
        if (quotaOnce.delete(id)) throw new Error('Trop de demandes. Réessayez dans une minute.');
        if (id === 'c') throw new Error('Ten’Up est indisponible ou la feuille n’est pas complète.');
        return { id: `p-${id}` };
      },
      apply: async (pid, side) => { applied.push([pid, side]); return { imported: 4, preserved: 0, confirmed: true }; },
    }),
  };
  await runTenupBatch([{ id: 'a', url: 'u', side: 0 }, { id: 'b', url: 'u', side: 1 }, { id: 'c', url: 'u', side: 1 }, { id: 'd', url: 'u', side: 1 }], deps);
  for (let i = 1; i < starts.length; i++) assert.ok(starts[i] - starts[i - 1] >= TENUP_BATCH_SPACING_MS, `preview ${i} too early`);
  assert.equal(starts.length, 5); // b relancée une fois
  assert.deepEqual(applied, [['p-a', 0], ['p-b', 1], ['p-d', 1]]);
  const final = Object.fromEntries(updates.filter(([, s]) => s !== 'running').map(([id, s, m]) => [id, [s, m]]));
  assert.deepEqual(final.a, ['imported', '4 match(s) importé(s)']);
  assert.equal(final.c[0], 'failed');
  assert.match(final.c[1], /indisponible/);
  assert.equal(final.d[0], 'imported');
});

test('run: a second quota refusal fails the rencontre; stop cancels the remaining ones', async () => {
  let stop = false; const updates = []; let previews = 0;
  await runTenupBatch([{ id: 'a', url: 'u', side: 0 }, { id: 'b', url: 'u', side: 0 }], {
    now: () => 0, sleep: async () => {}, shouldStop: () => stop,
    onUpdate: (id, status) => updates.push([id, status]),
    clientFor: () => ({ preview: async () => { previews++; stop = true; throw new Error('Trop de demandes.'); }, apply: async () => assert.fail('no apply') }),
  });
  assert.equal(previews, 1); // arrêt demandé pendant la relance : pas de second appel
  assert.deepEqual(updates, [['a', 'running'], ['a', 'cancelled'], ['b', 'cancelled']]);

  const again = []; let calls = 0;
  await runTenupBatch([{ id: 'a', url: 'u', side: 0 }], {
    now: () => 0, sleep: async () => {}, shouldStop: () => false,
    onUpdate: (id, status, message) => again.push([status, message]),
    clientFor: () => ({ preview: async () => { calls++; throw new Error('Trop de demandes.'); }, apply: async () => assert.fail('no apply') }),
  });
  assert.equal(calls, 2);
  assert.deepEqual(again.at(-1), ['failed', 'Trop de demandes.']);
});
