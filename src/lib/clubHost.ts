// Même contrat dans le BO et la PWA. Aucun repli implicite sur CAC.
export function resolveClubSlug(hostname: string, surface: 'bo' | 'pwa', env: Record<string, unknown>): string | null {
  const host = hostname.toLowerCase().replace(/\.$/, '');
  const valid = (slug: string) => /^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(slug) &&
    !['admin', 'www', 'api', 'app'].includes(slug) && !slug.startsWith('app-');
  const match = /^([a-z0-9-]+)\.feelike\.pro$/.exec(host);
  if (match) {
    // Le BO central passe par AdminEntry ; aucun slug « admin ».
    if (surface !== 'pwa' || !match[1].startsWith('app-')) return null;
    const slug = match[1].slice(4);
    return valid(slug) ? slug : null;
  }
  const local = env.DEV === true && env.VITE_ENV !== 'production' &&
    ['localhost', '127.0.0.1', '[::1]'].includes(host);
  // Liste explicite d'alias techniques du projet (production et previews).
  const aliases = String(env.VITE_ALLOWED_HOSTS || '').split(',').map(h => h.trim().toLowerCase()).filter(Boolean);
  if (!local && !aliases.includes(host)) return null;
  const slug = String(env.VITE_DEV_CLUB_SLUG || '');
  return valid(slug) ? slug : null;
}
