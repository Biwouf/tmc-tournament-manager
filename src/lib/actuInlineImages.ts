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
 * retouché le reste ; sinon le premier qui cite l'adversaire ; sinon l'avant-dernier (avant le
 * remerciement final), ou le seul.
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
  const name = normalize(adversaire);
  const cited = name ? normalized.findIndex(p => p.includes(name)) : -1;
  return cited !== -1 ? cited : Math.max(paragraphs.length - 2, 0);
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
