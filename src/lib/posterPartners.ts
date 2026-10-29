// Partenaires sur les affiches (programmation TMC, résultat par équipe) : 10 au plus.
// L'ordre est toujours tiré au hasard (au-delà de 10, le tirage choisit aussi lesquels) :
// sinon les premiers partenaires de /admin/site gardaient toujours les mêmes places.
// Le tirage dépend d'une graine : même graine → même sélection, ce qui garde l'aperçu
// identique à l'export tant que l'utilisateur ne demande pas un autre tirage.

export const MAX_POSTER_PARTNERS = 10;

export function newPartnerSeed(): number {
  return Math.floor(Math.random() * 2 ** 32);
}

/** Générateur pseudo-aléatoire déterministe (mulberry32). */
function seededRandom(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Retient au plus `MAX_POSTER_PARTNERS` éléments tirés selon `seed`, dans l'ordre du tirage. */
export function drawPosterPartners<T>(items: T[], seed: number): T[] {
  const count = Math.min(items.length, MAX_POSTER_PARTNERS);
  const random = seededRandom(seed);
  const indexes = items.map((_, index) => index);
  // Fisher-Yates partiel : seules les `count` premières positions sont tirées.
  for (let i = 0; i < count; i++) {
    const j = i + Math.floor(random() * (indexes.length - i));
    [indexes[i], indexes[j]] = [indexes[j], indexes[i]];
  }
  return indexes.slice(0, count).map(index => items[index]);
}
