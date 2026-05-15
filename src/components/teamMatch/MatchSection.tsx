import type { TeamMatch } from '../../types';
import MatchRow from './MatchRow';

export const MAX_TEAM_MATCHES = 8;

export function makeTeamMatch(): TeamMatch {
  return {
    id: crypto.randomUUID(),
    gender: 'Masculin',
    matchType: 'Seniors',
    teamNumber: 1,
    opponent: '',
    location: 'home',
    date: '',
    time: '',
  };
}

interface MatchSectionProps {
  matches: TeamMatch[];
  onChange: (next: TeamMatch[]) => void;
}

export default function MatchSection({ matches, onChange }: MatchSectionProps) {
  const update = (idx: number, m: TeamMatch) => {
    const next = matches.slice();
    next[idx] = m;
    onChange(next);
  };
  const remove = (idx: number) => {
    onChange(matches.filter((_, i) => i !== idx));
  };
  const add = () => {
    if (matches.length >= MAX_TEAM_MATCHES) return;
    onChange([...matches, makeTeamMatch()]);
  };
  const move = (from: number, to: number) => {
    if (to < 0 || to >= matches.length) return;
    const next = matches.slice();
    const [it] = next.splice(from, 1);
    next.splice(to, 0, it);
    onChange(next);
  };

  const full = matches.length >= MAX_TEAM_MATCHES;

  return (
    <section className="rounded-2xl border border-primary/20 bg-primary/5 p-4">
      <div className="mb-3 flex items-start justify-between gap-3">
        <div className="min-w-0">
          <h3 className="text-base font-semibold text-foreground">Matchs par équipe</h3>
          <p className="mt-0.5 text-xs text-muted-foreground">
            Chaque match alimente une cellule de l'affiche. Ordre d'affichage = ordre de saisie.
          </p>
        </div>
        <span className="shrink-0 rounded-full bg-card px-2.5 py-0.5 text-xs font-bold text-foreground shadow-sm">
          {matches.length} / {MAX_TEAM_MATCHES}
        </span>
      </div>

      <div className="flex flex-col gap-3">
        {matches.map((m, i) => (
          <MatchRow
            key={m.id}
            match={m}
            index={i}
            total={matches.length}
            onChange={(nm) => update(i, nm)}
            onRemove={() => remove(i)}
            onMove={move}
          />
        ))}
      </div>

      <button
        type="button"
        onClick={add}
        disabled={full}
        className={
          'mt-3 w-full rounded-xl border-[1.5px] border-dashed px-3 py-2.5 text-sm font-semibold transition ' +
          (full
            ? 'cursor-not-allowed border-primary/20 text-primary/40'
            : 'border-primary/40 text-primary hover:border-primary hover:bg-card')
        }
      >
        + Ajouter un match
      </button>
    </section>
  );
}
