import { supabase } from './supabase';
import type { LiveMatch, LiveSet3Format, TeamCompetition, TeamEquipe, TeamEtape, TeamRencontre } from '../types';

export interface TeamPlayer { prenom: string; nom: string; classement: string; member_id?: string }
export interface TeamSet { club: number; adverse: number; tb_club?: number | null; tb_adverse?: number | null }
export interface TeamLine {
  id: string; rencontre_id: string; match_type: 'simple' | 'double'; slot: number; revision: number;
  joueurs_club: TeamPlayer[]; joueurs_adverse: TeamPlayer[];
  set3_format: LiveSet3Format | null; sets: TeamSet[]; score: string | null;
  gagnant: 'club' | 'adverse' | null; result_kind: 'normal' | 'wo' | 'retired' | null;
  live_match_id: string | null; confirmed_at: string | null;
}
export interface TeamEncounter extends TeamRencontre { revision: number; confirmed_at: string | null }
export interface TeamDetail {
  rencontre: TeamEncounter; etape: TeamEtape; equipe: TeamEquipe; competition: TeamCompetition;
  lines: TeamLine[]; lives: LiveMatch[];
}
export const TEAM_FORMATS = {
  '2S1D': { simples: 2, doubles: 1, doublePoints: 1 },
  '3S1D': { simples: 3, doubles: 1, doublePoints: 1 },
  '3S1D2': { simples: 3, doubles: 1, doublePoints: 2 },
  '4S1D2': { simples: 4, doubles: 1, doublePoints: 2 },
  '4S2D': { simples: 4, doubles: 2, doublePoints: 1 },
};
export const playerLabel = (players: TeamPlayer[]) => players.map(p => `${p.prenom} ${p.nom ?? ''}`.trim()).join(' / ');
export const lineLabel = (line: Pick<TeamLine, 'match_type' | 'slot'>) => `${line.match_type === 'simple' ? 'Simple' : 'Double'} ${line.slot}`;
export function setWinner(set: TeamSet, superTb = false): 'club' | 'adverse' | null {
  const { club: a, adverse: b } = set;
  if (![a, b].every(v => Number.isInteger(v) && v >= 0 && v <= 32767)) return null;
  const max = Math.max(a, b), min = Math.min(a, b);
  const won = superTb ? (max === 10 && min <= 8) || (max > 10 && max - min === 2)
    : (max === 6 && min <= 4) || (max === 7 && (min === 5 || min === 6));
  return won ? a > b ? 'club' : 'adverse' : null;
}
export function resultWinner(sets: TeamSet[], format: LiveSet3Format | null) {
  if (!format || sets.length < 2 || sets.length > 3) return null;
  const a = setWinner(sets[0]), b = setWinner(sets[1]);
  if (!a || !b) return null;
  if (a === b) return sets.length === 2 ? a : null;
  return sets.length === 3 ? setWinner(sets[2], format === 'super_tiebreak') : null;
}
export function liveSets(match: LiveMatch): TeamSet[] {
  return ([1, 2, 3] as const).flatMap(n => {
    const a = match[`set${n}_j1`], b = match[`set${n}_j2`];
    if (a === null && b === null) return [];
    return [{ club: a ?? 0, adverse: b ?? 0, tb_club: match[`set${n}_tb_j1`], tb_adverse: match[`set${n}_tb_j2`] }];
  });
}
export const setsLabel = (sets: TeamSet[]) => sets.map(s => `${s.club}–${s.adverse}`).join('  ');

export async function fetchTeamDetail(clubId: string, id: string): Promise<TeamDetail> {
  async function one<T>(table: string, rowId: string): Promise<T> {
    const { data, error } = await supabase.from(table).select('*').eq('club_id', clubId).eq('id', rowId).single();
    if (error) throw error;
    return data as T;
  }
  const rencontre = await one<TeamEncounter>('team_rencontres', id);
  const etape = await one<TeamEtape>('team_etapes', rencontre.etape_id);
  const equipe = await one<TeamEquipe>('team_equipes', etape.equipe_id);
  const [competition, rows] = await Promise.all([
    one<TeamCompetition>('team_competitions', equipe.competition_id),
    supabase.from('team_match_lines').select('*').eq('club_id', clubId).eq('rencontre_id', id).order('match_type', { ascending: false }).order('slot'),
  ]);
  if (rows.error) throw rows.error;
  const lines = rows.data as TeamLine[];
  const ids = lines.flatMap(l => l.live_match_id ? [l.live_match_id] : []);
  let lives: LiveMatch[] = [];
  if (ids.length) {
    const { data, error } = await supabase.from('live_matches').select('*').eq('club_id', clubId).in('id', ids);
    if (error) throw error;
    lives = data as LiveMatch[];
  }
  return { rencontre, etape, equipe, competition, lines, lives };
}
