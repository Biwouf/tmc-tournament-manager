import type { SupabaseClient } from '@supabase/supabase-js';
import type { QueryClient } from '@tanstack/react-query';
import { clubTopic, listenLiveTopic } from './liveChannel';

/**
 * Broadcast `live:club:<id>` (événement 'live') : recharge la liste et les scores de rencontres.
 * Regroupe les rafales sans repousser indéfiniment le rafraîchissement des scores.
 * `onStatus` dit si le canal est abonné, pour ne garder le polling qu'en secours.
 */
export function subscribeToMatchList(
  supabase: SupabaseClient,
  client: QueryClient,
  clubId: string,
  onStatus?: (subscribed: boolean) => void,
) {
  const queryKey = ['matches', clubId];
  let timer: ReturnType<typeof setTimeout> | undefined;
  let subscribed = false;
  const refresh = () => {
    if (timer !== undefined) return;
    timer = setTimeout(() => {
      timer = undefined;
      void Promise.all([
        client.invalidateQueries({ queryKey, exact: true }),
        client.invalidateQueries({ queryKey: ['live-encounter-scores', clubId] }),
      ]);
    }, 250);
  };
  const stop = listenLiveTopic(supabase, clubTopic(clubId), {
    onMessage: ({ event }) => { if (event === 'live') refresh(); },
    onStatus: (ok) => {
      if (ok) {
        if (subscribed) refresh(); // Rattraper les changements manqués pendant une coupure.
        subscribed = true;
      }
      onStatus?.(ok);
    },
  });
  return () => {
    clearTimeout(timer);
    stop();
  };
}
