// Multi-tenant — applique les couleurs du club aux tokens CSS de <html>.
//
// Le hook prend la config DÉJÀ lue plutôt que de la relire : deux écrans l'appellent, l'un
// avec la config du club courant (`App.tsx`, monté une fois pour toute l'app), l'autre avec
// celle que l'admin vient d'enregistrer (`SiteConfigPage`, pour voir la couleur s'appliquer
// sans recharger).
import { useEffect } from 'react';
import { applyClubTheme } from '../lib/theme';
import type { ClubConfig } from '../lib/clubConfig';

export function useClubTheme(config: ClubConfig): void {
  const { color, color_secondary, color_accent } = config.brand;

  useEffect(() => {
    applyClubTheme(document.documentElement, {
      primary: color,
      secondary: color_secondary,
      accent: color_accent,
    });
  }, [color, color_secondary, color_accent]);
}
