// Visuels « Esprit d'équipe » insérés dans le corps d'une actu générée (`ActuGeneratePage`).
// Module sans dépendance, testé par `npm run test:post-generation`.

const normalize = (value: string) =>
  value.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/\s+/g, ' ').trim();

/** Ligne la plus longue d'un paragraphe : la plus distinctive, et la plus susceptible de survivre à une retouche. */
const longestLine = (paragraph: string) =>
  paragraph.split('\n').map(normalize).sort((a, b) => b.length - a.length)[0] ?? '';

/**
 * Paragraphe d'accroche d'une image : celui que Claude a désigné pour la rencontre (`anchor`,
 * renvoyé par generate-post), retrouvé tel quel ou par sa ligne la plus longue si l'admin a
 * retouché le reste ; sinon celui qui cite le mieux l'adversaire (`opponentIndex`) ; sinon
 * l'avant-dernier (avant le remerciement final), ou le seul.
 */
function anchorIndex(paragraphs: string[], { anchor, adversaire }: { anchor?: string; adversaire: string }) {
  const normalized = paragraphs.map(normalize);
  if (anchor) {
    const exact = normalized.indexOf(normalize(anchor));
    if (exact !== -1) return exact;
    const line = longestLine(anchor);
    const partial = line.length >= 12 ? normalized.findIndex(p => p.includes(line)) : -1;
    if (partial !== -1) return partial;
  }
  const cited = opponentIndex(paragraphs, adversaire);
  return cited !== -1 ? cited : Math.max(paragraphs.length - 2, 0);
}

const words = (value: string) => normalize(value).replace(/[^a-z0-9]+/g, ' ').trim().split(' ').filter(Boolean);
/** Mots des noms Ten'Up qui ne désignent pas le club adverse : le texte ne les reprend pas. */
const GENERIC = new Set(['tennis', 'club', 'association', 'padel', 'sporting', 'union', 'stade', 'olympique', 'racing']);

/**
 * Paragraphe qui cite l'adversaire, -1 si aucun. Ten'Up nomme « BEAUMONT DE LOMAGNE TENNIS
 * CLUB 5 », Claude écrit « Beaumont-de-Lomagne 5 » : on compare les mots significatifs (ni
 * générique, ni de moins de 3 lettres) ; le numéro d'équipe collé à l'un d'eux départage deux
 * rencontres contre le même club (Léojac 1 / Léojac 2). À égalité, le premier.
 */
function opponentIndex(paragraphs: string[], adversaire: string) {
  const name = words(adversaire);
  const number = /^\d+$/.test(name.at(-1) ?? '') ? name.at(-1) : null;
  const core = name.filter(w => w.length >= 3 && !GENERIC.has(w) && !/^\d+$/.test(w));
  let best = -1, bestScore = 0;
  paragraphs.forEach((paragraph, index) => {
    const text = words(paragraph);
    const hits = core.filter(w => text.includes(w)).length;
    const numbered = number !== null && text.some((w, i) => w === number && core.includes(text[i - 1]));
    const score = hits === 0 ? 0 : hits * 2 + (numbered ? 1 : 0);
    if (score > bestScore) { best = index; bestScore = score; }
  });
  return best;
}

/** Insère chaque image en Markdown (`![](url)`, paragraphe à part) après son paragraphe d'accroche. */
export function insertInlineImages(text: string, images: { anchor?: string; adversaire: string; url: string }[]): string {
  const paragraphs = text.trim().split(/\n{2,}/);
  const after = new Map<number, string[]>();
  for (const image of images) {
    const index = anchorIndex(paragraphs, image);
    after.set(index, [...(after.get(index) ?? []), `![](${image.url})`]);
  }
  return paragraphs.flatMap((paragraph, index) => [paragraph, ...(after.get(index) ?? [])]).join('\n\n');
}
