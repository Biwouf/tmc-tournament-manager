// SaaS S8b — appels Supabase de « Remplir depuis Ten'Up » (`/admin/site`) et de la lecture en
// tâche de fond lancée à la fin de l'import des équipes (`ClubImport`).
import { normalizeTenupClubProfileUrl } from '../../shared/tenupSite.mjs';
import type { TenupSiteProposal } from './tenupSiteImport';

interface Client {
  functions: { invoke: (name: string, options: { body: Record<string, unknown> }) => Promise<{ data: unknown; error: unknown }> };
  rpc: (name: string, args: Record<string, unknown>) => PromiseLike<{ data: unknown; error: { message: string } | null }>;
  from: (table: string) => any; // eslint-disable-line @typescript-eslint/no-explicit-any
}

export type TenupSiteState = {
  available: boolean;
  tenup_club_id?: string | null;
  running?: boolean;
  next_read_at?: string | null;
  failures?: number;
};

async function invokeError(error: unknown, fallback: string): Promise<Error> {
  const context = (error as { context?: Response }).context;
  const body = context instanceof Response ? await context.json().catch(() => null) : null;
  return new Error(body?.error ?? fallback);
}

/** Lecture au premier plan : lien collé, réponse = la proposition enregistrée côté serveur. */
export async function readTenupSite(client: Client, clubId: string, value: string): Promise<TenupSiteProposal> {
  const url = normalizeTenupClubProfileUrl(value);
  const { data, error } = await client.functions.invoke('tenup-site', { body: { club_id: clubId, url } });
  if (error) throw await invokeError(error, 'Ten’Up n’a pas pu être lu. Réessayez plus tard, ou remplissez le site à la main.');
  const payload = (data as { payload?: TenupSiteProposal } | null)?.payload;
  if (!payload) throw new Error('Ten’Up n’a pas pu être lu. Réessayez plus tard, ou remplissez le site à la main.');
  return payload;
}

/** Lecture en tâche de fond : jamais bloquante, jamais une erreur visible (le bouton manuel reste). */
export async function startTenupSiteBackground(client: Client, clubId: string): Promise<void> {
  try { await client.functions.invoke('tenup-site', { body: { club_id: clubId, background: true } }); } catch { /* rien */ }
}

export async function loadTenupSite(client: Client, clubId: string): Promise<{ state: TenupSiteState; proposal: TenupSiteProposal | null; readAt: string | null }> {
  const { data, error } = await client.rpc('club_tenup_site_state', { p_club: clubId });
  if (error) throw new Error(error.message);
  const state = (data ?? { available: false }) as TenupSiteState;
  if (!state.available) return { state, proposal: null, readAt: null };
  const { data: row, error: rowError } = await client.from('club_tenup_site_proposals')
    .select('payload, read_at').eq('club_id', clubId).eq('status', 'ready').maybeSingle();
  if (rowError) throw new Error(rowError.message);
  return { state, proposal: (row?.payload as TenupSiteProposal) ?? null, readAt: row?.read_at ?? null };
}

export async function consumeTenupSite(client: Client, clubId: string): Promise<void> {
  const { error } = await client.rpc('club_tenup_site_consume', { p_club: clubId });
  if (error) throw new Error(error.message);
}
