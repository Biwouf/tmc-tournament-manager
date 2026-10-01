export interface TenupPool {
  division: string;
  phase: string;
  poule: string;
  teams: { id: string; name: string }[];
  rounds: {
    numero: number;
    matches: { url: string; home_id: string; away_id: string; date: string }[];
  }[];
}
export function normalizeTenupPoolUrl(value: unknown): string;
export function validateTenupPool(payload: unknown, source: string): TenupPool;
export function teamCalendar(
  pool: TenupPool,
  teamId: string
): {
  numero: number;
  exempt: boolean;
  date?: string;
  domicile?: boolean;
  adversaire?: string;
  url?: string;
}[];
