// Multi-tenant — PR6a : lecture de la config du club courant (MULTI_TENANT.md §6.1).
//
// Hook autonome plutôt qu'un provider dans ClubContext : ce dernier est explicitement
// dupliqué avec `pwa/src/contexts/ClubContext.tsx` (« garder les deux synchronisés »), or la
// PWA n'a aucun usage de la config et reste hors périmètre de cette PR. Y greffer la lecture
// forcerait soit une divergence, soit un changement PWA gratuit.
//
// PR6b (formulaires) et PR9 (vitrine) sont les premiers consommateurs. Si plusieurs écrans
// finissent par monter ce hook en parallèle, le promouvoir en provider — pas avant.
import { useEffect, useState } from 'react';
import { supabase } from '../lib/supabase';
import { useClub } from '../contexts/ClubContext';
import { defaultClubConfig, parseClubConfig, type ClubConfig } from '../lib/clubConfig';

type UseClubConfigResult = {
  config: ClubConfig;
  loading: boolean;
  /** Rechargement après écriture (PR6b). */
  reload: () => void;
};

export function useClubConfig(): UseClubConfigResult {
  const { clubId } = useClub();
  const [config, setConfig] = useState<ClubConfig>(defaultClubConfig);
  const [loading, setLoading] = useState(true);
  const [reloadKey, setReloadKey] = useState(0);

  useEffect(() => {
    // `clubId` n'est jamais null quand l'app est montée (ClubContext.tsx:110, garde PR3) —
    // mais le hook peut être appelé pendant la résolution du club.
    if (!clubId) return;

    let cancelled = false;

    supabase
      .from('club_settings')
      .select('config')
      .eq('club_id', clubId)
      .maybeSingle()
      .then(({ data, error }) => {
        if (cancelled) return;
        // Ne jamais rendre l'écran inutilisable sur une config illisible : on retombe sur les
        // défauts. La RLS de PR6a garantit par ailleurs que `data` ne peut pas venir d'un
        // autre club, même si ce filtre `.eq` se trompait (brief §5, règle 3).
        if (error) console.error('[useClubConfig] lecture de club_settings impossible', error);
        setConfig(parseClubConfig(data?.config));
        setLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [clubId, reloadKey]);

  // `loading` repasse à true depuis le callback, pas depuis l'effet : `clubId` ne change
  // qu'une fois (résolution au boot) et l'état initial couvre déjà ce cas.
  const reload = () => {
    setLoading(true);
    setReloadKey((k) => k + 1);
  };

  return { config, loading, reload };
}
