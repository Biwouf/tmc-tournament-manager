import { supabase } from './supabase';

// Matches whose alerts (end of set, end of match, feed) the current member follows.
export async function fetchLiveFollows(clubId: string): Promise<string[]> {
  const { data, error } = await supabase.rpc('live_my_follows', { p_club: clubId });
  if (error) throw new Error('Impossible de charger vos alertes.');
  return ((data ?? []) as unknown[]).map((row) =>
    typeof row === 'string' ? row : (row as { live_my_follows: string }).live_my_follows);
}

// Confirmation affichée après un clic réussi sur la cloche (liste et page du live).
export function followToastText(following: boolean): string {
  return following ? 'Alertes activées pour ce match' : 'Alertes désactivées pour ce match';
}

export async function setLiveFollow(clubId: string, matchId: string, on: boolean): Promise<boolean> {
  const { data, error } = await supabase.rpc('live_follow', { p_club: clubId, p_match: matchId, p_on: on });
  if (error) {
    throw new Error(error.code === 'P0002' ? 'Ce match est terminé : ses alertes ne sont plus disponibles.'
      : 'Impossible de modifier les alertes de ce match. Réessayez.');
  }
  return Boolean(data);
}

// Optional alert sent right after the start, chosen by the person who starts the live.
// Never blocks the start: a failure is reported but the match stays live.
export async function announceLiveStart(clubId: string, matchId: string): Promise<boolean> {
  const { error } = await supabase.rpc('live_push_announce_start', { p_club: clubId, p_match: matchId });
  return !error;
}
