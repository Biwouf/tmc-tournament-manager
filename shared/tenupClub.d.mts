export interface TenupClubTeam {
  pool_url: string;
  competition: string;
  team: string;
  level: string;
  category: string;
  genre: string;
  dates: string[];
}
export interface TenupClub {
  club: string;
  teams: TenupClubTeam[];
  skipped: number;
}
export function normalizeTenupClubUrl(value: unknown): string;
export function isTenupClubUrl(value: unknown): boolean;
export function validateTenupClub(payload: unknown): TenupClub;
