import type {
  TeamCategorie,
  TeamCompetition,
  TeamEtape,
  TeamFormat,
  TeamGenre,
  TeamMatchLine,
  TeamStadeFinale,
  TeamType,
} from '../../types';

// --- Listes de référence ---

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

export function formatCategorie(c: TeamCategorie): string {
  return CATEGORIE_LABELS[c] ?? c;
}

export const FORMAT_LABELS: Record<TeamFormat, string> = {
  '2S1D': '2 simples et 1 double',
  '3S1D': '3 simples et 1 double',
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

// Suggestions du champ catégorie (saisie libre possible).
export const CATEGORIES_BY_TYPE: Record<TeamType, string[]> = {
  adultes: ['Seniors', '+35 ans', '+45 ans', '+55 ans', '+60 ans', '+65 ans', '+70 ans', '+75 ans'],
  jeunes: ['17/18 ans', '15/16 ans', '13/14 ans', '11/12 ans'],
};

/** Catégorie déduite du nom Ten'Up (ex. "GAN 70 MESSIEURS" → "+70 ans") ; null si rien de sûr. */
export function inferCategorie(nom: string): string | null {
  const jeunes = /\b(11|13|15|17)\s*[/-]\s*(12|14|16|18)\b/.exec(nom);
  if (jeunes && Number(jeunes[2]) === Number(jeunes[1]) + 1) return `${jeunes[1]}/${jeunes[2]} ans`;
  const veterans = /(?:^|[^0-9])\+?\s?(35|45|55|60|65|70|75|80|85)(?![0-9])/.exec(nom);
  if (veterans) return `+${veterans[1]} ans`;
  if (/\bseniors?\b/i.test(nom)) return 'Seniors';
  return null;
}

// --- Spécification d'un format (nb de matches, points du double) ---

export interface FormatSpec {
  simples: number;
  doubles: number;
  doublePoints: number; // points rapportés par un double gagné
}

export const FORMAT_SPECS: Record<TeamFormat, FormatSpec> = {
  '2S1D': { simples: 2, doubles: 1, doublePoints: 1 },
  '3S1D': { simples: 3, doubles: 1, doublePoints: 1 },
  '3S1D2': { simples: 3, doubles: 1, doublePoints: 2 },
  '4S1D2': { simples: 4, doubles: 1, doublePoints: 2 },
  '4S2D': { simples: 4, doubles: 2, doublePoints: 1 },
};

/** Nombre total de matches individuels attendus pour un format. */
export function expectedMatchCount(format: TeamFormat): number {
  const spec = FORMAT_SPECS[format];
  return spec.simples + spec.doubles;
}

/** Total de points en jeu sur une rencontre (sert au score d'un WO). */
export function totalPointsFormat(format: TeamFormat): number {
  const spec = FORMAT_SPECS[format];
  return spec.simples + spec.doubles * spec.doublePoints;
}

// --- Helpers d'affichage composés ---

/** ex. "Pyrénées Interclubs — Hommes Seniors" */
export function competitionLabel(c: Pick<TeamCompetition, 'nom' | 'genre' | 'categorie'>): string {
  return `${c.nom} — ${GENRE_LABELS[c.genre]} ${formatCategorie(c.categorie)}`;
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
