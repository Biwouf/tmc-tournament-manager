import type {
  TeamCategorie,
  TeamCompetition,
  TeamCompetitionNom,
  TeamEtape,
  TeamFormat,
  TeamGenre,
  TeamMatchLine,
  TeamStadeFinale,
  TeamType,
} from '../../types';

// --- Listes de référence ---

export const COMPETITION_NOMS: TeamCompetitionNom[] = [
  'Pyrénées Interclubs',
  'CODEP',
  'GAN 35',
  'Thénégal',
  'Interclubs',
];

export const DIVISIONS = ['R1A', 'R1B', 'R2', 'R3', 'R4', 'R5', 'R6'] as const;

export const STADES_FINALE: TeamStadeFinale[] = ['1/16', '1/8', '1/4', '1/2', 'finale'];

// --- Libellés d'affichage ---

export const TYPE_LABELS: Record<TeamType, string> = {
  adultes: 'Adultes',
  jeunes: 'Jeunes',
};

export const GENRE_LABELS: Record<TeamGenre, string> = {
  hommes: 'Hommes',
  femmes: 'Femmes',
  mixte: 'Mixte',
  garcons: 'Garçons',
  filles: 'Filles',
};

export const CATEGORIE_LABELS: Record<TeamCategorie, string> = {
  seniors: 'Seniors',
  '35_ans': '+35 ans',
  '60_ans': '+60 ans',
  '17_18': '17/18 ans',
  '15_16': '15/16 ans',
  '13_14': '13/14 ans',
  '11_12': '11/12 ans',
};

export const FORMAT_LABELS: Record<TeamFormat, string> = {
  '2S1D': '2 simples et 1 double',
  '3S1D2': '3 simples et 1 double (double = 2 pts)',
  '4S1D2': '4 simples et 1 double (double = 2 pts)',
  '4S2D': '4 simples et 2 doubles',
};

export const STADE_LABELS: Record<TeamStadeFinale, string> = {
  '1/16': '1/16 de finale',
  '1/8': '1/8 de finale',
  '1/4': '1/4 de finale',
  '1/2': 'Demi-finale',
  finale: 'Finale',
};

// --- Contraintes genre/catégorie selon le type ---

export const GENRES_BY_TYPE: Record<TeamType, TeamGenre[]> = {
  adultes: ['hommes', 'femmes', 'mixte'],
  jeunes: ['garcons', 'filles'],
};

export const CATEGORIES_BY_TYPE: Record<TeamType, TeamCategorie[]> = {
  adultes: ['seniors', '35_ans', '60_ans'],
  jeunes: ['17_18', '15_16', '13_14', '11_12'],
};

// --- Spécification d'un format (nb de matches, points du double) ---

export interface FormatSpec {
  simples: number;
  doubles: number;
  doublePoints: number; // points rapportés par un double gagné
}

export const FORMAT_SPECS: Record<TeamFormat, FormatSpec> = {
  '2S1D': { simples: 2, doubles: 1, doublePoints: 1 },
  '3S1D2': { simples: 3, doubles: 1, doublePoints: 2 },
  '4S1D2': { simples: 4, doubles: 1, doublePoints: 2 },
  '4S2D': { simples: 4, doubles: 2, doublePoints: 1 },
};

/** Nombre total de matches individuels attendus pour un format. */
export function expectedMatchCount(format: TeamFormat): number {
  const spec = FORMAT_SPECS[format];
  return spec.simples + spec.doubles;
}

// --- Helpers d'affichage composés ---

/** ex. "Pyrénées Interclubs — Hommes Seniors" */
export function competitionLabel(c: Pick<TeamCompetition, 'nom' | 'genre' | 'categorie'>): string {
  return `${c.nom} — ${GENRE_LABELS[c.genre]} ${CATEGORIE_LABELS[c.categorie]}`;
}

/** ex. "J3" ou "1/4 de finale" */
export function etapeLabel(e: Pick<TeamEtape, 'phase' | 'numero_journee' | 'stade_finale'>): string {
  if (e.phase === 'poule') return `J${e.numero_journee}`;
  return e.stade_finale ? STADE_LABELS[e.stade_finale] : 'Phase finale';
}

/** ex. "J3" ou "1/4" — version courte pour le contexte Live Score */
export function etapeLabelCourt(e: Pick<TeamEtape, 'phase' | 'numero_journee' | 'stade_finale'>): string {
  if (e.phase === 'poule') return `J${e.numero_journee}`;
  return e.stade_finale ?? 'Finale';
}

/** Liste des stades depuis le stade de départ jusqu'à la finale incluse. */
export function stadesFromDepart(depart: TeamStadeFinale): TeamStadeFinale[] {
  const idx = STADES_FINALE.indexOf(depart);
  return idx === -1 ? [] : STADES_FINALE.slice(idx);
}

/** Points club / adverse calculés à partir des gagnants des matches d'une rencontre. */
export function computeScore(
  lines: Pick<TeamMatchLine, 'match_type' | 'gagnant'>[],
  format: TeamFormat
): { club: number; adverse: number } {
  const doublePoints = FORMAT_SPECS[format].doublePoints;
  let club = 0;
  let adverse = 0;
  for (const l of lines) {
    if (!l.gagnant) continue;
    const pts = l.match_type === 'double' ? doublePoints : 1;
    if (l.gagnant === 'club') club += pts;
    else adverse += pts;
  }
  return { club, adverse };
}
