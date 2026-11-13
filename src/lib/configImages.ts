// Images de `club_settings.config` (logo, photos, fonds d'affiche) : envoi et suppression dans le
// Storage. Extrait de `SiteConfigPanel` (PR6b) pour que le fond « Aux couleurs du club » (SaaS S7)
// soit rangé exactement comme un fond ajouté depuis « Configuration du site › Affiches ».
import { supabase } from './supabase';
import { STORAGE_BUCKETS, clubPath, extractStoragePath, sanitizeFilename } from './storage';

// Décision brief §8, voie (a) : le bucket générique existant, sous `<club_id>/config/…`.
// Zéro migration — c'est ce qui garde PR6b déployable par un simple push. Un bucket dédié
// serait plus lisible, mais PR7-bis le créera quand elle aura elle-même besoin d'y mettre les
// logos et les icônes PWA.
const BUCKET = STORAGE_BUCKETS.contentImages;

// `clubPath()` est obligatoire : les policies Storage lisent le premier segment via
// `can_write_club_object(name)`, donc un chemin construit à la main serait refusé par la RLS.
// Le chemin porte l'horodatage ET le champ visé : trois images d'une même liste enregistrées
// ensemble ne peuvent pas se télescoper à la milliseconde près.
/** `path` : le champ visé dans le groupe (`logo`, `team_match_backgrounds.0.image`). */
export async function uploadConfigImage(clubId: string, path: string, file: File): Promise<string> {
  const key = clubPath(
    clubId,
    'config',
    `${Date.now()}-${sanitizeFilename(path)}-${sanitizeFilename(file.name)}`,
  );
  const { error } = await supabase.storage.from(BUCKET).upload(key, file, {
    contentType: file.type,
    cacheControl: '3600',
  });
  if (error) throw error;
  return supabase.storage.from(BUCKET).getPublicUrl(key).data.publicUrl;
}

export async function deleteConfigImage(publicUrl: string) {
  const key = extractStoragePath(BUCKET, publicUrl);
  if (!key) return;
  const { error } = await supabase.storage.from(BUCKET).remove([key]);
  // L'écriture est déjà passée : un orphelin dans le bucket ne justifie pas d'annoncer un
  // échec d'enregistrement qui n'a pas eu lieu.
  if (error) console.error('[SiteConfig] suppression de l’ancienne image impossible', error);
}
