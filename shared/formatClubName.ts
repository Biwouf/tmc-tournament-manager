// Casse d'AFFICHAGE des noms de clubs (brief UX PWA, PR4, 14/11/2026).
// Ten'Up livre souvent les adversaires tout en capitales (« ASSOCIATION TENNIS MONTAUBAN
// A.T.M 2 ») : on les remet en casse de titre au rendu seulement. La base, les payloads et les
// exports machine gardent la casse d'origine : ne jamais écrire le résultat en base.

/** Sigles laissés en capitales. Liste extensible. */
export const CLUB_ACRONYMS = new Set([
  'CAC', 'ASPTT', 'US', 'TC', 'AS', 'CS', 'FC', 'RC', 'ES', 'AC', 'UC', 'TUC', 'UTC', 'OM', 'SCO',
]);

/** Particules en minuscules, sauf en tête du nom. */
const PARTICLES = new Set(['de', 'du', 'des', 'la', 'le', 'les', 'et', 'sur', 'en', 'aux']);

const LOCALE = 'fr-FR';
const lower = (s: string) => s.toLocaleLowerCase(LOCALE);
const upper = (s: string) => s.toLocaleUpperCase(LOCALE);
const capitalize = (s: string) => upper(s.charAt(0)) + lower(s.slice(1));

// Jeton court sans voyelle (accentuées comprises) : un sigle (« TC », « CS »).
const CONSONANT_SIGLE = /^[^\WAEIOUYÀÂÄÉÈÊËÎÏÔÖÙÛÜŸ\d_]{2,5}$/u;

function formatSegment(segment: string, leading: boolean): string {
  if (!segment) return segment;
  if (/^\d+$/.test(segment)) return segment; // numéro d'équipe
  if (segment.includes('.')) return segment; // sigle pointé : A.T.M, T.C
  // l'/d' + mot : particule élidée, le reste suit les règles d'un mot intérieur.
  const elided = /^([LD])(['’])(.+)$/u.exec(segment);
  if (elided) {
    const [, letter, apostrophe, rest] = elided;
    return `${leading ? letter : lower(letter)}${apostrophe}${formatSegment(rest, false)}`;
  }
  if (CLUB_ACRONYMS.has(segment)) return segment;
  if (CONSONANT_SIGLE.test(segment)) return segment;
  if (!leading && PARTICLES.has(lower(segment))) return lower(segment);
  return capitalize(segment);
}

export function formatClubName(name: string | null | undefined): string {
  if (!name) return '';
  // Déjà en casse mixte (ou sans lettre) : on n'y touche pas.
  if (name !== upper(name) || name === lower(name)) return name;
  return name
    .trim()
    .split(/\s+/)
    .map((word, w) => word.split('-').map((segment, s) => formatSegment(segment, w === 0 && s === 0)).join('-'))
    .join(' ');
}
