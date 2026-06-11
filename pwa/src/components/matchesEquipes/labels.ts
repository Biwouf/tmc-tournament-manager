import type { TeamCategorie, TeamCompetition, TeamGenre } from '../../types';

const GENRE_LABELS: Record<TeamGenre, string> = {
  hommes: 'Hommes',
  femmes: 'Femmes',
  mixte: 'Mixte',
  garcons: 'Garçons',
  filles: 'Filles',
};

const CATEGORIE_LABELS: Record<TeamCategorie, string> = {
  seniors: 'Seniors',
  '35_ans': '+35 ans',
  '60_ans': '+60 ans',
  '17_18': '17/18 ans',
  '15_16': '15/16 ans',
  '13_14': '13/14 ans',
  '11_12': '11/12 ans',
};

export function formatGenre(g: TeamGenre): string {
  return GENRE_LABELS[g];
}

export function formatCategorie(c: TeamCategorie): string {
  return CATEGORIE_LABELS[c];
}

/** ex. "Hommes Seniors" — libellé court mobile (genre + catégorie). */
export function competitionShortLabel(c: Pick<TeamCompetition, 'genre' | 'categorie'>): string {
  return `${formatGenre(c.genre)} ${formatCategorie(c.categorie)}`;
}
