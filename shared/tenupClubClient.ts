import { normalizeTenupClubUrl, validateTenupClub, type TenupClub } from './tenupClub.mjs';
interface Client {
  functions: { invoke: (name: string, options: { body: Record<string, unknown> }) => Promise<{ data: unknown; error: unknown }> };
}
/** Lit la page des rencontres du club sur Ten'Up (une lecture, `team_tenup_club_begin`). */
export async function previewTenupClub(client: Client, clubId: string, value: string): Promise<TenupClub & { url: string }> {
  const url = normalizeTenupClubUrl(value);
  const { data, error } = await client.functions.invoke('tenup-sync', { body: { kind: 'club', club_id: clubId, url } });
  if (error) {
    const context = (error as { context?: Response }).context;
    const body = context instanceof Response ? await context.json().catch(() => null) : null;
    throw new Error(body?.error ?? 'Impossible de lire la page du club sur Ten’Up. Ajoutez vos équipes avec le lien de leur poule.');
  }
  return { ...validateTenupClub(data), url };
}
