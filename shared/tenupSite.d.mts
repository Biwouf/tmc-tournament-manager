export type TenupPageState = 'ok' | 'empty' | 'failed' | 'none';
export interface TenupClubProfile {
  url: string;
  pages: { club: 'ok'; equipe: 'ok' | 'failed'; offres: 'ok' | 'empty' | 'failed'; installation: 'ok' | 'failed' | 'none' };
  club: {
    name: string; street: string; postal_code: string; city: string; phone: string; email: string;
    facebook_url: string; instagram_url: string; logo: string; banner: string; sports: string[];
    /** S8b-bis — photo de l'installation ; absente d'une proposition lue avant. */
    installation_image?: string;
    /** Seconde copie pour l'accueil, posée par l'Edge (jamais par le worker). */
    installation_image_home?: string;
  };
  board: { name: string; roles: string[] }[];
  offers: { type: string; title: string; year: number | null; description: string; price: number | null; from: boolean;
    /** S8b-bis — grille de la page de l'offre (« À partir de » seulement) ; absente avant. */
    tariffs?: { name: string; price: number | null; note: string }[] }[];
  courts: { sport: string; surface: string; count: number; covered: number }[];
}
export function normalizeTenupClubProfileUrl(value: unknown): string;
export function tenupClubIdOf(url: string): string | null;
export function isTenupImageUrl(value: unknown): boolean;
export function validateTenupClubProfile(payload: unknown, url: string): TenupClubProfile;
