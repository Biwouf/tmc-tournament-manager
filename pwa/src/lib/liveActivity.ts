import { supabase } from './supabase';
import type { LiveMatch } from '../types';

export type LivePost = {
  id: string;
  sequence: number;
  kind: 'message' | 'poll' | 'photo';
  body: string;
  image_path: string | null;
  author_name: string;
  created_at: string;
  score: Partial<LiveMatch>;
  options: string[];
  closed: boolean;
  my_vote: number | null;
  total: number;
  counts: number[] | null;
  my_reaction: string | null;
  /** Une entrée par emoji ; `names` est null pour un visiteur non connecté. */
  reactions: { emoji: string; count: number; names: string[] | null }[];
};
export type LiveActivityPage = {
  items: LivePost[];
  before: number | null;
  has_more: boolean;
  can_animate: boolean;
};
export const LIVE_REACTIONS = [
  ['👏', 'Applaudir'],
  ['🔥', 'Quel match !'],
  ['💪', 'Encourager'],
  ['❤️', 'Soutenir'],
  ['😮', 'Incroyable'],
  ['🎉', 'Célébrer'],
] as const;
export async function readActivity(
  match: string,
  club: string,
  before: number | null,
): Promise<LiveActivityPage> {
  const { data, error } = await supabase
    .rpc('live_activity_page', {
      p_match: match,
      p_club: club,
      p_before: before,
    })
    .abortSignal(AbortSignal.timeout(15000));
  if (error) throw new Error(error.message);
  return data as LiveActivityPage;
}
export async function activityCommand(
  match: string,
  club: string,
  action: string,
  input: Record<string, unknown>,
) {
  const { data, error } = await supabase
    .rpc('live_activity_command', {
      p_match: match,
      p_club: club,
      p_action: action,
      p_data: input,
    })
    .abortSignal(AbortSignal.timeout(15000));
  if (error) throw new Error(error.message);
  return data as { id: string };
}

const LIVE_IMAGES = 'live-images';
const MAX_SIDE = 1600;
export const livePhotoPath = (club: string, match: string, post: string) =>
  `${club}/${match}/${post}.jpg`;
export const livePhotoUrl = (path: string) =>
  supabase.storage.from(LIVE_IMAGES).getPublicUrl(path).data.publicUrl;
/** Réduit la photo (1600 px de côté max) et la convertit en JPEG, orientation EXIF appliquée. */
export async function compressPhoto(file: File): Promise<Blob> {
  const bitmap = await createImageBitmap(file, {
    imageOrientation: 'from-image',
  }).catch(() => {
    throw new Error('Choisissez une image.');
  });
  const scale = Math.min(1, MAX_SIDE / Math.max(bitmap.width, bitmap.height));
  const canvas = document.createElement('canvas');
  canvas.width = Math.round(bitmap.width * scale);
  canvas.height = Math.round(bitmap.height * scale);
  canvas.getContext('2d')!.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
  bitmap.close();
  const blob = await new Promise<Blob | null>((resolve) =>
    canvas.toBlob(resolve, 'image/jpeg', 0.82),
  );
  if (!blob) throw new Error('Photo illisible.');
  return blob;
}
export async function uploadLivePhoto(path: string, photo: Blob) {
  const { error } = await supabase.storage
    .from(LIVE_IMAGES)
    .upload(path, photo, { contentType: 'image/jpeg', upsert: false });
  // 409 : déjà reçue lors d'une tentative interrompue, le chemin est unique par publication.
  if (error && !('statusCode' in error && error.statusCode === '409'))
    throw new Error('Envoi de la photo impossible.');
}
export async function removeLivePhoto(path: string) {
  await supabase.storage.from(LIVE_IMAGES).remove([path]);
}

/**
 * Rafraîchit la première page chargée du fil à partir d'une lecture de tête (`p_before` nul),
 * sans recharger les pages plus anciennes. La première page couvre toutes les séquences
 * ≥ `first.before` : la tête y remplace ce qu'elle couvre (ajouts, mises à jour, suppressions),
 * les éléments plus anciens que la tête restent. `before` / `has_more` sont conservés, la page
 * suivante garde donc son curseur.
 */
export function mergeActivityHead(
  first: LiveActivityPage,
  head: LiveActivityPage,
): LiveActivityPage {
  const floor = first.before ?? -Infinity;
  const covered = head.before ?? -Infinity;
  return {
    ...first,
    can_animate: head.can_animate,
    items: [
      ...first.items.filter((p) => p.sequence < covered),
      ...head.items.filter((p) => p.sequence >= floor),
    ].sort((a, b) => a.sequence - b.sequence),
  };
}
