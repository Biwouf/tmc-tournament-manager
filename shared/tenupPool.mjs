import { normalizeTenupCompetitionUrl } from './tenupCompetitionUrl.mjs';
export function normalizeTenupPoolUrl(value) {
  const url = normalizeTenupCompetitionUrl(value);
  if (!url.includes('?'))
    throw new Error(
      'Copiez le lien Ten’Up de la poule, avec sa division et sa phase.'
    );
  return url;
}
/** Reject partial calendars rather than creating incomplete teams. */
export function validateTenupPool(payload, source) {
  const url = new URL(normalizeTenupPoolUrl(source));
  const base = `${url.origin}${url.pathname}/division/${url.searchParams.get('division')}/phase/${url.searchParams.get('phase')}/poule/${url.searchParams.get('poule')}/rencontre/`;
  const label = (x) => typeof x === 'string' && x.trim() && x.length <= 160;
  if (
    !payload ||
    ![payload.division, payload.phase, payload.poule].every(label) ||
    !Array.isArray(payload.teams) ||
    payload.teams.length < 2 ||
    payload.teams.length > 50 ||
    !Array.isArray(payload.rounds) ||
    !payload.rounds.length ||
    payload.rounds.length > 30
  )
    throw new Error('Calendrier Ten’Up incomplet.');
  const ids = new Set();
  const names = new Set();
  const matchIds = new Set();
  for (const t of payload.teams) {
    if (
      !t ||
      typeof t.id !== 'string' ||
      !/^\d+$/.test(t.id) ||
      !label(t.name) ||
      ids.has(t.id) ||
      names.has(t.name)
    )
      throw new Error('Équipes Ten’Up ambiguës.');
    ids.add(t.id);
    names.add(t.name);
  }
  payload.rounds.forEach((r, i) => {
    if (
      !r ||
      r.numero !== i + 1 ||
      !Array.isArray(r.matches) ||
      r.matches.length !== Math.floor(ids.size / 2)
    )
      throw new Error('Journées Ten’Up incomplètes.');
    const playing = new Set();
    for (const m of r.matches) {
      if (
        !m ||
        typeof m.url !== 'string' ||
        !m.url.startsWith(base) ||
        !/^\d+$/.test(m.url.slice(base.length)) ||
        matchIds.has(m.url) ||
        !ids.has(m.home_id) ||
        !ids.has(m.away_id) ||
        m.home_id === m.away_id ||
        playing.has(m.home_id) ||
        playing.has(m.away_id) ||
        typeof m.date !== 'string' ||
        !/^\d{4}-\d{2}-\d{2}$/.test(m.date) ||
        !Number.isFinite(Date.parse(m.date)) ||
        new Date(m.date).toISOString().slice(0, 10) !== m.date
      )
        throw new Error('Rencontre Ten’Up illisible.');
      matchIds.add(m.url);
      playing.add(m.home_id);
      playing.add(m.away_id);
    }
  });
  return payload;
}
export function teamCalendar(pool, teamId) {
  if (!pool.teams.some((t) => t.id === teamId))
    throw new Error('Sélectionnez une équipe Ten’Up.');
  return pool.rounds.map((r) => {
    const m = r.matches.find(
      (m) => m.home_id === teamId || m.away_id === teamId
    );
    return {
      numero: r.numero,
      exempt: !m,
      ...(m
        ? {
            date: m.date,
            domicile: m.home_id === teamId,
            adversaire: pool.teams.find(
              (t) => t.id === (m.home_id === teamId ? m.away_id : m.home_id)
            ).name,
            url: m.url,
          }
        : {}),
    };
  });
}
