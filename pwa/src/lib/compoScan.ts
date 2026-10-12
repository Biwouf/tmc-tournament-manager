import { supabase } from './supabase';
import type { CompoEntry } from './teamCompo';

// Taille conseillée par l'API pour une image : au-delà, elle est réduite côté serveur et coûte plus cher.
const MAX_EDGE = 1568;

async function decode(file: File): Promise<ImageBitmap> {
  try { return await createImageBitmap(file); }
  catch (error) {
    // Seul Safari décode le HEIC des iPhone : ailleurs (Chrome, Firefox), conversion par libheif,
    // chargée à la demande pour ne pas alourdir la PWA.
    const { heicTo, isHeic } = await import('heic-to');
    if (!(await isHeic(file))) throw error;
    return heicTo({ blob: file, type: 'bitmap' });
  }
}

/** Photo (HEIC compris) → JPEG réduit, en base64 sans préfixe. */
export async function photoToJpeg(file: File): Promise<string> {
  const bitmap = await decode(file);
  const scale = Math.min(1, MAX_EDGE / Math.max(bitmap.width, bitmap.height));
  const canvas = document.createElement('canvas');
  canvas.width = Math.round(bitmap.width * scale);
  canvas.height = Math.round(bitmap.height * scale);
  canvas.getContext('2d')!.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
  bitmap.close();
  const url = canvas.toDataURL('image/jpeg', 0.85);
  return url.slice(url.indexOf(',') + 1);
}

/** Lecture de la feuille par l'Edge Function compo-scan. */
export async function scanCompoPhoto(clubId: string, file: File): Promise<CompoEntry[]> {
  let image: string;
  try { image = await photoToJpeg(file); } catch { throw new Error('Photo illisible. Réessayez avec une autre photo.'); }
  const { data, error } = await supabase.functions.invoke('compo-scan', { body: { club_id: clubId, media_type: 'image/jpeg', image } });
  if (error) {
    const context = (error as { context?: Response }).context;
    const body = context instanceof Response ? await context.json().catch(() => null) : null;
    throw new Error(body?.error ?? 'Lecture de la photo impossible. Vérifiez la connexion ou saisissez la compo à la main.');
  }
  return (data as { joueurs: CompoEntry[] }).joueurs;
}
