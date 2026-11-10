/** Public Ten'Up page « Matchs par équipe » of a club (`/club/<id>/competitions/rencontres`):
 * one card per upcoming encounter. Returns the club's teams, one per pool, with the
 * championship name, the pool link and the card badges (level, age group, gender).
 * Runs in Chromium (worker) and in JSDOM (tests): no dependency. */
export function extractTenupClub(document) {
  const text = (el) => el?.textContent?.replace(/\s+/g, ' ').trim() ?? '';
  const club = text(document.querySelector('main h1'));
  if (!club) throw new Error('Club name not found');
  const isClubTeam = (name) => name === club || (name.startsWith(club + ' ') && /^\d+$/.test(name.slice(club.length + 1)));
  const teams = new Map();
  let skipped = 0;
  for (const card of document.querySelectorAll('main [data-slot="card"]')) {
    const pool = [...card.querySelectorAll('a[href]')]
      .map((a) => ({ a, href: a.getAttribute('href') }))
      .find(({ href }) => /^\/championnat\/\d+\?division=\d+&phase=\d+&poule=\d+$/.test(href));
    const names = [...card.querySelectorAll('span')]
      .filter((s) => !s.matches('[data-slot="badge"]') && !s.closest('p'))
      .map(text).filter(Boolean);
    const own = names.filter(isClubTeam);
    // A club may face itself: both sides are its teams, each is kept.
    if (!pool || !own.length) { skipped += 1; continue; }
    const badges = [...card.querySelectorAll('[data-slot="badge"]')].map(text);
    const date = card.querySelector('time')?.getAttribute('datetime') || text(card.querySelector('time'));
    for (const team of own) {
      const key = `${pool.href}|${team}`;
      const found = teams.get(key);
      if (found) { found.dates.push(date); continue; }
      teams.set(key, {
        pool_url: `https://tenup.fft.fr${pool.href}`,
        competition: text(pool.a),
        team,
        level: badges[0] ?? '',
        category: badges[1] ?? '',
        genre: badges[2] ?? '',
        dates: [date],
      });
    }
  }
  return { club, teams: [...teams.values()], skipped };
}
