// S6b — page « Matchs par équipe » d'un club Ten'Up : extracteur du worker et validation partagée.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { JSDOM } from 'jsdom';
import { extractTenupClub } from '../services/tenup-worker/parse-club.mjs';
import { normalizeTenupClubUrl, validateTenupClub } from '../shared/tenupClub.mjs';
import { createHandler, validClubUrl } from '../services/tenup-worker/server.mjs';

const fixture = async () => new JSDOM(await readFile(new URL('./fixtures/tenup-club.html', import.meta.url), 'utf8')).window.document;

test('real club page: one entry per club team and pool, with championship, badges and dates', async () => {
  const club = validateTenupClub(extractTenupClub(await fixture()));
  assert.equal(club.club, 'CASTELSARRASIN TENNIS CLUB');
  assert.equal(club.skipped, 0);
  assert.equal(club.teams.length, 6, 'two cards of the same team and pool are merged');
  const dames2 = club.teams.find((t) => t.pool_url.endsWith('poule=514936'));
  assert.deepEqual(dames2, {
    pool_url: 'https://tenup.fft.fr/championnat/82662995?division=145644&phase=235711&poule=514936',
    competition: "Challenge d'Hiver Codep - Seniors Dames",
    team: 'CASTELSARRASIN TENNIS CLUB 2',
    level: 'Départemental', category: 'Senior', genre: 'Femme',
    dates: ['dimanche 15 novembre 2026', 'dimanche 22 novembre 2026'],
  });
  // L'équipe du club est retrouvée à domicile comme à l'extérieur, jamais l'adversaire.
  assert.deepEqual(club.teams.map((t) => t.team), [
    'CASTELSARRASIN TENNIS CLUB 1', 'CASTELSARRASIN TENNIS CLUB 2', 'CASTELSARRASIN TENNIS CLUB 4',
    'CASTELSARRASIN TENNIS CLUB 2', 'CASTELSARRASIN TENNIS CLUB 1', 'CASTELSARRASIN TENNIS CLUB 3',
  ]);
  assert.equal(new Set(club.teams.map((t) => t.competition)).size, 3);
  assert.deepEqual(club.teams.filter((t) => t.genre === 'Homme').map((t) => t.team), ['CASTELSARRASIN TENNIS CLUB 4', 'CASTELSARRASIN TENNIS CLUB 3']);
});

test('a card without the club, or without a pool link, is skipped and counted; a club playing itself keeps both teams', async () => {
  const doc = await fixture();
  const [first, second] = doc.querySelectorAll('[data-slot="card"]');
  first.querySelectorAll('span')[1].textContent = 'TC AUTRE 1';
  second.querySelector('a').setAttribute('href', '/club/60820056');
  const club = extractTenupClub(doc);
  assert.equal(club.skipped, 2);
  const derby = (await fixture()).querySelectorAll('[data-slot="card"]')[6];
  derby.querySelectorAll('span')[1].textContent = 'CASTELSARRASIN TENNIS CLUB 5';
  const own = extractTenupClub(derby.ownerDocument).teams.filter((t) => t.pool_url.endsWith('poule=514954')).map((t) => t.team);
  assert.deepEqual(own, ['CASTELSARRASIN TENNIS CLUB 3', 'CASTELSARRASIN TENNIS CLUB 5']);
  // « CASTELSARRASIN TENNIS CLUB OLYMPIQUE 1 » n'est pas une équipe du club.
  const other = await fixture();
  other.querySelector('[data-slot="card"] span').textContent = 'CASTELSARRASIN TENNIS CLUB OLYMPIQUE 1';
  assert.ok(!extractTenupClub(other).teams.some((t) => t.team.includes('OLYMPIQUE')));
  const empty = new JSDOM('<main><h1>TC VIDE</h1><p>Aucun résultat</p></main>').window.document;
  assert.deepEqual(extractTenupClub(empty), { club: 'TC VIDE', teams: [], skipped: 0 });
  assert.throws(() => extractTenupClub(new JSDOM('<main></main>').window.document), /Club name/);
});

test('club links: canonical form accepted from the club pages, anything else refused', () => {
  const canonical = 'https://tenup.fft.fr/club/60820056/competitions/rencontres';
  for (const value of [canonical, `${canonical}/`, 'https://tenup.fft.fr/club/60820056', 'https://tenup.fft.fr/club/60820056/competitions', `  ${canonical}  `]) {
    assert.equal(normalizeTenupClubUrl(value), canonical, value);
  }
  for (const value of ['https://tenup.fft.fr/championnat/82662995', 'https://evil.test/club/1/competitions/rencontres', 'https://tenup.fft.fr/club/abc', 'http://tenup.fft.fr/club/1', 'https://user@tenup.fft.fr/club/1', 12]) {
    assert.throws(() => normalizeTenupClubUrl(value), undefined, String(value));
  }
  assert.equal(validClubUrl(canonical), true);
  assert.equal(validClubUrl('https://tenup.fft.fr/club/60820056'), false, 'the worker only reads the canonical page');
  assert.equal(validClubUrl(`${canonical}?redirect=https://evil.test`), false);
});

test('validation refuses malformed payloads', async () => {
  const good = async () => extractTenupClub(await fixture());
  for (const mutate of [
    (p) => { p.club = ''; },
    (p) => { p.teams[0].pool_url = 'https://evil.test/x'; },
    (p) => { p.teams[0].pool_url = 'https://tenup.fft.fr/championnat/1'; },
    (p) => { p.teams.push({ ...p.teams[0] }); },
    (p) => { p.teams[0].dates = []; },
    (p) => { p.teams[0].genre = 'x'.repeat(61); },
    (p) => { p.skipped = -1; },
  ]) {
    const p = await good();
    mutate(p);
    assert.throws(() => validateTenupClub(p), /illisible|invalide|poule/);
  }
});

test('worker handler: kind « club » reaches the extractor with the canonical link only', async () => {
  const token = 'c'.repeat(32);
  const calls = [];
  const handler = createHandler({ token, extract: async (url, kind) => { calls.push([url, kind]); return { club: 'TC', teams: [], skipped: 0 }; } });
  const request = async (body) => {
    let status;
    await handler({ method: 'POST', url: '/extract', headers: { authorization: `Bearer ${token}` }, body }, { writeHead: (code) => { status = code; }, end() {} });
    return status;
  };
  const url = 'https://tenup.fft.fr/club/60820056/competitions/rencontres';
  assert.equal(await request({ kind: 'club', url }), 200);
  assert.deepEqual(calls, [[url, 'club']]);
  assert.equal(await request({ kind: 'club', url: 'https://tenup.fft.fr/club/60820056' }), 400);
  assert.equal(await request({ kind: 'club', url: 'https://tenup.fft.fr/championnat/1?division=1&phase=1&poule=1' }), 400);
  assert.equal(await request({ kind: 'pool', url }), 400);
  assert.equal(calls.length, 1);
});

test('worker handler: a wedged extraction cannot keep the lock; a saturated instance asks to be recycled', async () => {
  const token = 'd'.repeat(32);
  const fatal = [];
  let hang = true;
  const handler = createHandler({
    token, deadline: 50, onFatal: (message) => fatal.push(message),
    extract: async () => {
      if (hang) return new Promise(() => {}); // ne se termine jamais
      throw new Error('page.goto: net::ERR_INSUFFICIENT_RESOURCES at https://tenup.fft.fr/…');
    },
  });
  const request = async (url) => {
    let status;
    await handler({ method: 'POST', url: '/extract', headers: { authorization: `Bearer ${token}` }, body: { kind: 'club', url } }, { writeHead: (code) => { status = code; }, end() {} });
    return status;
  };
  assert.equal(await request('https://tenup.fft.fr/club/1/competitions/rencontres'), 502, 'deadline reached');
  hang = false;
  assert.equal(await request('https://tenup.fft.fr/club/2/competitions/rencontres'), 502, 'not 429: the lock was released');
  await new Promise((resolve) => setTimeout(resolve, 150));
  assert.equal(fatal.length, 2);
  assert.match(fatal[0], /deadline/);
  assert.match(fatal[1], /ERR_INSUFFICIENT_RESOURCES/);
});
