import { TEAM_MATCH_TYPES, type TeamMatch, type TeamMatchGender, type TeamMatchType } from '../../types';
import Segmented from './Segmented';
import NumberPicker from './NumberPicker';

const GENDERS: ReadonlyArray<TeamMatchGender> = ['Masculin', 'Féminin'];

const LOCATIONS = [
  { value: 'home' as const, label: 'Au club', icon: '🏠' },
  { value: 'away' as const, label: "Chez l'adversaire", icon: '✈' },
];

interface MatchRowProps {
  match: TeamMatch;
  index: number;
  total: number;
  onChange: (m: TeamMatch) => void;
  onRemove: () => void;
  onMove: (from: number, to: number) => void;
}

function fieldLabelClass() {
  return 'mb-1.5 block text-[11px] font-semibold uppercase tracking-wide text-muted-foreground';
}

function iconBtnClass(disabled: boolean) {
  return (
    'inline-flex h-7 w-7 items-center justify-center rounded-md border border-border bg-card text-sm transition ' +
    (disabled ? 'cursor-not-allowed text-muted-foreground/40' : 'text-muted-foreground hover:bg-muted hover:text-foreground')
  );
}

export default function MatchRow({ match, index, total, onChange, onRemove, onMove }: MatchRowProps) {
  const set = (patch: Partial<TeamMatch>) => onChange({ ...match, ...patch });
  const incomplete = !match.opponent.trim() || !match.date || !match.time;

  return (
    <div className="relative rounded-2xl border border-border bg-card p-4 shadow-sm">
      {/* Header */}
      <div className="mb-3 flex items-center justify-between gap-3">
        <div className="flex min-w-0 items-center gap-2.5">
          <span className="inline-flex h-6 w-6 shrink-0 items-center justify-center rounded-md bg-primary/10 text-xs font-bold text-primary">
            {index + 1}
          </span>
          <span className="truncate text-sm font-semibold text-foreground">
            {match.gender} {match.matchType} · Équipe {match.teamNumber}
          </span>
          {incomplete && (
            <span className="shrink-0 rounded-full bg-amber-100 px-2 py-0.5 text-[10px] font-semibold tracking-wide text-amber-700">
              À compléter
            </span>
          )}
        </div>
        <div className="flex shrink-0 gap-1">
          <button
            type="button"
            onClick={() => onMove(index, index - 1)}
            disabled={index === 0}
            title="Monter"
            className={iconBtnClass(index === 0)}
          >
            ↑
          </button>
          <button
            type="button"
            onClick={() => onMove(index, index + 1)}
            disabled={index === total - 1}
            title="Descendre"
            className={iconBtnClass(index === total - 1)}
          >
            ↓
          </button>
          <button
            type="button"
            onClick={onRemove}
            title="Supprimer"
            className="inline-flex h-7 w-7 items-center justify-center rounded-md border border-border bg-card text-sm text-primary transition hover:bg-primary/10"
          >
            ✕
          </button>
        </div>
      </div>

      {/* Grid */}
      <div className="grid grid-cols-12 gap-3.5">
        <div className="col-span-12 md:col-span-4">
          <label className={fieldLabelClass()}>Genre</label>
          <Segmented<TeamMatchGender>
            value={match.gender}
            onChange={(v) => set({ gender: v })}
            options={GENDERS}
          />
        </div>

        <div className="col-span-12 md:col-span-5">
          <label className={fieldLabelClass()}>Catégorie</label>
          <select
            value={match.matchType}
            onChange={(e) => set({ matchType: e.target.value as TeamMatchType })}
            className="block w-full rounded-lg border border-border bg-card px-3 py-2 text-sm"
          >
            {TEAM_MATCH_TYPES.map((t) => (
              <option key={t} value={t}>{t}</option>
            ))}
          </select>
        </div>

        <div className="col-span-12 md:col-span-3">
          <label className={fieldLabelClass()}>Équipe</label>
          <NumberPicker value={match.teamNumber} onChange={(v) => set({ teamNumber: v })} />
        </div>

        <div className="col-span-12 md:col-span-7">
          <label className={fieldLabelClass()}>Club adverse</label>
          <input
            type="text"
            value={match.opponent}
            onChange={(e) => set({ opponent: e.target.value })}
            placeholder="Ex. VALENCE D'AGEN TC"
            className="block w-full rounded-lg border border-border bg-card px-3 py-2 text-sm"
          />
        </div>

        <div className="col-span-12 md:col-span-5">
          <label className={fieldLabelClass()}>Lieu</label>
          <Segmented<'home' | 'away'>
            value={match.location}
            onChange={(v) => set({ location: v })}
            options={LOCATIONS}
          />
        </div>

        <div className="col-span-12 md:col-span-7">
          <label className={fieldLabelClass()}>Date</label>
          <input
            type="date"
            value={match.date}
            onChange={(e) => set({ date: e.target.value })}
            className="block w-full rounded-lg border border-border bg-card px-3 py-2 text-sm"
          />
        </div>

        <div className="col-span-12 md:col-span-5">
          <label className={fieldLabelClass()}>Heure</label>
          <input
            type="time"
            value={match.time}
            onChange={(e) => set({ time: e.target.value })}
            className="block w-full rounded-lg border border-border bg-card px-3 py-2 text-sm"
          />
        </div>
      </div>
    </div>
  );
}
