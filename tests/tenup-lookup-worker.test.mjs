// Onboarding Ten'Up d'abord, P1-back — lecture d'identité du worker (`kind: 'club-identity'`,
// `readTenupClubProfile(..., { pages: ['club'] })`) : la page « Le club » seule, dans Chromium, sur
// les fixtures réelles `tests/fixtures/tenup-profile/` ; 404 et page sans JSON-LD → « introuvable ».
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { JSDOM } from 'jsdom';
import { chromium } from '../services/tenup-worker/node_modules/playwright/index.mjs';
import { extractTenupClubIdentity } from '../services/tenup-worker/parse-club-profile.mjs';
import { readTenupClubProfile } from '../services/tenup-worker/read-club-profile.mjs';
import { createHandler } from '../services/tenup-worker/server.mjs';
import { validateTenupClubProfile } from '../shared/tenupSite.mjs';

const fixture = (name) => readFile(new URL(`./fixtures/tenup-profile/${name}.html`, import.meta.url), 'utf8');
const doc = async (name) => new JSDOM(await fixture(name)).window.document;

test('identity: JSON-LD present, courts summed over the installation cards', async () => {
  assert.deepEqual(extractTenupClubIdentity(await doc('60820110-club')), { found: true, courts: 7 });
  assert.deepEqual(extractTenupClubIdentity(await doc('57950125-club')), { found: true, courts: 17 }, 'two installations');
  assert.deepEqual(extractTenupClubIdentity(await doc('60310304-club')), { found: true, courts: 17 });
  assert.deepEqual(extractTenupClubIdentity(new JSDOM('<main><h1>Page</h1></main>').window.document), { found: false, courts: null });
});

test('identity read: only « Le club », other pages skipped, valid profile; 404 and no JSON-LD refused', async () => {
  const club = await fixture('60820110-club');
  const browser = await chromium.launch({ headless: true });
  try {
    const run = async (status, body = club) => {
      const context = await browser.newContext();
      const visited = [];
      await context.route('**/*', (route) => {
        const { hostname, pathname } = new URL(route.request().url());
        if (hostname !== 'tenup.fft.fr') return route.abort();
        visited.push(pathname);
        if (pathname === '/club/60820110') return route.fulfill({ status, contentType: 'text/html', body });
        return route.fulfill({ status: 500, body: 'Erreur' });
      });
      const page = await context.newPage();
      try { return { result: await readTenupClubProfile(page, 'https://tenup.fft.fr/club/60820110', { pages: ['club'] }), visited }; }
      finally { await context.close(); }
    };
    const started = Date.now();
    const { result, visited } = await run(200);
    assert.ok(Date.now() - started < 8_000, 'within the 8 s budget');
    assert.deepEqual(visited.filter((p) => p.startsWith('/club/')), ['/club/60820110'], 'no other club page');
    assert.deepEqual(result.pages, { club: 'ok', equipe: 'skipped', offres: 'skipped', installation: 'skipped' });
    assert.equal(result.club.name, 'MOISSAC TENNIS CLUB');
    assert.equal(result.club.street, 'Avenue du Sarlac');
    assert.equal(result.club.courts_count, 7);
    assert.deepEqual(result.club.sports, ['Tennis', 'Padel', 'Pickleball']);
    assert.deepEqual([result.board, result.offers, result.courts], [[], [], []]);
    assert.equal('installation' in result.club, false);
    assert.deepEqual(validateTenupClubProfile(JSON.parse(JSON.stringify(result)), 'https://tenup.fft.fr/club/60820110'), result);

    await assert.rejects(run(404, '<main><h1>Page introuvable</h1></main>'), /HTTP 404/);
    await assert.rejects(run(200, '<html><body><main><h1>Un club</h1></main></body></html>'), /Club profile not found/);
  } finally { await browser.close(); }
});

test('worker handler: club-identity takes the club root, « not found » is a 404', async () => {
  const calls = [];
  let failure = null;
  const handler = createHandler({ token: 'x'.repeat(32), extract: async (url, kind) => {
    calls.push([url, kind]);
    if (failure) throw new Error(failure);
    return { ok: true };
  } });
  const call = async (body) => {
    let status, sent;
    const res = { writeHead: (s) => { status = s; }, end: (b) => { sent = JSON.parse(b); }, headersSent: false };
    await handler({ headers: { authorization: `Bearer ${'x'.repeat(32)}` }, method: 'POST', url: '/extract', body }, res);
    return [status, sent];
  };
  assert.equal((await call({ kind: 'club-identity', url: 'https://tenup.fft.fr/club/60820110' }))[0], 200);
  assert.equal((await call({ kind: 'club-identity', url: 'https://tenup.fft.fr/club/60820110/offres' }))[0], 400);
  assert.deepEqual(calls, [['https://tenup.fft.fr/club/60820110', 'club-identity']]);
  const errors = console.error;
  console.error = () => {};
  try {
    failure = 'HTTP 404';
    assert.deepEqual(await call({ kind: 'club-identity', url: 'https://tenup.fft.fr/club/1' }), [404, { error: 'Club introuvable sur Ten’Up.', reason: 'not_found' }]);
    failure = 'Club profile not found';
    assert.equal((await call({ kind: 'club-identity', url: 'https://tenup.fft.fr/club/2' }))[0], 404);
    failure = 'Timeout 8000ms exceeded';
    assert.equal((await call({ kind: 'club-identity', url: 'https://tenup.fft.fr/club/3' }))[0], 502);
    failure = 'HTTP 404';
    assert.equal((await call({ kind: 'club-profile', url: 'https://tenup.fft.fr/club/4' }))[0], 502, 'club-profile unchanged');
  } finally { console.error = errors; }
});
