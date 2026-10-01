/** Public Ten'Up DOM: team links identify teams; card order is home / away. */
export function extractTenupPoolRound(document) {
  const text = (el) => el?.textContent?.replace(/\s+/g, ' ').trim() ?? '';
  const filters = [
    ...document.querySelectorAll('main [aria-haspopup="listbox"] button'),
  ]
    .filter((el) => !el.hasAttribute('aria-label'))
    .map(text);
  const teams = new Map();
  for (const a of document.querySelectorAll('main a[href]')) {
    const match = a
      .getAttribute('href')
      .match(/^\/championnat\/\d+\/equipe\/(\d+)$/);
    if (match) teams.set(match[1], { id: match[1], name: text(a) });
  }
  const byName = new Map();
  for (const team of teams.values()) {
    if (byName.has(team.name)) throw new Error('Ambiguous team names');
    byName.set(team.name, team.id);
  }
  const day = text(
    document.querySelector('button[aria-label="Sélectionner une journée"]')
  ).match(/^Journée\s+(\d+)$/i);
  if (filters.length !== 3 || !day || teams.size < 2)
    throw new Error('Incomplete pool');
  const matches = [
    ...document.querySelectorAll('main a[href*="/rencontre/"]'),
  ].map((a) => {
    const names = [...a.querySelectorAll('p')].map(text);
    const date = a
      .querySelector('time')
      ?.getAttribute('datetime')
      ?.slice(0, 10);
    if (
      names.length !== 2 ||
      !byName.has(names[0]) ||
      !byName.has(names[1]) ||
      !date
    )
      throw new Error('Incomplete calendar card');
    return {
      url: new URL(a.getAttribute('href'), 'https://tenup.fft.fr').href,
      home_id: byName.get(names[0]),
      away_id: byName.get(names[1]),
      date,
    };
  });
  return {
    division: filters[0],
    phase: filters[1],
    poule: filters[2],
    teams: [...teams.values()],
    round: { numero: Number(day[1]), matches },
  };
}
