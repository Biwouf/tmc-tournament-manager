// Partenaires sur les affiches (programmation TMC, résultat par équipe) : 10 au plus.
// Au-delà, un tirage aléatoire en retient 10, affichés dans l'ordre de /admin/site.
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

/** Retient `MAX_POSTER_PARTNERS` éléments tirés selon `seed`, dans leur ordre d'origine. */
export function drawPosterPartners<T>(items: T[], seed: number): T[] {
  if (items.length <= MAX_POSTER_PARTNERS) return items;
  const random = seededRandom(seed);
  const indexes = items.map((_, index) => index);
  // Fisher-Yates partiel : seules les MAX premières positions sont tirées.
  for (let i = 0; i < MAX_POSTER_PARTNERS; i++) {
    const j = i + Math.floor(random() * (indexes.length - i));
    [indexes[i], indexes[j]] = [indexes[j], indexes[i]];
  }
  const kept = new Set(indexes.slice(0, MAX_POSTER_PARTNERS));
  return items.filter((_, index) => kept.has(index));
}
