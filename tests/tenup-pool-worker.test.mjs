import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { JSDOM } from 'jsdom';
import { extractTenupPoolRound } from '../services/tenup-worker/parse-pool.mjs';
import {
  validateTenupPool,
  teamCalendar,
  normalizeTenupPoolUrl,
} from '../shared/tenupPool.mjs';
import { validPoolUrl } from '../services/tenup-worker/server.mjs';
const url =
  'https://tenup.fft.fr/championnat/82678463?division=144146&phase=233672&poule=513524';
export async function fixturePool() {
  const doc = new JSDOM(
    await readFile(
      new URL('./fixtures/tenup-pool.html', import.meta.url),
      'utf8'
    )
  ).window.document;
  const { round, ...pool } = extractTenupPoolRound(doc);
  return { ...pool, rounds: [round] };
}
test('real public DOM retains distinct team identities, dates and home/away', async () => {
  const p = validateTenupPool(await fixturePool(), url);
  assert.equal(p.division, 'GROUPE B');
  assert.equal(p.teams.length, 6);
  assert.deepEqual(teamCalendar(p, '2474059')[0], {
    numero: 1,
    exempt: false,
    date: '2026-10-25',
    domicile: true,
    adversaire: 'AUCAMVILLE TENNIS CLUB 1',
    url: 'https://tenup.fft.fr/championnat/82678463/division/144146/phase/233672/poule/513524/rencontre/9886408',
  });
  assert.equal(teamCalendar(p, '2476260')[0].domicile, false);
  assert.equal(validPoolUrl(url), true);
  assert.throws(() => normalizeTenupPoolUrl(url.split('?')[0]));
  assert.equal(validPoolUrl(url + '&redirect=https://evil.test'), false);
});
test('rejects partial rounds, wrong pool sources, duplicate team identities and impossible dates', async () => {
  for (const mutate of [
    (p) => p.rounds[0].matches.pop(),
    (p) => p.teams.push(p.teams[0]),
    (p) => (p.rounds[0].matches[0].date = '2026-02-30'),
    (p) =>
      (p.rounds[0].matches[0].url = p.rounds[0].matches[0].url.replace(
        '/513524/',
        '/1/'
      )),
    (p) => (p.rounds[0].matches[0].away_id = p.rounds[0].matches[0].home_id),
    (p) => (p.rounds[0].numero = 2),
  ]) {
    const p = await fixturePool();
    mutate(p);
    assert.throws(() => validateTenupPool(p, url));
  }
  const p = await fixturePool();
  p.teams.push({ id: '999', name: 'CASTELSARRASIN TENNIS CLUB 2' });
  validateTenupPool(p, url);
  assert.equal(teamCalendar(p, '999')[0].exempt, true);
});
test('a forfeit card without a link takes its rencontre id from the Next.js payload', async () => {
  const html = await readFile(
    new URL('./fixtures/tenup-pool-forfait.html', import.meta.url),
    'utf8'
  );
  const parse = (value) =>
    extractTenupPoolRound(new JSDOM(value).window.document);
  const base =
    'https://tenup.fft.fr/championnat/82647633/division/142820/phase/231381/poule/510344/rencontre/';
  const { round, ...pool } = parse(html);
  assert.deepEqual(round.matches[1], {
    url: base + '9822752',
    home_id: '2449814',
    away_id: '2449821',
    date: '2026-10-04',
  });
  validateTenupPool(
    { ...pool, rounds: [{ ...round, numero: 1 }] },
    'https://tenup.fft.fr/championnat/82647633?division=142820&phase=231381&poule=510344'
  );
  // Without the payload, or when its home side or date disagree, the card stays unreadable.
  for (const value of [
    html.replace(/<script>[\s\S]*<\/script>/, ''),
    html.replace(
      '\\"idEquipeDomicileReelle\\":2449814,\\"idEquipeDomicileTheorique\\":2449814,\\"idEquipeGagnante\\":2449821',
      '\\"idEquipeDomicileReelle\\":2449821,\\"idEquipeDomicileTheorique\\":2449814,\\"idEquipeGagnante\\":2449821'
    ),
    html.replace(
      '\\"id\\":9822752,\\"dateReelle\\":\\"2026-10-04\\"',
      '\\"id\\":9822752,\\"dateReelle\\":\\"2026-10-05\\"'
    ),
  ]) {
    assert.notEqual(value, html);
    assert.throws(() => parse(value), /Incomplete calendar card/);
  }
});
