// Structural adapter keeps the BO and PWA independent of their Supabase versions.
import type { TenupSyncProps } from './TenupSync';
interface Client {
  functions: { invoke: (name: string, options: { body: Record<string, unknown> }) => Promise<{ data: unknown; error: unknown }> };
  rpc: (name: string, args: Record<string, unknown>) => PromiseLike<{ data: unknown; error: { message: string } | null }>;
}
export function tenupClient(client: Client, clubId: string, rencontreId: string): Pick<TenupSyncProps, 'preview' | 'apply'> {
  return {
    async preview(url) {
      const { data, error } = await client.functions.invoke('tenup-sync', { body: { club_id: clubId, rencontre_id: rencontreId, url } });
      if (error) {
        const context = (error as { context?: Response }).context;
        const body = context instanceof Response ? await context.json().catch(() => null) : null;
        throw new Error(body?.error ?? 'Impossible de joindre la synchronisation Ten’Up. Réessayez plus tard.');
      }
      return data as Awaited<ReturnType<TenupSyncProps['preview']>>;
    },
    async apply(id, side) {
      const { data, error } = await client.rpc('team_tenup_apply', { p_preview: id, p_side: side });
      if (error) throw new Error(error.message);
      return data as Awaited<ReturnType<TenupSyncProps['apply']>>;
    },
  };
}
