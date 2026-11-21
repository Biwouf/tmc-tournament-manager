// Compo d'équipe (liste des joueurs retenus) : RPC `team_compo_*`, migration 2026111901.
// À ne pas confondre avec `teamCompo.ts`, qui sert au scan de la feuille de match du jour J.
import { supabase } from './supabase';
import { COMPO_COPY } from '../../../shared/teamCompoCopy.mjs';

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
/** Entrée envoyée à `team_compo_save` : membre, invité déjà présent, ou nouvel invité. */
export type LineupEntry = { user_id: string } | { id: string } | { prenom: string; nom: string; sex: LineupSex };

export const lineupKey = (clubId: string | null | undefined, rencontreId: string) => ['team-compo', clubId, rencontreId] as const;
export const LINEUP_SUMMARIES_KEY = 'team-compo-summaries';

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

/**
 * Garde-fou : un membre retenu reçu sans `user_id` (serveur pas à jour, lecteur sans droit) serait
 * effacé par `team_compo_save`, qui reçoit la liste entière. On n'ouvre pas l'édition dans ce cas.
 */
export const lineupEditable = (lineup: TeamLineup) => lineup.players.every(p => p.is_guest || !!p.user_id);

const EXPECTED_SEX: Record<string, 'female' | 'male'> = { hommes: 'male', garcons: 'male', femmes: 'female', filles: 'female' };
/** Sexe attendu par la compétition (null en mixte). */
export const expectedSex = (genre: string): LineupSex => EXPECTED_SEX[genre] ?? null;
/** « Femme · Rencontre messieurs » pour une personne hors du genre de la rencontre (n'empêche rien). */
export function outOfGenreLabel(sex: LineupSex | undefined, genre: string): string | null {
  const expected = expectedSex(genre);
  const label = COMPO_COPY.genreLabel(genre);
  if (!sex || !expected || sex === expected || !label) return null;
  return `${sex === 'female' ? 'Femme' : 'Homme'} · ${label}`;
}

export const fullName = (p: { prenom: string; nom: string }) => `${p.prenom} ${p.nom}`.trim();
