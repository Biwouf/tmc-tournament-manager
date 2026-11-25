import { RANK_NUMBERED, TENNIS_RANKINGS } from '../../../shared/tennisRankings';
import type { LiveMatch } from '../types';
import type { TeamLine } from './teamMatches';

// Older compositions may hold -30: above -15, below numbered players. Compared in upper case ('Top').
const rankings = [...TENNIS_RANKINGS.filter(r => r !== RANK_NUMBERED), '-30', RANK_NUMBERED].map(r => r.toUpperCase());

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
