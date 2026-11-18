/**
 * Date calendaire `YYYY-MM-DD` → « 20 août 2026 ».
 * Lue en date LOCALE : `new Date('2026-08-20')` serait minuit UTC, donc la veille à l'ouest de
 * Greenwich. Une valeur illisible est rendue telle quelle.
 */
export function formatIsoDateFr(value: string): string {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!match) return value;
  const date = new Date(Number(match[1]), Number(match[2]) - 1, Number(match[3]));
  return date.toLocaleDateString('fr-FR', { day: 'numeric', month: 'short', year: 'numeric' });
}
