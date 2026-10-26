/**
 * Calendrier des rencontres par équipe à venir — grille date × équipe exportée en PNG
 * par le BO (`TeamMatchesPage`) et la PWA (`MatchesEquipesPage`).
 *
 * Styles inline uniquement : le nœud est rasterisé par html-to-image hors écran, il ne doit
 * dépendre ni du thème ni de la feuille de style de l'app qui le monte.
 */

export interface CalendarColumn {
  key: string;
  /** ex. « Gan » */
  title: string;
  /** ex. « Hommes +35 ans · Éq. 1 » */
  subtitle: string;
  /** Ordre des colonnes (comparaison de chaînes). */
  sortKey: string;
}

export interface CalendarRencontre {
  id: string;
  date_heure: string;
  club_adverse: string;
  domicile: boolean;
  wo: boolean;
  column: CalendarColumn;
}

interface CalendarCell {
  id: string;
  adversaire: string;
  domicile: boolean;
  heure: string | null;
}

interface CalendarRow {
  dayKey: string;
  date: Date;
  cells: Map<string, CalendarCell[]>;
}

export interface TeamCalendar {
  columns: CalendarColumn[];
  /** Mois (« novembre 2026 ») → jours qui portent au moins une rencontre. */
  months: { label: string; rows: CalendarRow[] }[];
  count: number;
}

const pad = (n: number) => String(n).padStart(2, '0');

function heureLabel(d: Date): string | null {
  // Minuit = heure non renseignée à la création de la rencontre.
  if (d.getHours() === 0 && d.getMinutes() === 0) return null;
  return d.getMinutes() === 0 ? `${d.getHours()}h` : `${d.getHours()}h${pad(d.getMinutes())}`;
}

/** Rencontres du jour et à venir (heure locale), hors WO, regroupées par mois puis par jour. */
export function buildTeamCalendar(items: CalendarRencontre[], now: Date = new Date()): TeamCalendar {
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const upcoming = items
    .filter((r) => !r.wo && new Date(r.date_heure) >= today)
    .sort((a, b) => a.date_heure.localeCompare(b.date_heure));

  const columns = new Map<string, CalendarColumn>();
  const rows = new Map<string, CalendarRow>();
  for (const r of upcoming) {
    columns.set(r.column.key, r.column);
    const d = new Date(r.date_heure);
    const dayKey = `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
    let row = rows.get(dayKey);
    if (!row) {
      row = { dayKey, date: new Date(d.getFullYear(), d.getMonth(), d.getDate()), cells: new Map() };
      rows.set(dayKey, row);
    }
    const cell = { id: r.id, adversaire: r.club_adverse, domicile: r.domicile, heure: heureLabel(d) };
    row.cells.set(r.column.key, [...(row.cells.get(r.column.key) ?? []), cell]);
  }

  const months: TeamCalendar['months'] = [];
  for (const row of rows.values()) {
    const label = row.date.toLocaleDateString('fr-FR', { month: 'long', year: 'numeric' });
    const last = months[months.length - 1];
    if (last?.label === label) last.rows.push(row);
    else months.push({ label, rows: [row] });
  }

  return {
    columns: [...columns.values()].sort((a, b) => a.sortKey.localeCompare(b.sortKey)),
    months,
    count: upcoming.length,
  };
}
