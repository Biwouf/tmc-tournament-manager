/** Photo (HEIC compris) → bitmap, orientation EXIF appliquée. */
export async function decodePhoto(file: File): Promise<ImageBitmap> {
  try { return await createImageBitmap(file, { imageOrientation: 'from-image' }); }
  catch (error) {
    // Seul Safari décode le HEIC des iPhone : ailleurs (Chrome, Firefox), conversion par libheif,
    // chargée à la demande pour ne pas alourdir la PWA.
    const { heicTo, isHeic } = await import('heic-to');
    if (!(await isHeic(file))) throw error;
    return heicTo({ blob: file, type: 'bitmap' });
  }
}
