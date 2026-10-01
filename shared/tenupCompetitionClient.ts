import { normalizeTenupCompetitionUrl } from './tenupCompetitionUrl.mjs';
export interface TenupCompetitionPreview {
  url: string;
  nom: string;
  format: '2S1D' | '3S1D' | '3S1D2' | '4S1D2' | '4S2D' | null;
  singles_set3_format: 'normal' | 'super_tiebreak' | null;
  warnings: string[];
}
interface Client {
  functions: { invoke: (name: string, options: { body: Record<string, unknown> }) => Promise<{ data: unknown; error: unknown }> };
}
export async function previewTenupCompetition(client: Client, clubId: string, saisonId: string, value: string): Promise<TenupCompetitionPreview> {
  const url = normalizeTenupCompetitionUrl(value);
  const { data, error } = await client.functions.invoke('tenup-sync', { body: { kind: 'competition', club_id: clubId, saison_id: saisonId, url } });
  if (error) {
    const context = (error as { context?: Response }).context;
    const body = context instanceof Response ? await context.json().catch(() => null) : null;
    throw new Error(body?.error ?? 'Impossible de joindre Ten’Up. Vous pouvez saisir la compétition manuellement.');
  }
  return data as TenupCompetitionPreview;
}
