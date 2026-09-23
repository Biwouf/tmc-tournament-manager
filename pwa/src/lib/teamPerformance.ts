import { TENNIS_RANKINGS } from '../../../shared/tennisRankings';
import type { LiveMatch } from '../types';
import type { TeamLine } from './teamMatches';

// The team composition form also supports -30, above the shared signup list.
const rankings: readonly string[] = [...TENNIS_RANKINGS, '-30'];

export function isClubPerformance(line: TeamLine, live?: LiveMatch): boolean {
  if (line.match_type !== 'simple' || line.joueurs_club.length !== 1 || line.joueurs_adverse.length !== 1 || line.result_kind === 'wo') return false;
  const clubWon = line.confirmed_at
    ? line.gagnant === 'club'
    : live
      ? live.status === 'finished' && live.winner === 'j1'
      : line.result_kind !== null && line.gagnant === 'club';
  if (!clubWon) return false;

  const clubRank = rankings.indexOf(line.joueurs_club[0].classement?.trim().toUpperCase());
  const opponentRank = rankings.indexOf(line.joueurs_adverse[0].classement?.trim().toUpperCase());
  // Missing or unsupported historical rankings must never count as NC by default.
  return clubRank >= 0 && opponentRank > clubRank;
}
