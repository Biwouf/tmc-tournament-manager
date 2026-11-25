// Barème FFT (5e série depuis le 01/07/2025) : source unique du back-office, de la PWA et de compo-scan.
// En base : `is_tennis_ranking` et le CHECK de `profile_details.classement` (2026112201).
const SERIE_5 = ['40/2', '40/1'] as const;
const SERIE_4 = ['40', '30/5', '30/4', '30/3', '30/2', '30/1'] as const;
const SERIE_3 = ['30', '15/5', '15/4', '15/3', '15/2', '15/1'] as const;
const SERIE_2 = ['15', '5/6', '4/6', '3/6', '2/6', '1/6', '0', '-2/6', '-4/6', '-15'] as const;

/** Séries, de la plus faible à la plus forte, pour les grilles et listes de choix. */
export const RANK_SERIES: readonly { label: string; ranks: readonly TennisRanking[] }[] = [
  { label: '5e série', ranks: SERIE_5 },
  { label: '4e série', ranks: SERIE_4 },
  { label: '3e série', ranks: SERIE_3 },
  { label: '2e série', ranks: SERIE_2 },
];

/** Joueurs numérotés (Top 100 et au-dessus). */
export const RANK_NUMBERED = 'Top';
export const RANK_NUMBERED_LABEL = 'Numéroté·e (Top 100 et au-dessus)';

// Ordre croissant. « NC » reste accepté (compos, anciennes inscriptions) mais n'est plus un choix du profil.
export const TENNIS_RANKINGS = ['NC', ...SERIE_5, ...SERIE_4, ...SERIE_3, ...SERIE_2, RANK_NUMBERED] as const;
export type TennisRanking = (typeof TENNIS_RANKINGS)[number];
