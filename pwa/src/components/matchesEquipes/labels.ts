import type { TeamCategorie, TeamCompetition, TeamGenre } from '../../types';

const GENRE_LABELS: Record<TeamGenre, string> = {
  hommes: 'Hommes',
  femmes: 'Femmes',
  mixte: 'Mixte',
  garcons: 'Garçons',
  filles: 'Filles',
};

// Codes historiques (avant la catégorie libre) ; toute autre valeur est déjà un libellé.
const CATEGORIE_LABELS: Record<string, string> = {
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
  return CATEGORIE_LABELS[c] ?? c;
}

/** ex. "Hommes Seniors" — libellé court mobile (genre + catégorie). */
export function competitionShortLabel(c: Pick<TeamCompetition, 'genre' | 'categorie'>): string {
  return `${formatGenre(c.genre)} ${formatCategorie(c.categorie)}`;
}

// Nom complet, jamais tronqué. Genre + catégorie ajoutés seulement si le nom ne porte pas
// déjà la catégorie (« Challenge d'hiver – Seniors messieurs » se suffit).
export function competitionLabel(comp: Pick<TeamCompetition, 'nom' | 'genre' | 'categorie'>): string {
  const plain = (v: string) => v.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
  return plain(comp.nom).includes(plain(formatCategorie(comp.categorie)))
    ? comp.nom
    : `${comp.nom} · ${competitionShortLabel(comp)}`;
}
