import type { SupabaseClient } from '@supabase/supabase-js';
import type { QueryClient } from '@tanstack/react-query';
import type { LiveMatch } from '../types';

/** Regroupe les rafales sans repousser indéfiniment le rafraîchissement des scores. */
export function subscribeToMatchList(supabase: SupabaseClient, client: QueryClient, clubId: string) {
  const queryKey = ['matches', clubId];
  let timer: ReturnType<typeof setTimeout> | undefined;
  let subscribed = false;
  const refresh = () => {
    if (timer !== undefined) return;
    timer = setTimeout(() => {
      timer = undefined;
      void client.invalidateQueries({ queryKey, exact: true });
    }, 250);
  };
  const filter = { schema: 'public', table: 'live_matches', filter: `club_id=eq.${clubId}` };
  const channel = supabase.channel(`live_matches_pwa_${clubId}`)
    .on('postgres_changes', { ...filter, event: 'INSERT' }, refresh)
    .on('postgres_changes', { ...filter, event: 'UPDATE' }, refresh)
    // DELETE n'est pas filtrable par club dans Postgres Changes. Ne recharger que
    // si l'identifiant supprimé appartient à la liste affichée ; polling en secours.
    .on('postgres_changes', { schema: 'public', table: 'live_matches', event: 'DELETE' }, (payload) => {
      if (client.getQueryData<LiveMatch[]>(queryKey)?.some((m) => m.id === payload.old.id)) refresh();
    })
    .subscribe((status) => {
      if (status === 'SUBSCRIBED') {
        if (subscribed) refresh(); // Rattraper les changements manqués pendant une coupure.
        subscribed = true;
      }
    });
  return () => {
    clearTimeout(timer);
    void supabase.removeChannel(channel);
  };
}
