import type { TeamRencontre } from '../../types';

export type ResultIssue = 'win' | 'lose' | 'draw';

export const ISSUE_LABEL: Record<ResultIssue, string> = { win: 'Victoire', lose: 'Défaite', draw: 'Nul' };
export const ISSUE_LETTER: Record<ResultIssue, string> = { win: 'V', lose: 'D', draw: 'N' };

/** Issue d'un score club / adversaire ; `null` tant qu'aucun score n'est exploitable. */
export function scoreIssue(club: number | null | undefined, adverse: number | null | undefined, wo = false): ResultIssue | null {
  if (club == null || adverse == null) return null;
  // 0–0 hors WO = aucun résultat saisi (un nul à 0 point n'existe pas).
  if (!wo && club + adverse === 0) return null;
  return club > adverse ? 'win' : club < adverse ? 'lose' : 'draw';
}

/** Issue d'une rencontre d'après ses scores figés. */
export function outcome(r: Pick<TeamRencontre, 'score_club' | 'score_adverse' | 'wo'>): ResultIssue | null {
  return scoreIssue(r.score_club, r.score_adverse, r.wo);
}
