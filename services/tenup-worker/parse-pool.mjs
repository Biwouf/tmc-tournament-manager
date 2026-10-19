/** Public Ten'Up DOM: team links identify teams; card order is home / away. */
export function extractTenupPoolRound(document) {
  const text = (el) => el?.textContent?.replace(/\s+/g, ' ').trim() ?? '';
  const teamId = (a) =>
    a?.getAttribute('href')?.match(/^\/championnat\/\d+\/equipe\/(\d+)$/)?.[1];
  const filters = ['Division', 'Phase', 'Poule'].map((label) =>
    text(
      document.querySelector(
        `main button[data-slot="select-trigger"][aria-label="${label}"]`
      )
    )
  );
  const teams = new Map();
  for (const a of document.querySelectorAll('main a[href]')) {
    const id = teamId(a);
    if (id) teams.set(id, { id, name: text(a) });
  }
  const calendar = [...document.querySelectorAll('main section')].find(
    (s) => text(s.querySelector('h3')) === 'Le calendrier des rencontres'
  );
  const day = text(
    calendar?.querySelector('button[data-slot="select-trigger"]')
  ).match(/^Journée\s+(\d+)$/i);
  if (filters.some((x) => !x) || !day || teams.size < 2)
    throw new Error('Incomplete pool');
  // A forfeit card has no rencontre link: its id is only in the Next.js
  // payload, whose flat rencontre objects carry both teams and the home side.
  let payload;
  const payloadRencontres = () => {
    if (payload) return payload;
    const raw = [...document.scripts]
      .map(
        (s) =>
          s.textContent.match(/^self\.__next_f\.push\(\[1,(".*")\]\)$/s)?.[1]
      )
      .filter(Boolean)
      .map((x) => JSON.parse(x))
      .join('');
    payload = (raw.match(/\{"id":\d+,[^{}]*\}/g) ?? [])
      .map((x) => JSON.parse(x))
      .filter((r) => 'idEquipe1' in r && 'idEquipe2' in r);
    return payload;
  };
  const rencontrePath = (home, away, date) => {
    const found = payloadRencontres().filter(
      (r) =>
        [String(r.idEquipe1), String(r.idEquipe2)].sort().join() ===
          [home, away].sort().join() &&
        String(r.idEquipeDomicileReelle) === home &&
        r.dateReelle === date
    );
    // Each filter keeps its selected id in the hidden input that follows it.
    const [division, phase, poule] = ['Division', 'Phase', 'Poule'].map(
      (label) =>
        document.querySelector(
          `main button[data-slot="select-trigger"][aria-label="${label}"] + input`
        )?.value
    );
    const championnat = document
      .querySelector('main a[href^="/championnat/"][href*="/equipe/"]')
      .getAttribute('href')
      .split('/')[2];
    if (
      found.length !== 1 ||
      ![division, phase, poule].every((x) => /^\d+$/.test(x ?? ''))
    )
      throw new Error('Incomplete calendar card');
    return `/championnat/${championnat}/division/${division}/phase/${phase}/poule/${poule}/rencontre/${found[0].id}`;
  };
  // Each card links both teams (home first) and, in its footer, the rencontre.
  const matches = [...calendar.querySelectorAll('[data-slot="card"]')].map(
    (card) => {
      const ids = [
        ...card.querySelectorAll('[data-slot="card-content"] a[href]'),
      ].map(teamId);
      const rencontre = card.querySelector('a[href*="/rencontre/"]');
      const date = card
        .querySelector('time')
        ?.getAttribute('datetime')
        ?.slice(0, 10);
      if (ids.length !== 2 || !teams.has(ids[0]) || !teams.has(ids[1]) || !date)
        throw new Error('Incomplete calendar card');
      return {
        url: new URL(
          rencontre?.getAttribute('href') ??
            rencontrePath(ids[0], ids[1], date),
          'https://tenup.fft.fr'
        ).href,
        home_id: ids[0],
        away_id: ids[1],
        date,
      };
    }
  );
  return {
    division: filters[0],
    phase: filters[1],
    poule: filters[2],
    teams: [...teams.values()],
    round: { numero: Number(day[1]), matches },
  };
}
