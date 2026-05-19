import type { LiveMatch, LiveMatchWinner } from '../types';

interface Props {
  match: LiveMatch;
  onPrimary: () => void; // "Démarrer le live" / "Reprendre" / "Voir"
  onDelete: () => void;
}

interface SetState {
  j1: number;
  j2: number;
  tbJ1: number | null;
  tbJ2: number | null;
  winner: LiveMatchWinner | null;
}

interface SetCell {
  value: number;
  tb: number | null;
  emphasized: boolean;
}

function formatDate(iso: string): string {
  return new Date(iso + 'T00:00:00').toLocaleDateString('fr-FR', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
  });
}

function computeSetWinner(j1: number, j2: number, isSuperTb: boolean): LiveMatchWinner | null {
  const max = Math.max(j1, j2);
  const min = Math.min(j1, j2);
  const diff = max - min;
  const finished = isSuperTb
    ? max >= 10 && diff >= 2
    : (max === 7 && (min === 5 || min === 6)) || (max === 6 && diff >= 2);
  if (!finished) return null;
  return j1 > j2 ? 'j1' : 'j2';
}

function buildSets(match: LiveMatch): SetState[] {
  const isSuper3 = match.set3_format === 'super_tiebreak';
  const raw = [
    { j1: match.set1_j1, j2: match.set1_j2, tbJ1: match.set1_tb_j1, tbJ2: match.set1_tb_j2, isSuper: false },
    { j1: match.set2_j1, j2: match.set2_j2, tbJ1: match.set2_tb_j1, tbJ2: match.set2_tb_j2, isSuper: false },
    { j1: match.set3_j1, j2: match.set3_j2, tbJ1: match.set3_tb_j1, tbJ2: match.set3_tb_j2, isSuper: isSuper3 },
  ];
  return raw
    .filter((s) => s.j1 !== null && s.j2 !== null)
    .map((s) => ({
      j1: s.j1!,
      j2: s.j2!,
      tbJ1: s.tbJ1,
      tbJ2: s.tbJ2,
      winner: computeSetWinner(s.j1!, s.j2!, s.isSuper),
    }));
}

function cellsForSide(sets: SetState[], side: LiveMatchWinner): SetCell[] {
  return sets.map((s) => ({
    value: side === 'j1' ? s.j1 : s.j2,
    tb: side === 'j1' ? s.tbJ1 : s.tbJ2,
    emphasized: s.winner === side,
  }));
}

function playerLabel(match: LiveMatch, side: LiveMatchWinner): string {
  const main = `${match[`${side}_prenom`]} ${match[`${side}_nom`]}`;
  if (match.match_type === 'simple') return main;
  const partnerSide = side === 'j1' ? 'j3' : 'j4';
  const partner = match[`${partnerSide}_prenom`]
    ? `${match[`${partnerSide}_prenom`]} ${match[`${partnerSide}_nom`]}`
    : '';
  return partner ? `${main} / ${partner}` : main;
}

function ScoreCell({ value, tb, emphasized }: SetCell) {
  return (
    <span
      className={`inline-flex items-center justify-center min-w-7 h-7 px-1.5 rounded-md text-sm font-bold tabular-nums ${
        emphasized ? 'bg-foreground text-background' : 'bg-muted text-muted-foreground'
      }`}
    >
      {value}
      {tb !== null && <sup className="ml-0.5 text-[9px] font-semibold opacity-80">{tb}</sup>}
    </span>
  );
}

function PlayerRow({
  name,
  isWinner,
  cells,
}: {
  name: string;
  isWinner: boolean;
  cells: SetCell[];
}) {
  return (
    <div className="flex items-center justify-between gap-3">
      <div className="flex items-center gap-1.5 min-w-0">
        {isWinner && <img src="/trophy.png" alt="Vainqueur" className="h-4 w-4 shrink-0" />}
        <span className={`text-sm text-foreground truncate ${isWinner ? 'font-bold' : 'font-medium'}`}>
          {name}
        </span>
      </div>
      <div className="flex items-center gap-1 shrink-0">
        {cells.map((c, i) => (
          <ScoreCell key={i} {...c} />
        ))}
      </div>
    </div>
  );
}

function needsDeletionBadge(m: LiveMatch): boolean {
  if (m.status !== 'finished' || !m.finished_at) return false;
  const twoDaysMs = 2 * 24 * 60 * 60 * 1000;
  return Date.now() - new Date(m.finished_at).getTime() > twoDaysMs;
}

export default function LiveMatchCard({ match, onPrimary, onDelete }: Props) {
  const primaryLabel =
    match.status === 'pending' ? 'Démarrer le live' : match.status === 'live' ? 'Reprendre' : 'Voir';

  const statusStyles: Record<LiveMatch['status'], string> = {
    pending: 'bg-slate-100 text-slate-700',
    live: 'bg-red-100 text-red-700 animate-pulse',
    finished: 'bg-emerald-100 text-emerald-700',
  };
  const statusLabels: Record<LiveMatch['status'], string> = {
    pending: 'En attente',
    live: 'LIVE',
    finished: 'Terminé',
  };

  const sets = buildSets(match);
  const toDelete = needsDeletionBadge(match);

  return (
    <div className="flex flex-col rounded-2xl border bg-card/90 p-6 shadow-sm transition hover:shadow-md">
      <div className="mb-3 flex items-center gap-2">
        <span className={`rounded-full px-2.5 py-0.5 text-xs font-medium ${statusStyles[match.status]}`}>
          {statusLabels[match.status]}
        </span>
        <span className="text-xs font-medium text-muted-foreground">
          {match.match_type === 'double' ? 'Double' : 'Simple'}
        </span>
        {toDelete && (
          <span className="ml-auto rounded-full bg-red-100 px-2.5 py-0.5 text-xs font-medium text-red-700">
            À supprimer
          </span>
        )}
      </div>

      <div className="flex flex-col gap-2">
        <PlayerRow
          name={playerLabel(match, 'j1')}
          isWinner={match.winner === 'j1'}
          cells={cellsForSide(sets, 'j1')}
        />
        <PlayerRow
          name={playerLabel(match, 'j2')}
          isWinner={match.winner === 'j2'}
          cells={cellsForSide(sets, 'j2')}
        />
      </div>

      <p className="mt-3 flex items-center gap-2 text-xs text-muted-foreground">
        <span>
          {formatDate(match.match_date)}
          {match.start_time && ` — ${match.start_time.slice(0, 5)}`}
        </span>
        {match.court && <span>Court : {match.court}</span>}
      </p>

      <div className="mt-4 flex gap-2 pt-2">
        <button
          onClick={onPrimary}
          className="rounded-lg bg-primary px-3 py-1.5 text-sm font-medium text-primary-foreground shadow-sm transition hover:brightness-95"
        >
          {primaryLabel}
        </button>
        <button
          onClick={onDelete}
          className="ml-auto rounded-lg border border-red-200 bg-red-50 px-3 py-1.5 text-sm font-medium text-red-700 transition hover:bg-red-100"
        >
          Supprimer
        </button>
      </div>
    </div>
  );
}
