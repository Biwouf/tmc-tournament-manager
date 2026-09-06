import { useQuery } from '@tanstack/react-query';
import { useAuth } from './useAuth';
import { supabase } from '../lib/supabase';
import { useClub } from '../contexts/ClubContext';

type ClubConfig = {
  brand: {
    logo?: string;
    color?: string;
    color_secondary?: string;
    color_accent?: string;
  };
};

const DEFAULT_CONFIG: ClubConfig = { brand: {} };

function parseConfig(raw: unknown): ClubConfig {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return DEFAULT_CONFIG;
  const source = raw as Record<string, unknown>;
  const brand = source.brand && typeof source.brand === 'object' && !Array.isArray(source.brand)
    ? source.brand as Record<string, unknown>
    : {};
  const str = (v: unknown) => (typeof v === 'string' && v ? v : undefined);
  return {
    brand: {
      logo: str(brand.logo),
      color: str(brand.color),
      color_secondary: str(brand.color_secondary),
      color_accent: str(brand.color_accent),
    },
  };
}

/** PR7-bis — lecture minimale de l'identité visuelle du club pour la PWA. */
export function useClubConfig() {
  const { clubId } = useClub();
  const { user, loading } = useAuth();
  const { data: config = DEFAULT_CONFIG } = useQuery({
    queryKey: ['club-config', clubId, user?.id],
    // club_settings n'est pas public : inutile de lancer des requêtes anon vouées au refus.
    enabled: !!clubId && !!user && !loading,
    staleTime: 5 * 60_000,
    queryFn: async () => {
      const { data, error } = await supabase
        .from('club_settings')
        .select('config')
        .eq('club_id', clubId)
        .maybeSingle();
      if (error) throw error;
      return parseConfig(data?.config);
    },
  });
  return { config };
}
