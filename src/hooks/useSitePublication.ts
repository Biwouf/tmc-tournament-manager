// SaaS S8 — « Site publié » d'un club self-serve : lu sur `clubs`, écrit par la RPC
// `club_set_site_published` (la colonne n'est pas modifiable par `authenticated`).
// Le club du contexte est lu une fois au chargement du BO : la valeur est relue à chaque montage
// pour qu'une publication depuis le tableau de bord se voie dans `/admin/site`, et inversement.
import { useEffect, useState } from 'react';
import { supabase } from '../lib/supabase';
import type { Club } from '../contexts/ClubContext';

export function useSitePublication(club: Club | null) {
  const clubId = club?.id ?? null;
  const [published, setPublished] = useState(club?.site_published ?? false);
  useEffect(() => {
    if (!clubId) return;
    let cancelled = false;
    void supabase.from('clubs').select('site_published').eq('id', clubId).maybeSingle().then(({ data }) => {
      if (!cancelled && data) setPublished(Boolean(data.site_published));
    });
    return () => { cancelled = true; };
  }, [clubId]);

  /** Rend le message d'erreur, sinon null. */
  const setSitePublished = async (value: boolean): Promise<string | null> => {
    if (!clubId) return 'Club introuvable.';
    const { data, error } = await supabase.rpc('club_set_site_published', { p_club: clubId, p_published: value });
    if (error) return error.message || 'Enregistrement impossible. Réessayez.';
    setPublished(Boolean(data));
    return null;
  };
  return { published, setSitePublished };
}
