import { useEffect, useState } from 'react';
import { supabase } from '../lib/supabase';
import { useClub } from '../contexts/ClubContext';

type ClubConfig = {
  brand: {
    logo?: string;
    color?: string;
  };
};

const DEFAULT_CONFIG: ClubConfig = { brand: {} };

function parseConfig(raw: unknown): ClubConfig {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return DEFAULT_CONFIG;
  const source = raw as Record<string, unknown>;
  const brand = source.brand && typeof source.brand === 'object' && !Array.isArray(source.brand)
    ? source.brand as Record<string, unknown>
    : {};
  return {
    brand: {
      logo: typeof brand.logo === 'string' && brand.logo ? brand.logo : undefined,
      color: typeof brand.color === 'string' && brand.color ? brand.color : undefined,
    },
  };
}

/** PR7-bis — lecture minimale de l'identité visuelle du club pour la PWA. */
export function useClubConfig() {
  const { clubId } = useClub();
  const [config, setConfig] = useState<ClubConfig>(DEFAULT_CONFIG);

  useEffect(() => {
    if (!clubId) return;
    let cancelled = false;

    const load = async () => {
      const { data, error } = await supabase
        .from('club_settings')
        .select('config')
        .eq('club_id', clubId)
        .maybeSingle();
      if (cancelled) return;
      if (error) console.error('[useClubConfig] lecture de club_settings impossible', error);
      setConfig(parseConfig(data?.config));
    };

    // La policy de lecture est authentifiée : recharger après restauration de session,
    // sinon le premier appel peut partir en anon et laisser l'identité par défaut.
    void supabase.auth.getSession().then(() => load());
    const { data: auth } = supabase.auth.onAuthStateChange(() => {
      void load();
    });
    return () => {
      cancelled = true;
      auth.subscription.unsubscribe();
    };
  }, [clubId]);

  return { config };
}
