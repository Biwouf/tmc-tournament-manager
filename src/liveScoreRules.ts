import type { LiveMatch, LiveMatchWinner } from './types';

export type Player = 'j1' | 'j2';

export interface NormalSet {
  j1: number;
  j2: number;
  tb_j1: number | null;
  tb_j2: number | null;
}

export interface SuperTbSet {
  j1: number;
  j2: number;
}

/* ---------- Normal set (sets 1, 2, and set 3 when format='normal') ---------- */

export function getNormalSetWinner(s: NormalSet): Player | null {
  const { j1, j2, tb_j1, tb_j2 } = s;
  // 6/x or x/6 with 2 games lead (x <= 4)
  if (j1 === 6 && j2 <= 4) return 'j1';
  if (j2 === 6 && j1 <= 4) return 'j2';
  // 7/5
  if (j1 === 7 && j2 === 5) return 'j1';
  if (j2 === 7 && j1 === 5) return 'j2';
  // 7/6 via tiebreak (validate tb has a winner too)
  if (j1 === 7 && j2 === 6 && tb_j1 !== null && tb_j2 !== null) {
    if (tb_j1 >= 7 && tb_j1 - tb_j2 >= 2) return 'j1';
  }
  if (j2 === 7 && j1 === 6 && tb_j1 !== null && tb_j2 !== null) {
    if (tb_j2 >= 7 && tb_j2 - tb_j1 >= 2) return 'j2';
  }
  return null;
}

export function isNormalSetInTiebreak(s: NormalSet): boolean {
  return s.j1 === 6 && s.j2 === 6 && s.tb_j1 !== null && s.tb_j2 !== null;
}

export function canIncrementNormal(s: NormalSet): boolean {
  return getNormalSetWinner(s) === null;
}

export function canDecrementNormal(s: NormalSet, p: Player): boolean {
  const winner = getNormalSetWinner(s);
  if (winner !== null) return winner === p; // only the winner's side can undo the winning point
  if (isNormalSetInTiebreak(s)) {
    const tb = p === 'j1' ? s.tb_j1! : s.tb_j2!;
    const otherTb = p === 'j1' ? s.tb_j2! : s.tb_j1!;
    return tb > 0 || otherTb === 0;
  }
  const games = p === 'j1' ? s.j1 : s.j2;
  return games > 0;
}

export function incrementNormal(s: NormalSet, p: Player): NormalSet {
  if (!canIncrementNormal(s)) return s;
  if (isNormalSetInTiebreak(s)) {
    const next: NormalSet = { ...s };
    if (p === 'j1') next.tb_j1 = s.tb_j1! + 1;
    else next.tb_j2 = s.tb_j2! + 1;
    // If tiebreak is won, bump set games to 7
    if (next.tb_j1! >= 7 && next.tb_j1! - next.tb_j2! >= 2) next.j1 = 7;
    else if (next.tb_j2! >= 7 && next.tb_j2! - next.tb_j1! >= 2) next.j2 = 7;
    return next;
  }
  // Ongoing — increment games
  const next: NormalSet = { ...s };
  if (p === 'j1') next.j1 = s.j1 + 1;
  else next.j2 = s.j2 + 1;
  // Enter tiebreak on 6/6
  if (next.j1 === 6 && next.j2 === 6) {
    next.tb_j1 = 0;
    next.tb_j2 = 0;
  }
  return next;
}

export function decrementNormal(s: NormalSet, p: Player): NormalSet {
  if (!canDecrementNormal(s, p)) return s;
  const winner = getNormalSetWinner(s);
  // Won via tiebreak (7/6) — undo the winning tb point, set returns to 6/6 tiebreak
  if (winner === p && s.j1 === 7 && s.j2 === 6) {
    return { ...s, j1: 6, tb_j1: s.tb_j1! - 1 };
  }
  if (winner === p && s.j2 === 7 && s.j1 === 6) {
    return { ...s, j2: 6, tb_j2: s.tb_j2! - 1 };
  }
  // Won via normal (7/5 or 6/x) — decrement games
  if (winner === 'j1') return { ...s, j1: s.j1 - 1 };
  if (winner === 'j2') return { ...s, j2: s.j2 - 1 };
  // In tiebreak
  if (isNormalSetInTiebreak(s)) {
    const tb = p === 'j1' ? s.tb_j1! : s.tb_j2!;
    if (tb > 0) {
      if (p === 'j1') return { ...s, tb_j1: s.tb_j1! - 1 };
      return { ...s, tb_j2: s.tb_j2! - 1 };
    }
    // Both 0 → exit tiebreak
    if (p === 'j1') return { ...s, j1: 5, tb_j1: null, tb_j2: null };
    return { ...s, j2: 5, tb_j1: null, tb_j2: null };
  }
  // Ongoing
  if (p === 'j1') return { ...s, j1: s.j1 - 1 };
  return { ...s, j2: s.j2 - 1 };
}

/* ---------- Super tiebreak (set 3 when format='super_tiebreak') ---------- */

export function getSuperTbWinner(s: SuperTbSet): Player | null {
  if (s.j1 >= 10 && s.j1 - s.j2 >= 2) return 'j1';
  if (s.j2 >= 10 && s.j2 - s.j1 >= 2) return 'j2';
  return null;
}

export function canIncrementSuperTb(s: SuperTbSet): boolean {
  return getSuperTbWinner(s) === null;
}

export function canDecrementSuperTb(s: SuperTbSet, p: Player): boolean {
  return p === 'j1' ? s.j1 > 0 : s.j2 > 0;
}

export function incrementSuperTb(s: SuperTbSet, p: Player): SuperTbSet {
  if (!canIncrementSuperTb(s)) return s;
  return p === 'j1' ? { ...s, j1: s.j1 + 1 } : { ...s, j2: s.j2 + 1 };
}

export function decrementSuperTb(s: SuperTbSet, p: Player): SuperTbSet {
  if (!canDecrementSuperTb(s, p)) return s;
  return p === 'j1' ? { ...s, j1: s.j1 - 1 } : { ...s, j2: s.j2 - 1 };
}

/* ---------- LiveMatch-level helpers ---------- */

export function getSet(m: LiveMatch, n: 1 | 2): NormalSet {
  if (n === 1) {
    return {
      j1: m.set1_j1 ?? 0,
      j2: m.set1_j2 ?? 0,
      tb_j1: m.set1_tb_j1,
      tb_j2: m.set1_tb_j2,
    };
  }
  return {
    j1: m.set2_j1 ?? 0,
    j2: m.set2_j2 ?? 0,
    tb_j1: m.set2_tb_j1,
    tb_j2: m.set2_tb_j2,
  };
}

export function getSet3Normal(m: LiveMatch): NormalSet {
  return {
    j1: m.set3_j1 ?? 0,
    j2: m.set3_j2 ?? 0,
    tb_j1: m.set3_tb_j1,
    tb_j2: m.set3_tb_j2,
  };
}

export function getSet3SuperTb(m: LiveMatch): SuperTbSet {
  return {
    j1: m.set3_j1 ?? 0,
    j2: m.set3_j2 ?? 0,
  };
}

export function setNormalIntoMatch(n: 1 | 2 | 3, s: NormalSet): Partial<LiveMatch> {
  if (n === 1) {
    return { set1_j1: s.j1, set1_j2: s.j2, set1_tb_j1: s.tb_j1, set1_tb_j2: s.tb_j2 };
  }
  if (n === 2) {
    return { set2_j1: s.j1, set2_j2: s.j2, set2_tb_j1: s.tb_j1, set2_tb_j2: s.tb_j2 };
  }
  return { set3_j1: s.j1, set3_j2: s.j2, set3_tb_j1: s.tb_j1, set3_tb_j2: s.tb_j2 };
}

export function setSuperTbIntoMatch(s: SuperTbSet): Partial<LiveMatch> {
  return { set3_j1: s.j1, set3_j2: s.j2, set3_tb_j1: null, set3_tb_j2: null };
}

export function isSet3Needed(m: LiveMatch): boolean {
  const w1 = getNormalSetWinner(getSet(m, 1));
  const w2 = getNormalSetWinner(getSet(m, 2));
  return w1 !== null && w2 !== null && w1 !== w2;
}

export function getMatchWinner(m: LiveMatch): LiveMatchWinner | null {
  const w1 = getNormalSetWinner(getSet(m, 1));
  const w2 = getNormalSetWinner(getSet(m, 2));
  if (w1 === null || w2 === null) return null;
  if (w1 === w2) return w1;
  // Need set 3
  if (m.set3_format === null) return null;
  const w3 =
    m.set3_format === 'super_tiebreak'
      ? getSuperTbWinner(getSet3SuperTb(m))
      : getNormalSetWinner(getSet3Normal(m));
  return w3;
}
