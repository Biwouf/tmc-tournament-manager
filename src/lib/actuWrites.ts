// SaaS S5 — chemin d'écriture d'une actu, extrait d'`ActuForm` pour que les premiers pas publient
// exactement comme le formulaire (`docs/specs/ACTUS.md`). L'orchestration Facebook reste dans
// `ActuForm` : elle dépend de l'affichage de son résultat, et les premiers pas n'en ont pas.
import { supabase } from './supabase';
import type { Actu, ActuFocalPoint } from '../types';
import { STORAGE_BUCKETS, clubPath, extractStoragePath, sanitizeFilename } from './storage';

const MAX_IMAGE_SIZE = 5 * 1024 * 1024;
const ACCEPTED_IMAGE_TYPES = ['image/jpeg', 'image/png'];
const STORAGE_BUCKET = STORAGE_BUCKETS.actuImages;

export const DEFAULT_FOCAL_POINT: ActuFocalPoint = { x: 50, y: 50 };

/** Une image déjà en ligne, conservée sur l'actu. */
export type ActuImage = { url: string; focalPoint: ActuFocalPoint; caption: string };
/** Une image à envoyer dans le bucket de l'actu. */
export type NewActuImage = { file: File; focalPoint: ActuFocalPoint; caption: string };

/** Motif de refus d'une image choisie par l'utilisateur, sinon `null`. */
export function actuImageProblem(file: File): string | null {
  if (!ACCEPTED_IMAGE_TYPES.includes(file.type)) {
    return `Format non supporté pour "${file.name}" (JPEG ou PNG uniquement).`;
  }
  if (file.size > MAX_IMAGE_SIZE) return `"${file.name}" est trop lourd (max 5 Mo).`;
  return null;
}

async function uploadFile(clubId: string | null, file: File, actuId: string, index: number): Promise<string> {
  const path = clubPath(clubId, actuId, `${Date.now()}-${index}-${sanitizeFilename(file.name)}`);
  const { error } = await supabase.storage.from(STORAGE_BUCKET).upload(path, file, {
    contentType: file.type,
    cacheControl: '3600',
  });
  if (error) throw error;
  const { data } = supabase.storage.from(STORAGE_BUCKET).getPublicUrl(path);
  return data.publicUrl;
}

async function deleteStorageFiles(publicUrls: string[]) {
  const paths = publicUrls
    .map((url) => extractStoragePath(STORAGE_BUCKET, url))
    .filter((p): p is string => p !== null);
  if (paths.length > 0) {
    await supabase.storage.from(STORAGE_BUCKET).remove(paths);
  }
}

type SaveActuInput = {
  /** Absent : création. */
  id?: string;
  titre: string;
  contenu: string;
  publish: boolean;
  /** `published_at` actuel : la première publication n'est jamais écrasée. */
  alreadyPublishedAt?: string | null;
  keptImages: ActuImage[];
  newImages: NewActuImage[];
  removedUrls?: string[];
  /** Notifier les membres si l'actu est publiée. */
  notify: boolean;
  /** Appelé dès que la ligne existe : permet de ne pas recréer l'actu si la suite échoue. */
  onCreated?: (id: string) => void;
};

/** Enregistre l'actu, ses images, puis notifie. Rend son identifiant, lève en cas d'échec. */
export async function saveActu(clubId: string | null, input: SaveActuInput): Promise<string> {
  const { keptImages, newImages } = input;
  const basePayload: Partial<Actu> = {
    titre: input.titre,
    contenu: input.contenu,
    published: input.publish,
  };
  if (input.publish && !input.alreadyPublishedAt) {
    basePayload.published_at = new Date().toISOString();
  }

  let targetId = input.id;

  if (targetId) {
    const { error: updateErr } = await supabase
      .from('actus')
      .update(basePayload)
      .eq('id', targetId)
      .eq('club_id', clubId);
    if (updateErr) throw updateErr;
  } else {
    const { data, error: insertErr } = await supabase
      .from('actus')
      .insert({ ...basePayload, image_urls: [], club_id: clubId })
      .select('id')
      .single();
    if (insertErr || !data) throw insertErr ?? new Error('Insert failed');
    targetId = data.id as string;
    input.onCreated?.(targetId);
  }

  if (input.removedUrls && input.removedUrls.length > 0) {
    await deleteStorageFiles(input.removedUrls);
  }

  const uploadedUrls: string[] = [];
  for (let i = 0; i < newImages.length; i++) {
    uploadedUrls.push(await uploadFile(clubId, newImages[i].file, targetId, i));
  }

  const { error: imgErr } = await supabase
    .from('actus')
    .update({
      image_urls: [...keptImages.map((item) => item.url), ...uploadedUrls],
      image_focal_points: [...keptImages, ...newImages].map((item) => item.focalPoint),
      image_captions: [...keptImages, ...newImages].map((item) => item.caption),
    })
    .eq('id', targetId)
    .eq('club_id', clubId);
  if (imgErr) throw imgErr;

  // La notification ne bloque jamais la publication (au pire, pas de notification).
  if (input.publish && input.notify) {
    await supabase.rpc('content_push_announce', { p_club: clubId, p_kind: 'actu', p_id: targetId });
  }

  return targetId;
}

/**
 * La photo du club (`home.hero_image`) comme image d'une actu : COPIÉE dans le bucket de l'actu,
 * parce que l'écran de configuration supprime l'ancienne photo quand on la remplace
 * (`SiteConfigPanel`) — une simple référence laisserait l'actu avec une image cassée. La copie
 * part aussi avec l'actu si on la supprime. Copie impossible : l'URL d'origine, plutôt que rien.
 */
export async function clubPhotoForActu(
  url: string,
  focalPoint: ActuFocalPoint = DEFAULT_FOCAL_POINT,
): Promise<{ keptImages: ActuImage[]; newImages: NewActuImage[] }> {
  try {
    const response = await fetch(url);
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const blob = await response.blob();
    const name = new URL(url).pathname.split('/').pop() || 'photo-du-club';
    const file = new File([blob], name, { type: blob.type });
    return { keptImages: [], newImages: [{ file, focalPoint, caption: '' }] };
  } catch (err) {
    console.warn('[actuWrites] copie de la photo du club impossible', err);
    return { keptImages: [{ url, focalPoint, caption: '' }], newImages: [] };
  }
}
