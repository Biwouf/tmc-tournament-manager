import { supabase } from './supabase';

const BUCKET = 'content-images';

/**
 * Valeur d'image de la config → URL affichable, ou `null`.
 *
 * Le BO écrit des URL publiques complètes (`SiteConfigPanel` → `getPublicUrl`), mais le
 * contrat de lecture décrit la valeur comme « clé Storage OU URL publique » : on accepte les
 * deux. Le bucket `content-images` est public en lecture, aucune signature n'est nécessaire.
 *
 * `null` quand la valeur est vide — et `null` MASQUE le bloc appelant plutôt que de rendre une
 * `<img>` sans `src` (règle du brief §10 : une valeur absente n'affiche pas un trou).
 */
export function configImageUrl(value: string | undefined): string | null {
  if (!value) return null;
  if (/^https?:\/\//.test(value)) return value;
  return supabase.storage.from(BUCKET).getPublicUrl(value).data.publicUrl;
}
