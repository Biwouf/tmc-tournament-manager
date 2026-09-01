// Multi-tenant — PR6a : chemins Storage préfixés par club (D12).
//
// Avant cette PR, `extractStoragePath` était recopié à l'identique dans 5 fichiers, chacun
// fermant sur son `STORAGE_BUCKET` local, et `sanitizeFilename` dans 4. Changer la convention
// de chemins sans mutualiser d'abord, c'était 5 occasions de diverger.
//
// Convention (MULTI_TENANT.md D12) — premier segment = club_id, le reste inchangé :
//   actu-images/<club_id>/<actuId>/<ts>-<i>-<nom>
//   event-images/<club_id>/<eventId>/<ts>-<nom>
//   team-match-photos/<club_id>/<rencontreId>/<ts>-<nom>
//   content-images/<club_id>/inline/<ts>-<nom>
//
// Les policies Storage de 20260822_config_storage_tenant.sql lisent ce premier segment : un
// chemin construit à la main hors de ce module sera refusé par la RLS.

export const STORAGE_BUCKETS = {
  actuImages: 'actu-images',
  eventImages: 'event-images',
  teamMatchPhotos: 'team-match-photos',
  contentImages: 'content-images',
} as const;

export type StorageBucket = (typeof STORAGE_BUCKETS)[keyof typeof STORAGE_BUCKETS];

/** Rend un nom de fichier sûr pour une clé Storage (ASCII minuscule, tirets). */
export function sanitizeFilename(name: string): string {
  return name.toLowerCase().replace(/[^a-z0-9.-]/g, '-').replace(/-+/g, '-');
}

/**
 * Construit une clé Storage préfixée par le club.
 * `segments` = le chemin métier tel qu'il existait avant PR6a (id d'entité, `inline`, nom…).
 *
 * `clubId` est typé nullable parce que `useClub()` l'expose ainsi, mais il ne peut pas l'être
 * ici : ClubContext.tsx:110 (garde PR3) empêche l'app de monter sans club. On lève plutôt que
 * de faire porter une branche défensive aux 4 appelants — et surtout plutôt que d'uploader
 * sous `null/…`, qui passerait la RLS legacy (« 1er segment non-UUID ») et polluerait le
 * bucket sans que personne le voie.
 */
export function clubPath(clubId: string | null, ...segments: string[]): string {
  if (!clubId) throw new Error('clubPath : clubId manquant — upload impossible hors contexte club.');
  return [clubId, ...segments].join('/');
}

/**
 * Extrait la clé Storage d'une URL publique, ou `null` si l'URL ne pointe pas ce bucket.
 *
 * Renvoie le chemin tel qu'il est stocké — donc AVEC le préfixe club pour les objets créés
 * depuis PR6a, et SANS pour les objets legacy. C'est voulu : `.remove()` attend la clé réelle,
 * et la clause « grandfather » des policies couvre les seconds (cf. §5 de la migration).
 */
export function extractStoragePath(bucket: StorageBucket, publicUrl: string): string | null {
  const marker = `/storage/v1/object/public/${bucket}/`;
  const idx = publicUrl.indexOf(marker);
  if (idx === -1) return null;
  return publicUrl.slice(idx + marker.length);
}
