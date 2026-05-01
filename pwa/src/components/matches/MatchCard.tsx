// Carte d'un match — gère les 3 statuts : pending, live, finished.
// Score affiché à droite de chaque joueur sous forme de tuiles, comme un scoreboard ATP.

import type { LiveMatch, LiveMatchWinner } from '../../types';
import LiveBadge from './LiveBadge';

interface Props {
  match: LiveMatch;
}

interface SetState {
  j1: number;
  j2: number;
  tbJ1: number | null;
  tbJ2: number | null;
  winner: LiveMatchWinner | null; // null tant que le set est en cours
}

interface SetCell {
  value: number;
  tb: number | null;
  emphasized: boolean;
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
  classement,
  isWinner,
  cells,
}: {
  name: string;
  classement: string | null;
  isWinner: boolean;
  cells: SetCell[];
}) {
  return (
    <div className="flex items-center justify-between gap-3">
      <div className="flex items-baseline gap-1.5 min-w-0">
        <span className={`text-sm text-foreground truncate ${isWinner ? 'font-bold' : 'font-medium'}`}>
          {name}
        </span>
        {classement && (
          <span className="text-xs text-muted-foreground whitespace-nowrap">({classement})</span>
        )}
      </div>
      <div className="flex items-center gap-1 shrink-0">
        {cells.map((c, i) => (
          <ScoreCell key={i} {...c} />
        ))}
      </div>
    </div>
  );
}

export default function MatchCard({ match }: Props) {
  const isLive = match.status === 'live';
  const isPending = match.status === 'pending';
  const isFinished = match.status === 'finished';
  const sets = buildSets(match);
  const showClassement = match.match_type === 'simple';

  return (
    <div className={`bg-card rounded-xl p-4 shadow-sm border flex flex-col gap-3 ${isLive ? 'border-primary' : 'border-border'}`}>
      <div className="flex items-center justify-between">
        {isLive && <LiveBadge />}
        {isPending && match.start_time && (
          <span className="text-xs text-muted-foreground">
            Commence à {match.start_time.slice(0, 5)}
          </span>
        )}
        {isFinished && (
          <span className="text-xs text-muted-foreground font-medium">Terminé</span>
        )}
        <span className="text-xs text-muted-foreground ml-auto">
          {match.match_type === 'double' ? 'Double' : 'Simple'}
        </span>
      </div>

      <div className="flex flex-col gap-2">
        <PlayerRow
          name={playerLabel(match, 'j1')}
          classement={showClassement ? match.j1_classement : null}
          isWinner={match.winner === 'j1'}
          cells={cellsForSide(sets, 'j1')}
        />
        <PlayerRow
          name={playerLabel(match, 'j2')}
          classement={showClassement ? match.j2_classement : null}
          isWinner={match.winner === 'j2'}
          cells={cellsForSide(sets, 'j2')}
        />
      </div>
    </div>
  );
}
