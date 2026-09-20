import { useQuery } from '@tanstack/react-query';
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
  const { data: config = DEFAULT_CONFIG } = useQuery({
    queryKey: ['club-config', clubId],
    // La marque est publique même pour un compte en attente/refusé.
    enabled: !!clubId,
    staleTime: 5 * 60_000,
    queryFn: async () => {
      const { data, error } = await supabase.rpc('club_public_brand', { p_club: clubId });
      if (error) throw error;
      return parseConfig(data);
    },
  });
  return { config };
}
