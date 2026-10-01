import { extractTenupPoolRound } from './parse-pool.mjs';

/** Wait for a complete round, including cards rendered after the heading. */
async function readRound(page, numero) {
  const result = await page.waitForFunction(
    `(() => {
    try {
      const pool = (${extractTenupPoolRound.toString()})(document);
      if (pool.round.numero !== ${numero} || pool.round.matches.length !== Math.floor(pool.teams.length / 2)) return false;
      return pool;
    } catch { return false; }
  })()`,
    null,
    { timeout: 8_000 }
  );
  try {
    return await result.jsonValue();
  } finally {
    await result.dispose();
  }
}

export async function readTenupPool(page) {
  const button = page.locator('button[aria-label="Sélectionner une journée"]');
  const options = page.getByRole('option');
  const openDays = async () => {
    for (let attempt = 0; attempt < 6; attempt++) {
      // SSR can expose the button before Vue has attached its listeners.
      const expanded = await button.evaluate((el) =>
        el.closest('[aria-haspopup="listbox"]')?.getAttribute('aria-expanded')
      );
      if (expanded !== 'true') await button.click({ timeout: 8_000 });
      try {
        await options.first().waitFor({ timeout: 1_000 });
        return;
      } catch (error) {
        if (attempt === 5) throw error;
      }
    }
  };
  await openDays();
  const days = (await options.allTextContents()).map((x) => x.trim());
  if (
    !days.length ||
    days.length > 30 ||
    days.some((x, i) => x !== `Journée ${i + 1}`)
  )
    throw new Error('Invalid round list');
  await page.keyboard.press('Escape');
  const rounds = [];
  let pool;
  for (let i = 0; i < days.length; i++) {
    if ((await button.textContent()).trim() !== days[i]) {
      const previous = await page
        .locator('main a[href*="/rencontre/"]')
        .first()
        .getAttribute('href');
      await openDays();
      await page
        .getByRole('option', { name: days[i], exact: true })
        .click({ timeout: 8_000 });
      // A new heading alone is not sufficient: the previous round may remain
      // visible while the request for the next round is still pending.
      await page.waitForFunction(
        (previous) =>
          ![...document.querySelectorAll('main a[href*="/rencontre/"]')].some(
            (a) => a.getAttribute('href') === previous
          ),
        previous,
        { timeout: 8_000 }
      );
    }
    const current = await readRound(page, i + 1);
    if (pool && JSON.stringify(current.teams) !== JSON.stringify(pool.teams))
      throw new Error('Pool changed');
    pool = current;
    rounds.push(current.round);
  }
  return {
    division: pool.division,
    phase: pool.phase,
    poule: pool.poule,
    teams: pool.teams,
    rounds,
  };
}
