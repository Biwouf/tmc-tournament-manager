import { supabase } from './supabase';
import type { LiveMatch } from '../types';

export type LivePost = {
  id: string;
  sequence: number;
  kind: 'message' | 'poll';
  body: string;
  author_name: string;
  created_at: string;
  score: Partial<LiveMatch>;
  options: string[];
  closed: boolean;
  my_vote: number | null;
  total: number;
  counts: number[] | null;
};
export type LiveActivityPage = {
  items: LivePost[];
  before: number | null;
  has_more: boolean;
  can_animate: boolean;
};
export type LiveReaction = {
  id: string;
  match_id: string;
  user_id: string;
  emoji: string;
  created_at: string;
};
export const LIVE_REACTIONS = [
  ['👏', 'Applaudir'],
  ['🔥', 'Quel match !'],
  ['💪', 'Encourager'],
  ['❤️', 'Soutenir'],
  ['😮', 'Incroyable'],
  ['🎉', 'Célébrer'],
] as const;
export async function readActivity(
  match: string,
  club: string,
  before: number | null,
): Promise<LiveActivityPage> {
  const { data, error } = await supabase
    .rpc('live_activity_page', {
      p_match: match,
      p_club: club,
      p_before: before,
    })
    .abortSignal(AbortSignal.timeout(15000));
  if (error) throw new Error(error.message);
  return data as LiveActivityPage;
}
export async function activityCommand(
  match: string,
  club: string,
  action: string,
  input: Record<string, unknown>,
) {
  const { data, error } = await supabase
    .rpc('live_activity_command', {
      p_match: match,
      p_club: club,
      p_action: action,
      p_data: input,
    })
    .abortSignal(AbortSignal.timeout(15000));
  if (error) throw new Error(error.message);
  return data as { id: string };
}
