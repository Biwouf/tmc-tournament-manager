import type { CellState, RencontreEntry } from './gridTypes';
import { CELL_CLASSES } from './gridTypes';
import { formatCategorie, etapeLabelCourt } from './teamMatchLabels';
import {
  currentWeekendRange,
  formatWeekLabel,
  formatWeekendLabel,
  isInRange,
  lastWeekendRange,
  weekRange,
} from './weekend';

interface Section {
  key: string;
  title: string;
  hint: string;
  accent: boolean;
  entries: RencontreEntry[];
}

/** Pastille date à gauche de la ligne. */
function DatePill({ iso }: { iso: string }) {
  const d = new Date(iso);
  const jour = d.toLocaleDateString('fr-FR', { weekday: 'short', day: 'numeric' });
  const pad = (n: number) => String(n).padStart(2, '0');
  return (
    <div className="w-[70px] shrink-0 rounded-lg bg-score-next px-2 py-1.5 text-center">
      <p className="text-[10px] font-semibold uppercase leading-tight text-score-next-fg">{jour}</p>
      <p className="tabular text-sm font-bold leading-tight">
        {d.getHours()}h{pad(d.getMinutes())}
      </p>
    </div>
  );
}

function tagOf(entry: RencontreEntry): { label: string; state: CellState } {
  const { rencontre, state } = entry;
  if (state === 'todo') return { label: 'Saisir', state };
  if (state === 'wo') return { label: 'WO', state };
  if (rencontre.score_club !== null && rencontre.score_adverse !== null) {
    return { label: `${rencontre.score_club}–${rencontre.score_adverse}`, state };
  }
  return { label: 'À venir', state };
}

function Row({
  entry,
  selected,
  onSelect,
}: {
  entry: RencontreEntry;
  selected: boolean;
  onSelect: () => void;
}) {
  const { rencontre, etape, equipe, competition } = entry;
  const tag = tagOf(entry);
  const chain = `${competition.nom} · ${formatCategorie(competition.categorie)} · Éq. ${equipe.numero} · ${etapeLabelCourt(etape)}`;

  return (
    <button
      type="button"
      onClick={onSelect}
      className={`flex w-full items-center gap-3 rounded-xl border px-3 py-2.5 text-left transition hover:bg-muted/50 ${
        selected ? 'border-foreground shadow-[0_0_0_2px_rgba(46,32,35,.12)]' : 'border-border'
      }`}
    >
      <DatePill iso={rencontre.date_heure} />
      <div className="min-w-0 flex-1">
        <p className="truncate text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
          {chain}
        </p>
        <p className="truncate text-[15px] font-bold">{rencontre.club_adverse}</p>
      </div>
      <span className="shrink-0 text-[11px] text-muted-foreground">
        {rencontre.domicile ? 'Au club' : 'Déplacement'}
      </span>
      <span
        className={`tabular shrink-0 rounded-full px-2.5 py-1 text-[11px] font-bold ${CELL_CLASSES[tag.state]}`}
      >
        {tag.label}
      </span>
    </button>
  );
}

export default function AgendaView({
  entries,
  selectedEtapeId,
  onSelect,
}: {
  entries: RencontreEntry[];
  selectedEtapeId: string | null;
  onSelect: (etapeId: string) => void;
}) {
  const now = new Date();
  const courant = currentWeekendRange(now);
  const dernier = lastWeekendRange(now);
  const thisWeek = weekRange(now);

  // Toutes les rencontres à venir hors week-end courant, une section par semaine (lundi →
  // dimanche) : les rencontres de semaine (11 novembre…) comptent autant que celles du week-end.
  const weeks = new Map<number, Section>();
  for (const e of entries) {
    const d = new Date(e.rencontre.date_heure);
    if (e.state === 'todo' || d < now || isInRange(e.rencontre.date_heure, courant)) continue;
    const range = weekRange(d);
    const key = range.start.getTime();
    let section = weeks.get(key);
    if (!section) {
      section = {
        key: `semaine-${key}`,
        title: key === thisWeek.start.getTime() ? 'Cette semaine' : `À venir · ${formatWeekLabel(range)}`,
        hint: '',
        accent: false,
        entries: [],
      };
      weeks.set(key, section);
    }
    section.entries.push(e);
  }
  const upcoming = [...weeks.entries()].sort(([a], [b]) => a - b).map(([, s]) => s);
  // La semaine en cours (rencontres avant vendredi soir) précède « Ce week-end ».
  const cetteSemaine = upcoming[0]?.title === 'Cette semaine' ? upcoming.splice(0, 1) : [];

  const sections: Section[] = [
    {
      key: 'todo',
      title: 'À saisir',
      hint: 'rencontres jouées sans score',
      accent: true,
      entries: entries.filter((e) => e.state === 'todo'),
    },
    ...cetteSemaine,
    {
      key: 'courant',
      title: `Ce week-end · ${formatWeekendLabel(courant)}`,
      hint: '',
      accent: false,
      entries: entries.filter(
        (e) => e.state !== 'todo' && isInRange(e.rencontre.date_heure, courant)
      ),
    },
    ...upcoming,
    {
      key: 'dernier',
      title: `Déjà jouées · ${formatWeekendLabel(dernier)}`,
      hint: '',
      accent: false,
      entries: entries.filter(
        (e) => e.state !== 'todo' && isInRange(e.rencontre.date_heure, dernier)
      ),
    },
  ].filter((s) => s.entries.length > 0);

  if (sections.length === 0) {
    return (
      <div className="rounded-[13px] border border-dashed border-border bg-card/50 p-12 text-center text-muted-foreground">
        Rien à l'agenda : aucun score à saisir, aucune rencontre à venir ni jouée le week-end
        dernier.
      </div>
    );
  }

  return (
    <div className="space-y-7">
      {sections.map((section) => (
        <section key={section.key}>
          <div className="mb-2.5 flex items-baseline gap-2">
            <h2
              className={`text-xs font-semibold uppercase tracking-[0.08em] ${
                section.accent ? 'text-primary' : 'text-muted-foreground'
              }`}
            >
              {section.title}
            </h2>
            <span className="tabular rounded-full bg-muted px-2 py-0.5 text-[10px] font-bold">
              {section.entries.length}
            </span>
            {section.hint && (
              <span className="text-[11px] text-muted-foreground">{section.hint}</span>
            )}
          </div>
          <div className="space-y-1.5">
            {section.entries.map((entry) => (
              <Row
                key={entry.rencontre.id}
                entry={entry}
                selected={entry.etape.id === selectedEtapeId}
                onSelect={() => onSelect(entry.etape.id)}
              />
            ))}
          </div>
        </section>
      ))}
    </div>
  );
}
