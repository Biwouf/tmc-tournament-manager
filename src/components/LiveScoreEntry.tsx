import type { LiveMatch, LiveSet3Format } from '../types';
import {
  type NormalSet,
  type SuperTbSet,
  getSet,
  getSet3Normal,
  getSet3SuperTb,
  getNormalSetWinner,
  isNormalSetInTiebreak,
  canIncrementNormal,
  canDecrementNormal,
  incrementNormal,
  decrementNormal,
  getSuperTbWinner,
  canIncrementSuperTb,
  canDecrementSuperTb,
  incrementSuperTb,
  decrementSuperTb,
  setNormalIntoMatch,
  setSuperTbIntoMatch,
  isSet3Needed,
} from '../liveScoreRules';

interface Props {
  match: LiveMatch;
  onPatch: (patch: Partial<LiveMatch>) => void;
}

function PlusMinusCell({
  value,
  canInc,
  canDec,
  onInc,
  onDec,
}: {
  value: number;
  canInc: boolean;
  canDec: boolean;
  onInc: () => void;
  onDec: () => void;
}) {
  return (
    <div className="flex items-center gap-2">
      <button
        type="button"
        onClick={onDec}
        disabled={!canDec}
        className="h-10 w-10 rounded-lg border border-border bg-card text-lg font-semibold text-foreground transition hover:bg-muted disabled:opacity-30"
      >
        −
      </button>
      <div className="w-10 text-center font-mono text-2xl font-semibold tabular-nums">{value}</div>
      <button
        type="button"
        onClick={onInc}
        disabled={!canInc}
        className="h-10 w-10 rounded-lg border border-border bg-primary/10 text-lg font-semibold text-primary transition hover:bg-primary/20 disabled:opacity-30"
      >
        +
      </button>
    </div>
  );
}

function NormalSetRow({
  label,
  set,
  disabled,
  onChange,
}: {
  label: string;
  set: NormalSet;
  disabled: boolean;
  onChange: (s: NormalSet) => void;
}) {
  const inTb = isNormalSetInTiebreak(set);
  const winner = getNormalSetWinner(set);
  const showTb = inTb || ((set.j1 === 7 && set.j2 === 6) || (set.j2 === 7 && set.j1 === 6));

  const canInc = !disabled && canIncrementNormal(set);

  return (
    <div className="rounded-xl border border-border bg-background/60 p-4">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <h4 className="text-sm font-semibold">{label}</h4>
          {winner && (
            <span className="rounded-full bg-emerald-100 px-2 py-0.5 text-xs font-medium text-emerald-700">
              Set gagné par {winner === 'j1' ? 'Équipe 1' : 'Équipe 2'}
            </span>
          )}
        </div>
      </div>
      <div className="mt-3 grid grid-cols-2 gap-4">
        <PlusMinusCell
          value={set.j1}
          canInc={canInc}
          canDec={!disabled && canDecrementNormal(set, 'j1')}
          onInc={() => onChange(incrementNormal(set, 'j1'))}
          onDec={() => onChange(decrementNormal(set, 'j1'))}
        />
        <PlusMinusCell
          value={set.j2}
          canInc={canInc}
          canDec={!disabled && canDecrementNormal(set, 'j2')}
          onInc={() => onChange(incrementNormal(set, 'j2'))}
          onDec={() => onChange(decrementNormal(set, 'j2'))}
        />
      </div>
      {showTb && set.tb_j1 !== null && set.tb_j2 !== null && (
        <div className="mt-4 border-t border-border pt-3">
          <p className="mb-2 text-xs font-medium text-muted-foreground">Tiebreak</p>
          <div className="grid grid-cols-2 gap-4">
            <div className="flex items-center gap-2">
              <div className="w-10 text-center font-mono text-lg tabular-nums">{set.tb_j1}</div>
            </div>
            <div className="flex items-center gap-2">
              <div className="w-10 text-center font-mono text-lg tabular-nums">{set.tb_j2}</div>
            </div>
          </div>
          <p className="mt-2 text-xs text-muted-foreground">
            Les boutons +/- ci-dessus pilotent le tiebreak tant que le set est à 6/6.
          </p>
        </div>
      )}
    </div>
  );
}

function SuperTbRow({
  set,
  disabled,
  onChange,
}: {
  set: SuperTbSet;
  disabled: boolean;
  onChange: (s: SuperTbSet) => void;
}) {
  const canInc = !disabled && canIncrementSuperTb(set);
  const winner = getSuperTbWinner(set);
  return (
    <div className="rounded-xl border border-border bg-background/60 p-4">
      <div className="flex items-center gap-3">
        <h4 className="text-sm font-semibold">Set 3 — Super Tiebreak</h4>
        {winner && (
          <span className="rounded-full bg-emerald-100 px-2 py-0.5 text-xs font-medium text-emerald-700">
            Super TB gagné par {winner === 'j1' ? 'Équipe 1' : 'Équipe 2'}
          </span>
        )}
      </div>
      <div className="mt-3 grid grid-cols-2 gap-4">
        <PlusMinusCell
          value={set.j1}
          canInc={canInc}
          canDec={!disabled && canDecrementSuperTb(set, 'j1')}
          onInc={() => onChange(incrementSuperTb(set, 'j1'))}
          onDec={() => onChange(decrementSuperTb(set, 'j1'))}
        />
        <PlusMinusCell
          value={set.j2}
          canInc={canInc}
          canDec={!disabled && canDecrementSuperTb(set, 'j2')}
          onInc={() => onChange(incrementSuperTb(set, 'j2'))}
          onDec={() => onChange(decrementSuperTb(set, 'j2'))}
        />
      </div>
    </div>
  );
}

export default function LiveScoreEntry({ match, onPatch }: Props) {
  const readonly = match.status !== 'live';

  const set1 = getSet(match, 1);
  const set2 = getSet(match, 2);
  const set1Won = getNormalSetWinner(set1) !== null;
  const set3Needed = isSet3Needed(match);

  const handleSetNormal = (n: 1 | 2 | 3) => (s: NormalSet) => {
    onPatch(setNormalIntoMatch(n, s));
  };

  const handleSuperTb = (s: SuperTbSet) => {
    onPatch(setSuperTbIntoMatch(s));
  };

  const handlePickSet3Format = (format: LiveSet3Format) => {
    const patch: Partial<LiveMatch> = { set3_format: format };
    if (format === 'super_tiebreak') {
      patch.set3_tb_j1 = null;
      patch.set3_tb_j2 = null;
    }
    onPatch(patch);
  };

  // Column headers (team labels)
  const team1Label = match.match_type === 'double' ? 'Équipe 1' : `${match.j1_prenom} ${match.j1_nom}`;
  const team2Label = match.match_type === 'double' ? 'Équipe 2' : `${match.j2_prenom} ${match.j2_nom}`;

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-[auto_1fr_1fr] items-center gap-4 px-4 text-sm font-semibold text-muted-foreground">
        <span />
        <span className="text-center">{team1Label}</span>
        <span className="text-center">{team2Label}</span>
      </div>

      <NormalSetRow label="Set 1" set={set1} disabled={readonly} onChange={handleSetNormal(1)} />
      <NormalSetRow
        label="Set 2"
        set={set2}
        disabled={readonly || !set1Won}
        onChange={handleSetNormal(2)}
      />

      {set3Needed && match.set3_format === null && !readonly && (
        <div className="rounded-xl border border-amber-300 bg-amber-50 p-4">
          <p className="mb-3 text-sm font-medium text-amber-900">
            Un set décisif est nécessaire — choisir le format :
          </p>
          <div className="flex gap-3">
            <button
              type="button"
              onClick={() => handlePickSet3Format('normal')}
              className="rounded-lg border border-border bg-card px-4 py-2 text-sm font-medium transition hover:bg-muted"
            >
              Set normal
            </button>
            <button
              type="button"
              onClick={() => handlePickSet3Format('super_tiebreak')}
              className="rounded-lg border border-border bg-card px-4 py-2 text-sm font-medium transition hover:bg-muted"
            >
              Super tiebreak
            </button>
          </div>
        </div>
      )}

      {set3Needed && match.set3_format === 'normal' && (
        <NormalSetRow
          label="Set 3"
          set={getSet3Normal(match)}
          disabled={readonly}
          onChange={handleSetNormal(3)}
        />
      )}
      {set3Needed && match.set3_format === 'super_tiebreak' && (
        <SuperTbRow set={getSet3SuperTb(match)} disabled={readonly} onChange={handleSuperTb} />
      )}
    </div>
  );
}
