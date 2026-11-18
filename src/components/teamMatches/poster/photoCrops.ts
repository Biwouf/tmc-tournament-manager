import { supabase } from '../../../lib/supabase';
import type { PhotoCrop, TeamRencontre } from '../../../types';

export const DEFAULT_PHOTO_CROP: PhotoCrop = { x: 50, y: 50, zoom: 1 };

/** Cadrages enregistrés depuis cet onglet : les listes déjà chargées (grille de /medias, actu) ne sont pas rechargées. */
const written = new Map<string, Record<string, PhotoCrop>>();

function crops(rencontre: Pick<TeamRencontre, 'id' | 'photo_crops'>): Record<string, PhotoCrop> {
  return { ...rencontre.photo_crops, ...written.get(rencontre.id) };
}

/** Cadrage enregistré d'une photo de la rencontre, ou le cadrage centré par défaut. */
export function savedPhotoCrop(rencontre: Pick<TeamRencontre, 'id' | 'photo_crops'>, url: string): PhotoCrop {
  return crops(rencontre)[url] ?? DEFAULT_PHOTO_CROP;
}

/** Écritures en file : un enregistrement lent ne peut pas écraser un cadrage plus récent. */
let queue: Promise<unknown> = Promise.resolve();

export function savePhotoCrop(clubId: string | null, rencontre: Pick<TeamRencontre, 'id' | 'photo_crops'>, url: string, crop: PhotoCrop) {
  const run = queue.catch(() => {}).then(async () => {
    const next = { ...crops(rencontre), [url]: crop };
    const { error } = await supabase.from('team_rencontres').update({ photo_crops: next }).eq('id', rencontre.id).eq('club_id', clubId);
    if (error) throw new Error(error.message);
    written.set(rencontre.id, next);
  });
  queue = run;
  return run;
}
