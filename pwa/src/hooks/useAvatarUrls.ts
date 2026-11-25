import { useQueries } from '@tanstack/react-query';
import { supabase } from '../lib/supabase';
import type { AvatarSize } from '../components/Avatar';

const TTL_SECONDS = 60 * 60;
const FRESH_MS = 50 * 60_000;

type Waiting = { resolve: (url: string | null) => void; reject: (error: unknown) => void };
let batch = new Map<string, Waiting>();

async function flush() {
  const waiting = batch;
  batch = new Map();
  try {
    const { data, error } = await supabase.storage.from('avatars').createSignedUrls([...waiting.keys()], TTL_SECONDS);
    if (error) throw error;
    const urls = new Map(data.map(item => [item.path, item.error ? null : item.signedUrl]));
    // Photo absente ou non visible de la personne : `null`, les initiales restent.
    waiting.forEach(({ resolve }, name) => resolve(urls.get(name) || null));
  } catch (error) {
    waiting.forEach(({ reject }) => reject(error));
  }
}

/**
 * Signe un fichier ; toutes les demandes du même rendu partent en un seul appel. Un court délai,
 * pas une microtâche : nouvelles tentatives et rafraîchissements viennent de minuteries distinctes.
 */
function sign(name: string) {
  return new Promise<string | null>((resolve, reject) => {
    if (!batch.size) setTimeout(flush, 10);
    batch.set(name, { resolve, reject });
  });
}

/**
 * URLs signées (1 h) de photos de profil, par chemin `{user}/{version}`. Fichier de 128 px
 * jusqu'à 40 px affichés, 512 au-delà. Une photo absente de la table garde les initiales.
 */
export function useAvatarUrls(paths: (string | null | undefined)[], size: AvatarSize): Map<string, string> {
  const unique = [...new Set(paths.filter((path): path is string => !!path))];
  const results = useQueries({
    queries: unique.map(path => {
      const name = `${path}-${size <= 40 ? 128 : 512}`;
      return { queryKey: ['avatar-url', name], queryFn: () => sign(name), staleTime: FRESH_MS, refetchInterval: FRESH_MS };
    }),
  });
  return new Map(unique.flatMap((path, i) => (results[i].data ? [[path, results[i].data] as const] : [])));
}
