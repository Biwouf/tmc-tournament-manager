export type TenupPageState = 'ok' | 'empty' | 'failed' | 'none';
export interface TenupClubProfile {
  url: string;
  pages: { club: 'ok'; equipe: 'ok' | 'failed'; offres: 'ok' | 'empty' | 'failed'; installation: 'ok' | 'failed' | 'none' };
  club: {
    name: string; street: string; postal_code: string; city: string; phone: string; email: string;
    facebook_url: string; instagram_url: string; logo: string; banner: string; sports: string[];
  };
  board: { name: string; roles: string[] }[];
  offers: { type: string; title: string; year: number | null; description: string; price: number | null; from: boolean }[];
  courts: { sport: string; surface: string; count: number; covered: number }[];
}
export function normalizeTenupClubProfileUrl(value: unknown): string;
export function tenupClubIdOf(url: string): string | null;
export function isTenupImageUrl(value: unknown): boolean;
export function validateTenupClubProfile(payload: unknown, url: string): TenupClubProfile;
