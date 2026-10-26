// Adresses de club (D9) : une seule liste de slugs réservés pour le BO, la PWA, la vitrine,
// les e-mails d'auth et l'inscription self-serve. La base en garde deux copies, vérifiées
// contre celle-ci par tests/club-signup-sql.test.mjs : le CHECK `clubs_slug_format`
// (2026081802) et `club_slug_problem()` (2026102601).

/** Sous-domaines de la plateforme (`admin.feelike.pro` = le BO central…). */
export const RESERVED_SLUGS = Object.freeze(['admin', 'app', 'www', 'api', 'mail', 'static', 'assets', 'feelike']);

/** `app-<slug>.feelike.pro` est la PWA du club `<slug>` : un club `app-x` la masquerait. */
export function isReservedSlug(slug) {
  return RESERVED_SLUGS.includes(slug) || slug.startsWith('app-');
}

/** Format d'un slug choisi en self-serve : 3 à 32 caractères, sans tiret au bord. */
export const SIGNUP_SLUG_PATTERN = /^[a-z0-9]([a-z0-9-]{1,30}[a-z0-9])$/;

/** Raison du refus d'un slug choisi en self-serve, ou `null` (l'unicité se vérifie en base). */
export function signupSlugProblem(slug) {
  if (typeof slug !== 'string' || !SIGNUP_SLUG_PATTERN.test(slug)) return 'format';
  return isReservedSlug(slug) ? 'reserved' : null;
}
