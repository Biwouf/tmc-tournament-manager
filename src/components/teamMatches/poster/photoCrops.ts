import { useEffect, useRef, useState } from 'react';
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

/** `local` : image importée, dont le cadrage n'est pas enregistré. */
export type CropSaveStatus = 'local' | 'idle' | 'saving' | 'saved' | 'error';

/**
 * Enregistre le cadrage d'une photo de la rencontre 1 s après le dernier réglage ; tout de suite
 * si la photo change ou si le composant est démonté (aperçu fermé) avant ce délai.
 */
export function useCropAutoSave(clubId: string | null, rencontre: Pick<TeamRencontre, 'id' | 'photo_crops' | 'photo_urls'>, photo: string, crop: PhotoCrop): CropSaveStatus {
  const savable = rencontre.photo_urls.includes(photo);
  const [state, setState] = useState<{ photo: string; status: CropSaveStatus }>({ photo, status: 'idle' });
  const pending = useRef<(() => void) | null>(null);
  // Déclaré avant le debounce : au changement de photo, ce nettoyage part avant celui qui annule le minuteur.
  useEffect(() => () => pending.current?.(), [photo]);
  useEffect(() => {
    const saved = savedPhotoCrop(rencontre, photo);
    if (!savable || (saved.x === crop.x && saved.y === crop.y && saved.zoom === crop.zoom)) { pending.current = null; return; }
    const save = () => {
      pending.current = null;
      setState({ photo, status: 'saving' });
      savePhotoCrop(clubId, rencontre, photo, crop).then(() => setState({ photo, status: 'saved' }), () => setState({ photo, status: 'error' }));
    };
    pending.current = save;
    const timer = window.setTimeout(save, 1000);
    return () => clearTimeout(timer);
  }, [crop, photo, savable, clubId, rencontre]);
  if (!savable) return 'local';
  return state.photo === photo ? state.status : 'idle';
}
