// Logo et partenaires des animations vidéo (tournoi, rencontres par équipes).
// Images décodées une fois en ImageBitmap, transférables au worker d'export. Elles passent par un
// <img> et un canvas : un worker (et `createImageBitmap(blob)`) ne sait pas décoder un SVG. Côté
// le plus long ramené à 512 px au plus (un SVG y est rastérisé) : le plus grand logo de la vidéo
// fait ~160 px.
const BITMAP_MAX = 512;
export async function toBitmap(url: string): Promise<ImageBitmap | null> {
  if (!url) return null;
  let src = '';
  try {
    const res = await fetch(url, { mode: 'cors' });
    if (!res.ok) return null;
    const blob = await res.blob();
    src = URL.createObjectURL(blob);
    const img = new Image();
    img.src = src;
    await img.decode();
    const nw = img.naturalWidth || BITMAP_MAX, nh = img.naturalHeight || BITMAP_MAX;
    const s = blob.type.includes('svg') ? BITMAP_MAX / Math.max(nw, nh) : Math.min(1, BITMAP_MAX / Math.max(nw, nh));
    const c = Object.assign(document.createElement('canvas'), { width: Math.max(1, Math.round(nw * s)), height: Math.max(1, Math.round(nh * s)) });
    const g = c.getContext('2d')!;
    g.imageSmoothingQuality = 'high';
    g.drawImage(img, 0, 0, c.width, c.height);
    return await createImageBitmap(c);
  } catch {
    return null;
  } finally {
    if (src) URL.revokeObjectURL(src);
  }
}
