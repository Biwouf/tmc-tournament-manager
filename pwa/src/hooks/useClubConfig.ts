import { useQuery } from '@tanstack/react-query';
import { supabase } from '../lib/supabase';
import { useClub } from '../contexts/ClubContext';
import { readLogoVariants } from '../../../shared/tenupLogo.mjs';
import type { LogoVariants } from '../lib/appIcons';

type ClubConfig = {
  brand: {
    logo?: string;
    color?: string;
    color_secondary?: string;
    color_accent?: string;
    /** Nom court (« CAC ») : `short_name` du manifest. */
    short_name?: string;
    /** W3 : variantes du logo retouché (icônes d'installation), absentes pour la plupart des clubs. */
    logo_variants?: LogoVariants;
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
      short_name: str(brand.short_name),
      logo_variants: readLogoVariants(brand.logo_variants) ?? undefined,
    },
  };
}

/** PR7-bis — lecture minimale de l'identité visuelle du club pour la PWA. */
export function useClubConfig() {
  const { clubId } = useClub();
  const { data: config = DEFAULT_CONFIG, isFetched, isSuccess } = useQuery({
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
  return { config, isFetched, isSuccess };
}
