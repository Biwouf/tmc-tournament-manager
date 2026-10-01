import { supabase } from './supabase';
export type LiveEncounterScore = {
  id: string;
  club_adverse: string;
  wo: boolean;
  confirmed: boolean;
  score_club: number | null;
  score_adverse: number | null;
};
export async function fetchLiveEncounterScores(
  clubId: string,
  ids: string[],
): Promise<LiveEncounterScore[]> {
  const results: LiveEncounterScore[] = [];
  for (let offset = 0; offset < ids.length; offset += 100) {
    const { data, error } = await supabase
      .rpc('live_encounter_scores', {
        p_club: clubId,
        p_ids: ids.slice(offset, offset + 100),
      })
      .abortSignal(AbortSignal.timeout(15000));
    if (error) throw error;
    results.push(...((data ?? []) as LiveEncounterScore[]));
  }
  return results;
}
