import { normalizeTenupPoolUrl } from './tenupPool.mjs';

/** Canonical link of a club's team encounters page on Ten'Up. */
export function normalizeTenupClubUrl(value) {
  if (typeof value !== 'string' || value.length > 500) throw new Error('Lien du club Ten’Up invalide.');
  let url;
  try { url = new URL(value.trim()); } catch { throw new Error('Lien du club Ten’Up invalide.'); }
  const match = /^\/club\/(\d+)(?:\/competitions(?:\/rencontres)?)?\/?$/.exec(url.pathname);
  if (url.origin !== 'https://tenup.fft.fr' || url.username || url.password || !match) {
    throw new Error('Copiez le lien Ten’Up de votre club : Espace club › Les équipes de mon club.');
  }
  return `https://tenup.fft.fr/club/${match[1]}/competitions/rencontres`;
}

export function isTenupClubUrl(value) {
  try { normalizeTenupClubUrl(value); return true; } catch { return false; }
}

/** Reject anything but the expected shape, from the worker or the browser. */
export function validateTenupClub(payload) {
  const label = (x, max = 160) => typeof x === 'string' && x.trim() !== '' && x.length <= max;
  if (!payload || !label(payload.club) || !Array.isArray(payload.teams) || payload.teams.length > 100 ||
      !Number.isInteger(payload.skipped) || payload.skipped < 0) throw new Error('Page du club Ten’Up illisible.');
  const seen = new Set();
  for (const t of payload.teams) {
    if (!t || !label(t.team) || !label(t.competition) || ![t.level, t.category, t.genre].every((x) => typeof x === 'string' && x.length <= 60) ||
        !Array.isArray(t.dates) || !t.dates.length || t.dates.length > 60 || !t.dates.every((d) => label(d, 60))) {
      throw new Error('Page du club Ten’Up illisible.');
    }
    if (normalizeTenupPoolUrl(t.pool_url) !== t.pool_url) throw new Error('Page du club Ten’Up illisible.');
    const key = `${t.pool_url}|${t.team}`;
    if (seen.has(key)) throw new Error('Page du club Ten’Up illisible.');
    seen.add(key);
  }
  return payload;
}
