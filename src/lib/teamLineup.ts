// Compo d'équipe (liste des joueurs retenus) côté BO : mêmes RPC `team_compo_*` que la PWA
// (migrations 2026111901-02), donc mêmes droits et mêmes contrôles. Le BO n'écrit jamais en direct.
import { supabase } from './supabase';

export type LineupSex = 'female' | 'male' | null;
export type LineupPlayer = {
  id: string; user_id: string | null; is_guest: boolean; prenom: string; nom: string; initials: string;
  classement: string | null; is_captain: boolean; is_me: boolean; sex: LineupSex;
};
export type TeamLineup = {
  players: LineupPlayer[]; captains: { prenom: string; nom: string }[]; version: number;
  updated_at: string | null; updated_by: { prenom: string; nom: string; role: 'capitaine' | 'admin' } | null;
  can_edit: boolean; min_players: number | null; simples: number | null; doubles: number | null;
  format: string; genre: string;
};
export type LineupCandidate = {
  id: string; prenom: string; nom: string; classement: string | null; sex: LineupSex; is_captain: boolean;
};
export type LineupEntry = { user_id: string } | { id: string } | { prenom: string; nom: string; sex: LineupSex };

export async function fetchLineup(clubId: string, rencontreId: string): Promise<TeamLineup> {
  const { data, error } = await supabase.rpc('team_compo_get', { p_club: clubId, p_rencontre: rencontreId });
  if (error) throw error;
  return data as TeamLineup;
}

export async function fetchLineupCandidates(clubId: string, rencontreId: string): Promise<LineupCandidate[]> {
  const { data, error } = await supabase.rpc('team_compo_candidates', { p_club: clubId, p_rencontre: rencontreId });
  if (error) throw error;
  return data as LineupCandidate[];
}

export async function saveLineup(clubId: string, rencontreId: string, players: LineupEntry[], version: number): Promise<TeamLineup> {
  const { data, error } = await supabase.rpc('team_compo_save', {
    p_club: clubId, p_rencontre: rencontreId, p_players: players, p_version: version,
  });
  if (error) throw error;
  return data as TeamLineup;
}

/** Garde-fou : un membre retenu reçu sans `user_id` serait effacé par l'enregistrement (liste entière). */
export const lineupEditable = (lineup: TeamLineup) => lineup.players.every(p => p.is_guest || !!p.user_id);

const EXPECTED_SEX: Record<string, 'female' | 'male'> = { hommes: 'male', garcons: 'male', femmes: 'female', filles: 'female' };
/** Sexe attendu par la compétition (null en mixte). */
export const expectedSex = (genre: string): LineupSex => EXPECTED_SEX[genre] ?? null;

export const fullName = (p: { prenom: string; nom: string }) => `${p.prenom} ${p.nom}`.trim();
