import { supabase } from './supabase';

export interface RosterMember {
  id: string;
  prenom: string;
  nom: string;
}

// Capitaines des équipes données, par équipe, et membres du club (candidats), en deux requêtes.
export async function loadCaptains(clubId: string, equipeIds: string[]) {
  const [captains, members] = await Promise.all([
    supabase.from('team_equipe_captains').select('equipe_id, user_id').eq('club_id', clubId).in('equipe_id', equipeIds),
    supabase.rpc('team_member_roster', { p_club: clubId }),
  ]);
  if (captains.error) throw captains.error;
  if (members.error) throw members.error;
  const byEquipe: Record<string, string[]> = {};
  for (const row of captains.data ?? []) (byEquipe[row.equipe_id] ??= []).push(row.user_id);
  return { byEquipe, roster: (members.data ?? []) as RosterMember[] };
}

export async function addCaptain(clubId: string, equipeId: string, userId: string) {
  const { error } = await supabase.from('team_equipe_captains').insert({ club_id: clubId, equipe_id: equipeId, user_id: userId });
  if (error) throw error;
}

export async function removeCaptain(clubId: string, equipeId: string, userId: string) {
  const { error } = await supabase
    .from('team_equipe_captains')
    .delete()
    .eq('club_id', clubId)
    .eq('equipe_id', equipeId)
    .eq('user_id', userId);
  if (error) throw error;
}
