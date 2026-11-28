// Photo de profil (brief compte/profil §5.3) : recadrage et export locaux, envoi, corbeille.
import { decodePhoto } from './decodePhoto';
import { supabase } from './supabase';
import { courseRpc, type CourseContext } from './courses';
import { ACCOUNT_COPY as T } from '../../../shared/accountCopy.mjs';

const BUCKET = 'avatars';
const MIN_SIDE = 200;
const PREVIEW_SIDE = 1280;
export const MAX_ZOOM = 4;

/** Même règle que `is_minor` en base ; `null` : année inconnue, à demander avant la première photo. */
export function isMinor(birthYear: number | null | undefined): boolean | null {
  if (birthYear == null) return null;
  return currentYear() - birthYear <= 18;
}
export const currentYear = () =>
  Number(new Intl.DateTimeFormat('fr-FR', { timeZone: 'Europe/Paris', year: 'numeric' }).format(new Date()));

// ── Recadrage ───────────────────────────────────────────────────────────────

/** Photo ouverte : le bitmap sert à l'export, `url` (copie réduite) à l'affichage. */
export type OpenedPhoto = { bitmap: ImageBitmap; width: number; height: number; url: string };
/** Centre du carré recadré, en pixels de la photo ; `zoom` de 1 (plus grand cercle possible) à 4. */
export type Crop = { x: number; y: number; zoom: number };
type Size = { width: number; height: number };

export const cropSide = ({ width, height }: Size, { zoom }: Crop) => Math.min(width, height) / zoom;

/** Garde le cercle dans la photo et le zoom dans ses bornes. */
export function clampCrop(size: Size, crop: Crop): Crop {
  const zoom = Math.min(MAX_ZOOM, Math.max(1, crop.zoom));
  const half = cropSide(size, { ...crop, zoom }) / 2;
  const within = (value: number, max: number) => Math.min(max - half, Math.max(half, value));
  return { x: within(crop.x, size.width), y: within(crop.y, size.height), zoom };
}
export const initialCrop = ({ width, height }: Size): Crop => ({ x: width / 2, y: height / 2, zoom: 1 });

function drawn(width: number, height: number, draw: (context: CanvasRenderingContext2D) => void) {
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const context = canvas.getContext('2d')!;
  // Fond blanc sous une image transparente (le JPEG la rendrait noire).
  context.fillStyle = '#fff';
  context.fillRect(0, 0, width, height);
  context.imageSmoothingQuality = 'high';
  draw(context);
  return canvas;
}
const toBlob = (canvas: HTMLCanvasElement, type: string, quality: number) =>
  new Promise<Blob | null>(resolve => canvas.toBlob(resolve, type, quality));

/** WebP ; JPEG si le navigateur ne sait pas en produire (Safari rend alors un PNG). */
async function encode(canvas: HTMLCanvasElement): Promise<Blob> {
  const webp = await toBlob(canvas, 'image/webp', 0.82);
  const blob = webp?.type === 'image/webp' ? webp : await toBlob(canvas, 'image/jpeg', 0.85);
  if (!blob) throw new Error(T.photoUnreadable);
  return blob;
}

/** Ouvre le fichier choisi. Erreur affichable : illisible, ou moins de 200 px de côté. */
export async function openPhoto(file: File): Promise<OpenedPhoto> {
  const bitmap = await decodePhoto(file).catch(() => { throw new Error(T.photoUnreadable); });
  try {
    const { width, height } = bitmap;
    if (Math.min(width, height) < MIN_SIDE) throw new Error(T.photoTooSmall);
    const scale = Math.min(1, PREVIEW_SIDE / Math.max(width, height));
    const canvas = drawn(Math.round(width * scale), Math.round(height * scale),
      context => context.drawImage(bitmap, 0, 0, context.canvas.width, context.canvas.height));
    const preview = await toBlob(canvas, 'image/jpeg', 0.85);
    if (!preview) throw new Error(T.photoUnreadable);
    return { bitmap, width, height, url: URL.createObjectURL(preview) };
  } catch (error) {
    bitmap.close();
    throw error;
  }
}
export function closePhoto(photo: OpenedPhoto) {
  photo.bitmap.close();
  URL.revokeObjectURL(photo.url);
}

/** Les deux fichiers envoyés ; ré-encodés, donc sans EXIF (GPS compris). L'original ne part jamais. */
export type AvatarFiles = Record<512 | 128, Blob>;

export async function exportAvatar(photo: OpenedPhoto, crop: Crop): Promise<AvatarFiles> {
  const side = cropSide(photo, crop);
  const large = drawn(512, 512, context =>
    context.drawImage(photo.bitmap, crop.x - side / 2, crop.y - side / 2, side, side, 0, 0, 512, 512));
  const small = drawn(128, 128, context => context.drawImage(large, 0, 0, 128, 128));
  return { 512: await encode(large), 128: await encode(small) };
}

// ── Envoi et RPC ────────────────────────────────────────────────────────────

/** `XMLHttpRequest` : seul moyen de suivre l'avancement d'un envoi. */
function putFile(name: string, file: Blob, token: string, onSent: (bytes: number) => void) {
  return new Promise<void>((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    const failed = () => reject(new Error(T.photoFailed));
    xhr.open('POST', `${import.meta.env.VITE_SUPABASE_URL}/storage/v1/object/${BUCKET}/${name}`);
    xhr.timeout = 30000;
    xhr.setRequestHeader('apikey', import.meta.env.VITE_SUPABASE_ANON_KEY);
    xhr.setRequestHeader('Authorization', `Bearer ${token}`);
    xhr.setRequestHeader('Content-Type', file.type);
    xhr.setRequestHeader('Cache-Control', 'max-age=3600');
    xhr.upload.onprogress = event => onSent(Math.min(event.loaded, file.size));
    xhr.onerror = failed;
    xhr.ontimeout = failed;
    xhr.onload = () => {
      // Déjà reçu lors d'un essai interrompu : le nom est unique par version.
      const duplicate = xhr.status === 409 || /"statusCode"\s*:\s*"409"/.test(xhr.responseText);
      if (duplicate || (xhr.status >= 200 && xhr.status < 300)) resolve();
      else failed();
    };
    xhr.send(file);
  });
}

/** Envoie les deux tailles ; `onProgress` reçoit un pourcentage entier, 100 une fois tout envoyé. */
export async function uploadAvatar(path: string, files: AvatarFiles, onProgress: (percent: number) => void) {
  const { data } = await supabase.auth.getSession();
  if (!data.session) throw new Error(T.photoFailed);
  const total = files[512].size + files[128].size;
  let done = 0;
  for (const size of [512, 128] as const) {
    await putFile(`${path}-${size}`, files[size], data.session.access_token,
      sent => onProgress(Math.floor(((done + sent) / total) * 100)));
    done += files[size].size;
  }
  onProgress(100);
}

export const setAvatar = (path: string) => courseRpc<string | null>('profile_set_avatar', { p_version: path.split('/')[1] });
export const clearAvatar = () => courseRpc<string | null>('profile_clear_avatar', {});
export const setBirthYear = (year: number) => courseRpc<number>('profile_set_birth_year', { p_year: year });

/** Photo en cours, relue en base (jamais le cache) ; lève une erreur si elle ne peut pas l'être. */
export async function currentAvatar(clubId: string): Promise<string | null> {
  const { profile } = await courseRpc<CourseContext>('course_my_context', { p_club: clubId });
  return profile?.avatar_path ?? null;
}

// ── Corbeille ───────────────────────────────────────────────────────────────
// Versions à supprimer, notées sur l'appareil avant d'agir : si l'app est fermée pendant l'envoi ou
// le toast « Annuler », elles partent à la prochaine ouverture de « Mon compte ».

const trashKey = (userId: string) => `avatar-trash:${userId}`;
/** Versions en cours d'envoi, ou qu'« Annuler » peut encore remettre. */
const held = new Set<string>();

function readTrash(userId: string): string[] {
  try {
    const list = JSON.parse(localStorage.getItem(trashKey(userId)) ?? '[]');
    return Array.isArray(list) ? list.filter(path => typeof path === 'string' && path.startsWith(`${userId}/`)) : [];
  } catch { return []; }
}
function writeTrash(userId: string, paths: string[]) {
  try {
    if (paths.length) localStorage.setItem(trashKey(userId), JSON.stringify(paths));
    else localStorage.removeItem(trashKey(userId));
  } catch { /* best effort */ }
}

/** Note une version à supprimer plus tard, et la retient jusqu'à `releaseAvatar`. */
export function holdAvatar(path: string) {
  const userId = path.split('/')[0];
  held.add(path);
  writeTrash(userId, [...new Set([...readTrash(userId), path])]);
}
export const releaseAvatar = (path: string) => { held.delete(path); };

/** Supprime les versions notées et non retenues, sauf la photo en cours ; en cas d'échec, plus tard. */
export async function emptyAvatarTrash(userId: string, clubId: string) {
  const paths = readTrash(userId).filter(path => !held.has(path));
  if (!paths.length) return;
  try {
    const current = await currentAvatar(clubId);
    // Pendant la lecture, « Annuler » a pu retenir une version à nouveau.
    const done = paths.filter(path => !held.has(path));
    const dead = done.filter(path => path !== current);
    if (dead.length) {
      const { error } = await supabase.storage.from(BUCKET).remove(dead.flatMap(path => [`${path}-512`, `${path}-128`]));
      if (error) return;
    }
    writeTrash(userId, readTrash(userId).filter(path => !done.includes(path)));
  } catch { /* hors ligne : à la prochaine ouverture */ }
}
