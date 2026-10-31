// SaaS S3 — images du tunnel d'inscription, préparées dans le navigateur avant l'envoi.
// `club-signup` refuse au-delà de 5 Mo et hors PNG / JPEG / WebP (pas de SVG) : une photo de
// téléphone est réduite à 2400 px de côté et recompressée ici, orientation EXIF appliquée.
import { extractPalette } from './clubSignup';

export const SIGNUP_IMAGE_TYPES = ['image/png', 'image/jpeg', 'image/webp'];
const MAX_SIDE = 2400;
const MAX_BYTES = 5 * 1024 * 1024;

const toBlob = (canvas: HTMLCanvasElement, type: string, quality?: number) =>
  new Promise<Blob | null>(resolve => canvas.toBlob(resolve, type, quality));

const toDataUrl = (blob: Blob) => new Promise<string>((resolve, reject) => {
  const reader = new FileReader();
  reader.onload = () => resolve(String(reader.result));
  reader.onerror = () => reject(new Error('Image illisible.'));
  reader.readAsDataURL(blob);
});

/**
 * Fichier choisi → data URL WebP (ou, si le navigateur n'encode pas le WebP, PNG pour un logo
 * qui garde sa transparence, JPEG pour une photo). Lève une erreur au message affichable.
 */
export async function prepareSignupImage(file: File, kind: 'logo' | 'photo'): Promise<{ dataUrl: string; palette: string[] }> {
  if (!SIGNUP_IMAGE_TYPES.includes(file.type)) throw new Error('Format non accepté : choisissez un PNG, un JPEG ou un WebP.');
  const bitmap = await createImageBitmap(file, { imageOrientation: 'from-image' }).catch(() => {
    throw new Error('Image illisible : essayez un autre fichier.');
  });
  const scale = Math.min(1, MAX_SIDE / Math.max(bitmap.width, bitmap.height));
  const canvas = document.createElement('canvas');
  canvas.width = Math.max(1, Math.round(bitmap.width * scale));
  canvas.height = Math.max(1, Math.round(bitmap.height * scale));
  canvas.getContext('2d')!.drawImage(bitmap, 0, 0, canvas.width, canvas.height);

  let palette: string[] = [];
  if (kind === 'logo') {
    // La couleur du club se lit sur une vignette 48 × 48 : assez pour les teintes dominantes.
    const thumb = document.createElement('canvas');
    thumb.width = 48; thumb.height = 48;
    const ctx = thumb.getContext('2d', { willReadFrequently: true })!;
    ctx.drawImage(bitmap, 0, 0, 48, 48);
    palette = extractPalette(ctx.getImageData(0, 0, 48, 48).data);
  }
  bitmap.close();

  let blob = await toBlob(canvas, 'image/webp', 0.88);
  if (!blob || blob.type !== 'image/webp') {
    blob = kind === 'logo' ? await toBlob(canvas, 'image/png') : await toBlob(canvas, 'image/jpeg', 0.85);
  }
  if (!blob) throw new Error('Image illisible : essayez un autre fichier.');
  if (blob.size > MAX_BYTES) throw new Error('Image trop lourde, même réduite (5 Mo maximum).');
  return { dataUrl: await toDataUrl(blob), palette };
}

/** Data URL conservée → `Blob` à envoyer. */
export async function dataUrlToBlob(dataUrl: string): Promise<Blob> {
  return (await fetch(dataUrl)).blob();
}
