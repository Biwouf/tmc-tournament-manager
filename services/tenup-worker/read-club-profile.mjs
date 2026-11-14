import { extractTenupClubBoard, extractTenupClubHome, extractTenupClubOffers, extractTenupInstallation } from './parse-club-profile.mjs';

/** SaaS S8b — reads a club's public Ten'Up profile in ONE browser session: « Le club » (required),
 * then « Équipe & contact », « Offres et tarifs » and the first installation. A failed sub-page
 * does not cancel the others: its status says so, and the review shows what was read.
 * `budget` keeps the whole read under the handler deadline (45 s). */
export async function readTenupClubProfile(page, url, { budget = 32_000, now = Date.now } = {}) {
  const started = now();
  const evaluate = (fn) => page.evaluate(`(${fn.toString()})(document)`);
  const open = async (target, ready, timeout = 12_000) => {
    const response = await page.goto(target, { waitUntil: 'domcontentloaded', timeout });
    if (response && response.status() >= 400) throw new Error(`HTTP ${response.status()}`);
    await ready();
    if (page.url() !== target) throw new Error('Unexpected destination');
  };

  await open(url, () => page.locator('main h1').first().waitFor({ timeout: 12_000 }), 30_000);
  // Les installations se chargent après l'en-tête (Moissac, 14/11/2026) ; un club peut n'en avoir aucune.
  await page.locator('main a[href*="/installations/"]').first().waitFor({ timeout: 6_000 }).catch(() => {});
  const home = await evaluate(extractTenupClubHome);
  const pages = { club: 'ok', equipe: 'failed', offres: 'failed', installation: home.installation ? 'failed' : 'none' };
  let board = [], offers = [], courts = [];

  const step = async (name, run) => {
    if (now() - started > budget) return; // reste « failed » : la relecture le signale
    try { await run(); } catch (error) {
      pages[name] = 'failed';
      console.error('[tenup-worker] club profile page failed', { page: name, url, error: String(error?.message ?? error).slice(0, 300) });
    }
  };
  await step('equipe', async () => {
    await open(`${url}/equipe`, () => page.locator('main h2').filter({ hasText: /L.équipe du club/ }).first().waitFor({ timeout: 10_000 }));
    // Les cartes du bureau peuvent arriver après le titre ; une page sans bureau reste valable.
    await page.getByText('Équipe dirigeante', { exact: true }).first().waitFor({ timeout: 3_000 }).catch(() => {});
    board = (await evaluate(extractTenupClubBoard)).board;
    pages.equipe = 'ok';
  });
  await step('offres', async () => {
    await open(`${url}/offres`, () => page.locator('main nav[aria-label="Sections du club"]').first().waitFor({ timeout: 10_000 }));
    // Aucune carte après 8 s : le club ne publie pas d'offre.
    const any = await page.locator('main [data-slot="card"]').first().waitFor({ timeout: 8_000 }).then(() => true, () => false);
    offers = any ? (await evaluate(extractTenupClubOffers)).offers : [];
    pages.offres = any ? 'ok' : 'empty';
  });
  if (home.installation) {
    await step('installation', async () => {
      await open(`https://tenup.fft.fr${home.installation}`, () => page.locator('main p').filter({ hasText: /^Courts$/ }).first().waitFor({ timeout: 10_000 }));
      courts = (await evaluate(extractTenupInstallation)).courts;
      pages.installation = 'ok';
    });
  }
  const { installation: _installation, ...club } = home;
  return { url, pages, club, board, offers, courts };
}
