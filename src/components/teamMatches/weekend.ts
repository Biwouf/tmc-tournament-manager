/**
 * Bornes de week-end du module Matches par équipe.
 *
 * Définition UNIQUE, partagée par le compteur d'en-tête, la vue Agenda et la
 * présélection de l'affiche : trois définitions divergentes = trois bugs.
 *
 * Un week-end court du **vendredi 18:00 au dimanche 23:59:59.999**, en heure
 * locale — `team_rencontres.date_heure` est un TIMESTAMPTZ que `new Date(iso)`
 * ramène en local, comme le fait déjà le reste du module.
 */

export interface WeekendRange {
  start: Date;
  end: Date;
}

const DAY_MS = 24 * 60 * 60 * 1000;

/** Vendredi 18:00 de la semaine contenant `d` (lundi = début de semaine). */
function fridayEvening(d: Date): Date {
  // getDay() : 0 = dimanche … 6 = samedi. On ramène à un index lundi = 0.
  const mondayIndex = (d.getDay() + 6) % 7;
  const friday = new Date(d.getFullYear(), d.getMonth(), d.getDate() - mondayIndex + 4);
  friday.setHours(18, 0, 0, 0);
  return friday;
}

function rangeFromFriday(friday: Date): WeekendRange {
  // Dimanche = vendredi + 2 jours. Calcul par timestamp puis normalisation :
  // traverse proprement les changements d'heure d'été.
  const sunday = new Date(friday.getTime() + 2 * DAY_MS);
  sunday.setHours(23, 59, 59, 999);
  return { start: friday, end: sunday };
}

/** Week-end courant : celui de la semaine en cours (le vendredi soir en fait partie). */
export function currentWeekendRange(now: Date = new Date()): WeekendRange {
  return rangeFromFriday(fridayEvening(now));
}

/**
 * Décale `now` de `weeks` semaines en jours **calendaires**.
 * Un décalage de `7 * DAY_MS` ferait dériver l'heure d'une heure au passage
 * à l'heure d'été (vendredi 18:00 → 19:00).
 */
function shiftWeeks(now: Date, weeks: number): Date {
  return new Date(now.getFullYear(), now.getMonth(), now.getDate() + weeks * 7);
}

/** Week-end suivant celui retourné par `currentWeekendRange`. */
export function nextWeekendRange(now: Date = new Date()): WeekendRange {
  return rangeFromFriday(fridayEvening(shiftWeeks(now, 1)));
}

/** Dernier week-end écoulé — celui qui précède le week-end courant. */
export function lastWeekendRange(now: Date = new Date()): WeekendRange {
  return rangeFromFriday(fridayEvening(shiftWeeks(now, -1)));
}

/** `iso` tombe-t-il dans les bornes ? */
export function isInRange(iso: string, range: WeekendRange): boolean {
  const t = new Date(iso).getTime();
  return t >= range.start.getTime() && t <= range.end.getTime();
}

/** ex. « 21 – 22 mars » (ou « 30 mars – 1 avril » à cheval sur deux mois). */
export function formatWeekendLabel(range: WeekendRange): string {
  // Le samedi est le premier jour « visible » du week-end.
  const saturday = new Date(range.start.getTime() + DAY_MS);
  const sunday = range.end;
  const sameMonth = saturday.getMonth() === sunday.getMonth();
  const month = (d: Date) => d.toLocaleDateString('fr-FR', { month: 'long' });
  return sameMonth
    ? `${saturday.getDate()} – ${sunday.getDate()} ${month(sunday)}`
    : `${saturday.getDate()} ${month(saturday)} – ${sunday.getDate()} ${month(sunday)}`;
}

/** Samedi du week-end, au format YYYY-MM-DD local — nom de fichier de l'affiche. */
export function weekendFileDate(range: WeekendRange): string {
  const saturday = new Date(range.start.getTime() + DAY_MS);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${saturday.getFullYear()}-${pad(saturday.getMonth() + 1)}-${pad(saturday.getDate())}`;
}
