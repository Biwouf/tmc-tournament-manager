// S6b — la page club s'affiche d'abord vide (« Aucun résultat »), puis charge ses rencontres :
// le worker doit attendre les cartes, et n'accepter l'état vide qu'après ce délai.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { chromium } from '../services/tenup-worker/node_modules/playwright/index.mjs';
import { waitForClubCards } from '../services/tenup-worker/server.mjs';
import { extractTenupClub } from '../services/tenup-worker/parse-club.mjs';

test('club page: cards loaded after the server-rendered empty state are read; a real empty club is accepted', async () => {
  const browser = await chromium.launch({ headless: true });
  try {
    const page = await browser.newPage();
    const fixture = await readFile(new URL('./fixtures/tenup-club.html', import.meta.url), 'utf8');
    const section = /<section>[\s\S]*<\/section>/.exec(fixture)[0];
    await page.setContent('<main><h1>CASTELSARRASIN TENNIS CLUB</h1><div id="list"><p>Aucun résultat</p><p>Il n’y a aucune compétition actuellement.</p></div></main>');
    await page.evaluate((html) => setTimeout(() => { document.getElementById('list').innerHTML = html; }, 600), section);
    await waitForClubCards(page);
    const club = await page.evaluate(`(${extractTenupClub.toString()})(document)`);
    assert.equal(club.teams.length, 6, 'not the empty state shown first');

    await page.setContent('<main><h1>TC VIDE</h1><p>Aucun résultat</p></main>');
    const started = Date.now();
    await waitForClubCards(page, 300);
    assert.ok(Date.now() - started >= 300, 'the empty state is accepted only after the wait');
    assert.deepEqual(await page.evaluate(`(${extractTenupClub.toString()})(document)`), { club: 'TC VIDE', teams: [], skipped: 0 });

    await page.setContent('<main><h1>TC</h1><p>File d’attente</p></main>');
    await assert.rejects(waitForClubCards(page, 300), 'neither cards nor empty state: the read fails');
  } finally { await browser.close(); }
});
