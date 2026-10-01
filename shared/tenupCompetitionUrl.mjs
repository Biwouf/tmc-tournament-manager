/** Canonical public championship link. Query filters identify a division/phase/pool. */
export function normalizeTenupCompetitionUrl(value) {
  if (typeof value !== 'string' || value.length > 500) throw new Error('Lien de championnat Ten’Up invalide.');
  let url;
  try { url = new URL(value.trim()); } catch { throw new Error('Lien de championnat Ten’Up invalide.'); }
  if (url.origin !== 'https://tenup.fft.fr' || url.username || url.password || url.hash ||
      !/^\/championnat\/[0-9]+\/?$/.test(url.pathname)) throw new Error('Lien de championnat Ten’Up invalide.');
  const keys = ['division', 'phase', 'poule'];
  if ([...url.searchParams.keys()].some(key => !keys.includes(key)) ||
      keys.some(key => url.searchParams.getAll(key).length > 1)) throw new Error('Lien de championnat Ten’Up invalide.');
  const present = keys.filter(key => url.searchParams.has(key));
  if (present.length && (present.length !== 3 || keys.some(key => !/^[0-9]+$/.test(url.searchParams.get(key))))) {
    throw new Error('Le lien Ten’Up doit contenir une division, une phase et une poule valides.');
  }
  const base = `https://tenup.fft.fr${url.pathname.replace(/\/$/, '')}`;
  return present.length ? `${base}?${keys.map(key => `${key}=${url.searchParams.get(key)}`).join('&')}` : base;
}
