/** Copie BO/PWA : sept jours depuis la fin effective, pas depuis la date du match. */
export function liveMatchVisibilityFilter(now = new Date()): string {
  const cutoff = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000).toISOString();
  // Sans date de fin, conserver le match : sa date de match n'est pas une preuve de fin.
  return `status.neq.finished,finished_at.is.null,finished_at.gte.${cutoff}`;
}
