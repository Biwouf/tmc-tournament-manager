// Onboarding « Ten'Up d'abord » (brief SAAS_11, §5.4 et décision 5 du 14/11/2026) — à partir du
// nom Ten'Up d'un club (« MOISSAC TENNIS CLUB ») : nom court (écran d'accueil, 12 caractères) et
// adresse courte proposée (`moissac-tc`). Le nom formaté est celui de `formatClubName`
// (`shared/formatClubName.ts`, PR4 du brief UX PWA), réexporté ici : une seule règle de casse.
import { signupSlugProblem } from './clubSlug.mjs';
import { CLUB_ACRONYMS, formatClubName } from './formatClubName.ts';

export { formatClubName };

/** Mots en minuscules dans un nom formaté, sauf en premier mot. */
const LOWER_WORDS = ['de', 'du', 'des', 'la', 'le', 'les', 'et', 'sur', 'en', 'aux'];
const ELIDED = /^([LD])['’](.+)$/i;
const VOWEL = /[AEIOUYÀÂÄÉÈÊËÎÏÔÖÙÛÜŸ]/i;

/** Sigle laissé en capitales par `formatClubName` : à points, sans voyelle, ou connu. */
const isSigle = (word) => /^(?:\p{Lu}\.){1,5}\p{Lu}?$/u.test(word) // A.T.M, T.C, A.C.T.
  || (/^\p{Lu}{2,5}$/u.test(word) && !VOWEL.test(word)) // TC, TCM
  || CLUB_ACRONYMS.has(word);

/** Formes connues → sigle du nom court, la plus longue d'abord. */
const FORMS = [
  [['tennis', 'club', 'municipal'], 'TCM'],
  [['tennis', 'padel', 'club'], 'TPC'],
  [['tennis', 'club'], 'TC'],
  [['association', 'sportive'], 'AS'],
  [['union', 'sportive'], 'US'],
  [['racing', 'club'], 'RC'],
  [['sporting', 'club'], 'SC'],
  [['athletic', 'club'], 'AC'],
  [['stade'], 'Stade'],
];
/** Mots qui ne désignent pas le club (jamais retenus seuls comme nom court). */
const GENERIC = ['tennis', 'club', 'padel', 'association', 'sportive', 'sportif', 'union', 'section', 'stade'];
const MAX_SHORT = 12;

const fold = (word) => word.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
/** « Saint Girons » → « St Girons » : le nom court tient plus souvent en 12 caractères. */
const abbreviate = (word) => word.replace(/^Saint(?=-|$)/, 'St').replace(/^Sainte(?=-|$)/, 'Ste');

/** Premier mot significatif (« St » garde le mot suivant), tronqué à 12. */
function firstWord(words) {
  const significant = words.map((w) => ELIDED.exec(w)?.[2] ?? w) // « l'Isle » → « Isle »
    .filter((w) => !LOWER_WORDS.includes(fold(w)) && !GENERIC.includes(fold(w)) && !isSigle(w));
  const [head, next] = significant.map(abbreviate);
  if (!head) return words.map(abbreviate).join(' ').slice(0, MAX_SHORT).trim();
  const pair = /^Ste?$/.test(head) && next ? `${head} ${next}` : head;
  return (pair.length <= MAX_SHORT ? pair : head).slice(0, MAX_SHORT);
}

/** Nom court proposé (§5.4, ≤ 12 caractères) : le nom formaté s'il tient ; sinon `<Ville> <sigle>`
 * (« Moissac Tennis Club » → « Moissac TC ») ; sinon le premier mot significatif, tronqué à 12. */
export function shortNameFor(value) {
  const name = formatClubName(String(value ?? '').replace(/\s+/g, ' ').trim());
  if (name.length <= MAX_SHORT) return name;
  const words = name.split(' ');
  // Sigle : une forme connue, ou un sigle déjà présent (points retirés : « A.C.T. » → « ACT »).
  const tokens = [];
  for (let i = 0; i < words.length;) {
    const form = FORMS.find(([parts]) => parts.every((part, k) => fold(words[i + k] ?? '') === part));
    if (form) { tokens.push({ sigle: form[1] }); i += form[0].length; continue; }
    tokens.push(isSigle(words[i]) ? { sigle: words[i].replace(/\./g, '') } : { word: words[i] });
    i++;
  }
  const at = tokens.findIndex((t) => t.sigle);
  if (at >= 0) {
    const rest = tokens.filter((t) => t.word && !GENERIC.includes(fold(t.word))).map((t) => abbreviate(t.word));
    while (rest.length && LOWER_WORDS.includes(fold(rest.at(-1)))) rest.pop();
    const lead = [...rest];
    while (lead.length && LOWER_WORDS.includes(fold(lead[0]))) lead.shift();
    // « Tennis Club du Lac » → « TC du Lac » ; « Moissac Tennis Club » → « Moissac TC ».
    const candidate = at === 0 ? [tokens[at].sigle, ...rest].join(' ') : [...lead, tokens[at].sigle].join(' ');
    if (lead.length && candidate.length <= MAX_SHORT) return candidate;
  }
  return firstWord(words);
}

const STOP_WORDS = ['de', 'du', 'des', 'la', 'le', 'les', 'l', 'd', 'et'];
/** Même règle que `slugify` du tunnel (`src/lib/clubSignup.ts`). */
function slugify(value) {
  return fold(String(value ?? '')).split(/[^a-z0-9]+/).filter((w) => w && !STOP_WORDS.includes(w))
    .join('-').slice(0, 32).replace(/-+$/, '');
}

/** Adresses proposées dans l'ordre (décision 5) : le slug du nom court (`moissac-tc`), puis
 * `-<ville>` (si la ville n'y est pas déjà), puis `-2`, `-3`. Seules les adresses au format
 * self-serve sont gardées ; la disponibilité se vérifie avec `slug_available`. */
export function shortSlugCandidates(shortName, city) {
  const base = slugify(shortName);
  const town = slugify(city);
  const cut = (slug) => slug.slice(0, 32).replace(/-+$/, '');
  const list = [base];
  if (town && base && !`-${base}-`.includes(`-${town}-`)) list.push(cut(`${base}-${town}`));
  if (base) list.push(cut(`${base.slice(0, 30)}-2`), cut(`${base.slice(0, 30)}-3`));
  return [...new Set(list)].filter((slug) => slug && !signupSlugProblem(slug));
}
