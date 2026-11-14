// S8b — profil Ten'Up d'un club : parseur sur les pages réelles de trois clubs (relevé du
// 14/11/2026 ; noms des personnes remplacés, structure intacte), lecture des quatre pages dans une
// session Chromium (une page en échec n'annule pas les autres), validation de la réponse du worker.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { JSDOM } from 'jsdom';
import { chromium } from '../services/tenup-worker/node_modules/playwright/index.mjs';
import {
  extractTenupClubBoard, extractTenupClubHome, extractTenupClubOffers, extractTenupInstallation, extractTenupOfferTariffs,
} from '../services/tenup-worker/parse-club-profile.mjs';
import { readTenupClubProfile } from '../services/tenup-worker/read-club-profile.mjs';
import { createHandler, validClubProfileUrl } from '../services/tenup-worker/server.mjs';
import { isTenupImageUrl, normalizeTenupClubProfileUrl, tenupClubIdOf, validateTenupClubProfile } from '../shared/tenupSite.mjs';

const fixture = (name) => readFile(new URL(`./fixtures/tenup-profile/${name}.html`, import.meta.url), 'utf8');
const doc = async (name) => new JSDOM(await fixture(name)).window.document;

test('club page: address, contact, social links and images from the JSON-LD and the header', async () => {
  const moissac = extractTenupClubHome(await doc('60820110-club'));
  assert.deepEqual(moissac, {
    name: 'MOISSAC TENNIS CLUB', street: 'Avenue du Sarlac', postal_code: '82200', city: 'MOISSAC',
    phone: '0629334604', email: 'tennispadelmoissac@gmail.com',
    logo: 'https://cmsclub.fft.fr/60/82/0110/a4beb186-1cae-48fe-b0b2-e120d763c2e1?format=auto',
    banner: 'https://cmsclub.fft.fr/60/82/0110/22647474-12b3-4cc5-b87a-7f6f3e92c091?format=auto',
    sports: ['Tennis', 'Padel', 'Pickleball'],
    facebook_url: 'https://www.facebook.com/TCMoissac',
    instagram_url: 'https://www.instagram.com/tennis_moissac/profileca',
    installation: '/club/60820110/installations/9590',
  });
  // Ermont : ni logo ni bandeau publiés ; les liens FFT du pied de page ne sont jamais pris.
  const ermont = extractTenupClubHome(await doc('57950125-club'));
  assert.equal(ermont.street, 'Complexe Raoul Dautry, 105 rue de St Gratien');
  assert.equal(ermont.logo, '');
  assert.equal(ermont.banner, '');
  assert.equal(ermont.facebook_url, 'https://www.facebook.com/ermontact.tennis/');
  const blagnac = extractTenupClubHome(await doc('60310304-club'));
  assert.equal(blagnac.instagram_url, 'https://instagram.com/blagnac_tc');
  assert.equal(blagnac.city, 'BLAGNAC');
  for (const club of [moissac, ermont, blagnac]) assert.doesNotMatch(club.facebook_url + club.instagram_url, /FFTennis/);
});

test('team page: only the board, several roles kept', async () => {
  const { board } = extractTenupClubBoard(await doc('60820110-equipe'));
  assert.equal(board.length, 4, 'teachers and volunteers are not read');
  assert.deepEqual(board[0].roles, ['Président']);
  const ermont = extractTenupClubBoard(await doc('57950125-equipe')).board;
  assert.deepEqual(ermont[3].roles, ['Secrétaire Général Adjoint', 'Référent Engagement']);
  assert.ok(extractTenupClubBoard(await doc('60310304-equipe')).board.length >= 4);
  assert.throws(() => extractTenupClubBoard(new JSDOM('<main><h1>X</h1></main>').window.document), /not found/);
});

test('offers page: type, title, season year, price « tarif unique » or « à partir de »', async () => {
  const { offers } = extractTenupClubOffers(await doc('60820110-offres'));
  assert.equal(offers.length, 18);
  assert.deepEqual(offers[0], {
    type: 'Adhésion', title: 'Adhesion Adulte tennis hors padel 150€', year: 2027,
    description: 'Adhérez au club pour profiter librement de nos terrains de tennis en extérieur et en intérieur tous les jours de 8h à 22h.',
    price: 117, from: false, href: '/club/60820110/offres/731268',
  }, 'the club share, not the 150 € of the title; the age condition is not the price');
  assert.equal(offers[1].from, true);
  assert.equal(offers[1].price, 147);
  assert.equal(offers.find((o) => o.title === 'Reduction').price, 1);
  assert.equal(offers.find((o) => o.title.startsWith('Tube 3')).price, 6.5);
  assert.equal(offers.find((o) => o.title.startsWith('Tube 3')).type, 'Produit');
  assert.equal(offers.find((o) => o.title.startsWith('Nos proposition')).price, null);
  assert.equal(offers.filter((o) => o.type === 'Carnet de tickets').length, 2);
  const blagnac = extractTenupClubOffers(await doc('60310304-offres')).offers;
  assert.equal(blagnac.length, 36);
  assert.equal(blagnac.find((o) => o.title === 'Groupe Avenir').price, 1015, 'thousands separator');
  assert.equal(blagnac.filter((o) => o.type === 'Enseignement (cours)').length, 19);
  assert.equal(blagnac.at(-1).type, 'Animation');
  const ermont = extractTenupClubOffers(await doc('57950125-offres')).offers;
  assert.deepEqual(ermont.map((o) => o.type), ['Carnet de tickets', 'Produit', 'Produit']);
});

test('installation page: one row per sport and surface, covered courts', async () => {
  assert.deepEqual(extractTenupInstallation(await doc('60820110-installation')).courts, [
    { sport: 'Tennis', surface: 'Résine', count: 5, covered: 2 },
    { sport: 'Padel', surface: 'Gazon synthétique', count: 2, covered: 0 },
  ]);
  assert.equal(extractTenupInstallation(await doc('57950125-installation')).courts.length, 4);
  assert.deepEqual(extractTenupInstallation(await doc('60310304-installation')).courts[1], { sport: 'Tennis', surface: 'Terre battue traditionnelle', count: 4, covered: 4 });
  // S8b-bis : la photo de l'installation (CAC, relevé du 14/11/2026), padel compris.
  const cac = extractTenupInstallation(await doc('60820058-installation'));
  assert.match(cac.image, /^https:\/\/cmsclub\.fft\.fr\/60\/82\/0058\//);
  assert.deepEqual(cac.courts.at(-1), { sport: 'Padel', surface: 'Gazon synthétique', count: 2, covered: 0 });
  assert.equal(extractTenupInstallation(await doc('57950125-installation')).image.startsWith('https://cmsclub.fft.fr/'), true);
});

test('offer page (S8b-bis): the full tariff grid behind « À partir de »', async () => {
  const { tariffs } = extractTenupOfferTariffs(await doc('60820058-offre'));
  assert.equal(tariffs.length, 5);
  assert.deepEqual(tariffs[0], { name: '1 heure de tennis à 2 ni membres ni licenciés', price: 22, note: 'Tarif par personne, Licence en supplément obligatoire' });
  assert.deepEqual(tariffs.map((t) => t.price), [22, 210, 20, 170, 440]);
  assert.throws(() => extractTenupOfferTariffs(new JSDOM('<main><h1>X</h1></main>').window.document), /not found/);
});

test('links: any club tab is brought back to the club root; other hosts refused', () => {
  for (const link of ['https://tenup.fft.fr/club/60820110', 'https://tenup.fft.fr/club/60820110/offres?type=coc', ' https://tenup.fft.fr/club/60820110/installations/9590 ', 'https://tenup.fft.fr/club/60820110/']) {
    assert.equal(normalizeTenupClubProfileUrl(link), 'https://tenup.fft.fr/club/60820110');
  }
  for (const link of ['https://evil.test/club/1', 'http://tenup.fft.fr/club/1', 'https://tenup.fft.fr/championnat/1', 'https://user:pw@tenup.fft.fr/club/1', 'nope', 42]) {
    assert.throws(() => normalizeTenupClubProfileUrl(link), /Copiez le lien/);
  }
  assert.equal(tenupClubIdOf('https://tenup.fft.fr/club/60820110'), '60820110');
  assert.equal(validClubProfileUrl('https://tenup.fft.fr/club/60820110'), true);
  assert.equal(validClubProfileUrl('https://tenup.fft.fr/club/60820110/offres'), false);
  assert.equal(isTenupImageUrl('https://cmsclub.fft.fr/60/82/0110/x?format=auto'), true);
  assert.equal(isTenupImageUrl('https://evil.test/x.png'), false);
});

test('worker handler: club-profile accepts only the club root', async () => {
  const calls = [];
  const handler = createHandler({ token: 'x'.repeat(32), extract: async (url, kind) => { calls.push([url, kind]); return { ok: true }; } });
  const call = async (body) => {
    let status;
    const res = { writeHead: (s) => { status = s; }, end() {}, headersSent: false };
    await handler({ headers: { authorization: `Bearer ${'x'.repeat(32)}` }, method: 'POST', url: '/extract', body }, res);
    return status;
  };
  assert.equal(await call({ kind: 'club-profile', url: 'https://tenup.fft.fr/club/60820110' }), 200);
  assert.equal(await call({ kind: 'club-profile', url: 'https://tenup.fft.fr/club/60820110/offres' }), 400);
  assert.equal(await call({ kind: 'club-profile', url: 'https://evil.test/club/1' }), 400);
  assert.deepEqual(calls, [['https://tenup.fft.fr/club/60820110', 'club-profile']]);
});

test('one browser session reads the four pages; a failed page does not cancel the others', async () => {
  const pages = Object.fromEntries(await Promise.all(['club', 'equipe', 'offres', 'installation'].map(async (p) => [p, await fixture(`60820110-${p}`)])));
  const offer = await fixture('60820058-offre');
  const browser = await chromium.launch({ headless: true });
  try {
    const run = async (fail) => {
      const context = await browser.newContext();
      await context.route('**/*', (route) => {
        const { hostname, pathname } = new URL(route.request().url());
        if (hostname !== 'tenup.fft.fr') return route.abort();
        const name = pathname === '/club/60820110' ? 'club' : pathname.endsWith('/equipe') ? 'equipe' : pathname.endsWith('/offres') ? 'offres' : pathname.includes('/installations/') ? 'installation' : null;
        // Page d'une offre « À partir de » (structure relevée sur le CAC) ; les autres en erreur.
        if (pathname === '/club/60820110/offres/731270' && fail !== 'offre') return route.fulfill({ status: 200, contentType: 'text/html', body: offer });
        if (!name || name === fail) return route.fulfill({ status: 500, body: 'Erreur' });
        return route.fulfill({ status: 200, contentType: 'text/html', body: pages[name] });
      });
      const page = await context.newPage();
      try { return await readTenupClubProfile(page, 'https://tenup.fft.fr/club/60820110'); } finally { await context.close(); }
    };
    const full = await run(null);
    assert.deepEqual(full.pages, { club: 'ok', equipe: 'ok', offres: 'ok', installation: 'ok' });
    assert.equal(full.board.length, 4);
    assert.equal(full.offers.length, 18);
    assert.equal(full.courts.length, 2);
    assert.equal(full.club.city, 'MOISSAC');
    assert.equal('installation' in full.club, false);
    assert.match(full.club.installation_image, /^https:\/\/cmsclub\.fft\.fr\//);
    assert.equal(full.offers.some((o) => 'href' in o), false, 'links stay in the worker');
    assert.equal(full.offers[1].tariffs.length, 5, 'the « À partir de » offer page is read');
    assert.equal(full.offers.filter((o) => o.tariffs.length).length, 1, 'other offer pages failed: lowest price kept');
    assert.deepEqual(validateTenupClubProfile(JSON.parse(JSON.stringify(full)), 'https://tenup.fft.fr/club/60820110').pages, full.pages);

    const partial = await run('equipe');
    assert.deepEqual(partial.pages, { club: 'ok', equipe: 'failed', offres: 'ok', installation: 'ok' });
    assert.deepEqual(partial.board, []);
    assert.equal(partial.offers.length, 18);
    await assert.rejects(run('club'), 'the club page itself is required');
  } finally { await browser.close(); }
});

test('worker response validation: unexpected shapes and foreign images refused', () => {
  const ok = {
    url: 'https://tenup.fft.fr/club/1', pages: { club: 'ok', equipe: 'ok', offres: 'empty', installation: 'none' },
    club: { name: 'TC', street: '', postal_code: '', city: '', phone: '', email: '', facebook_url: '', instagram_url: '', logo: '', banner: '', sports: [] },
    board: [], offers: [], courts: [],
  };
  assert.deepEqual(validateTenupClubProfile(ok, ok.url), ok);
  const bad = [
    { ...ok, url: 'https://tenup.fft.fr/club/2' },
    { ...ok, pages: { ...ok.pages, club: 'failed' } },
    { ...ok, club: { ...ok.club, logo: 'https://evil.test/logo.png' } },
    { ...ok, club: { ...ok.club, facebook_url: 'javascript:alert(1)' } },
    { ...ok, offers: [{ type: 'Adhésion', title: 'A', year: 2027, description: '', price: -1, from: false }] },
    { ...ok, courts: [{ sport: 'Tennis', surface: 'Résine', count: 2, covered: 3 }] },
    { ...ok, board: [{ name: 'A', roles: 'Président' }] },
    { ...ok, club: { ...ok.club, installation_image: 'https://evil.test/court.jpg' } },
    { ...ok, offers: [{ type: 'Adhésion', title: 'A', year: 2027, description: '', price: 10, from: true, tariffs: [{ name: '', price: 10, note: '' }] }] },
    { ...ok, offers: [{ type: 'Adhésion', title: 'A', year: 2027, description: '', price: 10, from: true, tariffs: [{ name: 'B', price: -1, note: '' }] }] },
  ];
  // S8b-bis : champs nouveaux acceptés, et facultatifs (worker antérieur).
  const richer = { ...ok, club: { ...ok.club, installation_image: 'https://cmsclub.fft.fr/1/x' }, offers: [{ type: 'Adhésion', title: 'A', year: 2027, description: '', price: 10, from: true, tariffs: [{ name: 'B', price: null, note: '' }] }] };
  assert.deepEqual(validateTenupClubProfile(richer, ok.url), richer);
  for (const payload of bad) assert.throws(() => validateTenupClubProfile(payload, ok.url), /illisible/);
});
