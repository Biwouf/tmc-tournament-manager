/** Le décodeur HEIC n'a pas pu être chargé (hors ligne) : l'image n'est pas forcément illisible. */
export class PhotoNeedsNetwork extends Error {}

/** Photo (HEIC compris) → bitmap. L'orientation EXIF est appliquée par défaut (`from-image`). */
export async function decodePhoto(file: File): Promise<ImageBitmap> {
  try { return await createImageBitmap(file); }
  catch (error) {
    // Seul Safari décode le HEIC des iPhone : ailleurs (Chrome, Firefox), conversion par libheif,
    // chargée à la demande pour ne pas alourdir la PWA.
    const { heicTo, isHeic } = await import('heic-to').catch(() => { throw new PhotoNeedsNetwork(); });
    if (!(await isHeic(file))) throw error;
    return heicTo({ blob: file, type: 'bitmap' });
  }
}
