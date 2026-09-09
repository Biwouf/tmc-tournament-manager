const BUCKET = 'content-images';

/**
 * Valeur d'image de la config → URL affichable, ou `null`.
 *
 * Le BO écrit des URL publiques complètes (`SiteConfigPanel` → `getPublicUrl`), mais le
 * contrat de lecture décrit la valeur comme « clé Storage OU URL publique » : on accepte les
 * deux. Le bucket `content-images` est public en lecture, aucune signature n'est nécessaire.
 *
 * `null` quand la valeur est vide — et `null` MASQUE le bloc appelant plutôt que de rendre une
 * `<img>` sans `src` (règle du brief §10 : une valeur absente n'affiche pas un trou).
 */
export function configImageUrl(value: string | undefined): string | null {
  if (!value) return null;
  if (/^https?:\/\//.test(value)) return value;
  const base = import.meta.env.VITE_SUPABASE_URL as string;
  return `${base}/storage/v1/object/public/${BUCKET}/${value.split('/').map(encodeURIComponent).join('/')}`;
}

/** Même liste de largeurs dans scripts/build.mjs (Build Output API). */
export function responsiveImage(src: string, clubId: string, width?: number): { src?: string; srcSet?: string } {
  const base = import.meta.env.VITE_SUPABASE_URL as string;
  // Aucun proxy d'URL arbitraire, aucune transformation de SVG / GIF ni du club voisin.
  if (!src.startsWith(`${base}/storage/v1/object/public/content-images/${encodeURIComponent(clubId)}/`) ||
      !/\.(?:jpe?g|png|webp|avif)$/i.test(src)) return {};
  const widths = width && width <= 96 ? [96, 192] : [480, 768, 1200, 1920];
  const url = (w: number) => `/_vercel/image?url=${encodeURIComponent(src)}&w=${w}&q=75`;
  return { src: url(widths[widths.length - 2]), srcSet: widths.map(w => `${url(w)} ${w}w`).join(', ') };
}
