import type { LiveMatch } from '../types';
import {
  getSet,
  getSet3Normal,
  getSet3SuperTb,
  getNormalSetWinner,
  isSet3Needed,
  isNormalSetInTiebreak,
  incrementNormal,
  incrementSuperTb,
  setNormalIntoMatch,
  setSuperTbIntoMatch,
  getMatchWinner,
  type Player,
} from '../liveScoreRules';
export function activeSet(m: LiveMatch): 1 | 2 | 3 {
  if (!getNormalSetWinner(getSet(m, 1))) return 1;
  if (!getNormalSetWinner(getSet(m, 2))) return 2;
  return 3;
}
export function quickScore(
  m: LiveMatch,
  player: Player,
): Partial<LiveMatch> | null {
  if (m.status !== 'live' || getMatchWinner(m)) return null;
  const n = activeSet(m);
  if (n === 3 && (!isSet3Needed(m) || !m.set3_format)) return null;
  if (n === 3 && m.set3_format === 'super_tiebreak')
    return setSuperTbIntoMatch(incrementSuperTb(getSet3SuperTb(m), player));
  return setNormalIntoMatch(
    n,
    incrementNormal(n === 3 ? getSet3Normal(m) : getSet(m, n), player),
  );
}
export function quickScoreLabel(m: LiveMatch) {
  const n = activeSet(m);
  return (n === 3 && m.set3_format === 'super_tiebreak') ||
    isNormalSetInTiebreak(n === 3 ? getSet3Normal(m) : getSet(m, n))
    ? '+ point'
    : '+ jeu';
}
export function finalScorePatch(
  m: LiveMatch,
  patch: Partial<LiveMatch>,
): Partial<LiveMatch> {
  const winner = getMatchWinner({ ...m, ...patch });
  if (m.retired_player) return patch;
  return {
    ...patch,
    status: winner ? 'finished' : 'live',
    winner,
    finished_at: winner ? (m.finished_at ?? new Date().toISOString()) : null,
  };
}
export function scoreSnapshot(m: LiveMatch): Partial<LiveMatch> {
  return Object.fromEntries(
    Object.entries(m).filter(
      ([key]) =>
        /^set[123]_/.test(key) ||
        ['status', 'winner', 'retired_player', 'finished_at'].includes(key),
    ),
  );
}
export function scoreLabel(m: Partial<LiveMatch>) {
  return ([1, 2, 3] as const)
    .flatMap((n) => {
      const a = m[`set${n}_j1`],
        b = m[`set${n}_j2`];
      return a == null && b == null ? [] : [`${a ?? 0}–${b ?? 0}`];
    })
    .join(' · ');
}
