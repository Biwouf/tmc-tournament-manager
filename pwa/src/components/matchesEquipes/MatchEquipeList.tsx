import type { TeamCompetition, TeamEquipe, TeamEtape, TeamRencontre } from '../../types';
import MatchEquipeCell from './MatchEquipeCell';
import { competitionShortLabel, formatCategorie } from './labels';

export interface EnrichedRencontre {
  rencontre: TeamRencontre;
  etape: TeamEtape;
  equipe: TeamEquipe;
  comp: TeamCompetition;
  isLive: boolean;
  isPending?: boolean;
}

interface Props {
  items: EnrichedRencontre[];
  state: 'upcoming' | 'past';
}

interface CompGroup { comp: TeamCompetition; items: EnrichedRencontre[] }
interface DayGroup { key: string; date: Date; count: number; comps: CompGroup[] }

// Nom complet, jamais tronqué. Genre + catégorie ajoutés seulement si le nom ne porte pas
// déjà la catégorie (« Challenge d'hiver – Seniors messieurs » se suffit).
function competitionLabel(comp: TeamCompetition): string {
  const plain = (v: string) => v.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
  return plain(comp.nom).includes(plain(formatCategorie(comp.categorie)))
    ? comp.nom
    : `${comp.nom} · ${competitionShortLabel(comp)}`;
}

const time = (x: EnrichedRencontre) => +new Date(x.rencontre.date_heure);

function dayKey(d: Date): string {
  return `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`;
}

function dayLabel(d: Date): string {
  const label = d.toLocaleDateString('fr-FR', {
    weekday: 'long',
    day: 'numeric',
    month: 'long',
    ...(d.getFullYear() !== new Date().getFullYear() ? { year: 'numeric' } : {}),
  });
  return label.charAt(0).toUpperCase() + label.slice(1);
}

// Jours dans l'ordre de l'onglet (à venir : croissant, passés : décroissant) ; dans un jour,
// une section par compétition, rencontres par heure croissante puis numéro d'équipe.
function groupByDay(items: EnrichedRencontre[], state: Props['state']): DayGroup[] {
  const sorted = [...items].sort((a, b) => time(a) - time(b) || a.equipe.numero - b.equipe.numero);
  const days = new Map<string, DayGroup>();
  for (const x of sorted) {
    const date = new Date(x.rencontre.date_heure);
    const key = dayKey(date);
    let day = days.get(key);
    if (!day) days.set(key, (day = { key, date, count: 0, comps: [] }));
    let group = day.comps.find((c) => c.comp.id === x.comp.id);
    if (!group) day.comps.push((group = { comp: x.comp, items: [] }));
    group.items.push(x);
    day.count += 1;
  }
  const list = [...days.values()];
  return state === 'past' ? list.reverse() : list;
}

export default function MatchEquipeList({ items, state }: Props) {
  if (items.length === 0) {
    return (
      <p className="me-empty">
        {state === 'upcoming' ? 'Aucune rencontre à venir ou en cours.' : 'Aucune rencontre passée.'}
      </p>
    );
  }

  return (
    <div className="me-list">
      {groupByDay(items, state).map((day) => (
        <section key={day.key} className="me-day" aria-label={dayLabel(day.date)}>
          <h2 className="me-day-head">
            {dayLabel(day.date)}
            <span className="n">{day.count} rencontre{day.count > 1 ? 's' : ''}</span>
          </h2>
          {day.comps.map(({ comp, items: rows }) => (
            <CompSection key={comp.id} comp={comp} rows={rows} state={state} />
          ))}
        </section>
      ))}
    </div>
  );
}

function CompSection({ comp, rows, state }: { comp: TeamCompetition; rows: EnrichedRencontre[]; state: Props['state'] }) {
  return (
    <>
      <h3 className="me-comp">{competitionLabel(comp)}</h3>
      <ul className="me-group">
        {rows.map(({ rencontre, etape, equipe, isLive, isPending }) => (
          <li key={rencontre.id}>
            <MatchEquipeCell
              rencontre={rencontre}
              equipe={equipe}
              etape={etape}
              state={state}
              isLive={isLive}
              isPending={isPending}
            />
          </li>
        ))}
      </ul>
    </>
  );
}

/** Squelette calqué sur la liste réelle (jour, compétition, lignes). */
export function MatchEquipeListSkeleton() {
  return (
    <div className="me-list" role="status" aria-label="Chargement des rencontres">
      <section className="me-day">
        <div className="me-day-head"><span className="me-sk block h-[18px] w-44" /></div>
        <div className="me-comp"><span className="me-sk block h-3 w-56" /></div>
        <ul className="me-group">
          {[0, 1, 2].map((i) => (
            <li key={i}>
              <div className="me-row" aria-hidden="true">
                <span className="me-sk block h-9 w-9 !rounded-full" />
                <span className="me-mid">
                  <span className="me-sk block h-4 w-4/5" />
                  <span className="me-sk mt-2 block h-3 w-24" />
                </span>
                <span />
                <span />
              </div>
            </li>
          ))}
        </ul>
      </section>
    </div>
  );
}
