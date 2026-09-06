import { supabase } from './supabase';
import type { LiveMatch } from '../types';

export function hasLiveMatchRevision(match: LiveMatch): boolean {
  return Number.isInteger(match.revision) && match.revision >= 0;
}

function requireRevision(match: LiveMatch): LiveMatch {
  if (!hasLiveMatchRevision(match)) {
    throw new Error('La version du match est absente ou invalide. Rechargez le score. Si le problème persiste, vérifiez la migration Live sur le projet Supabase utilisé.');
  }
  return match;
}

async function withTimeout<T>(request: (signal: AbortSignal) => PromiseLike<T>): Promise<T> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 15_000);
  try { return await request(controller.signal); } finally { clearTimeout(timer); }
}

export async function readLiveMatch(id: string, clubId: string) {
  const { data, error } = await withTimeout(signal => supabase.from('live_matches').select('*')
    .eq('id', id).eq('club_id', clubId).abortSignal(signal).single());
  if (error || !data) throw new Error(error?.message ?? 'Match introuvable');
  return requireRevision(data as LiveMatch);
}

export async function writeLiveMatch(match: LiveMatch, clubId: string | null, patch: Partial<LiveMatch>) {
  requireRevision(match);
  const { data, error } = await withTimeout(signal => supabase.from('live_matches').update(patch)
    .eq('id', match.id).eq('club_id', clubId).eq('revision', match.revision).abortSignal(signal).select('*').single());
  if (error || !data) throw new Error(error?.code === 'PGRST116' || !error
    ? 'Le match a changé ou n’est plus accessible. Rechargez-le avant de réessayer.' : error.message);
  return requireRevision(data as LiveMatch);
}

export async function deleteLiveMatch(match: LiveMatch, clubId: string | null) {
  requireRevision(match);
  const { data, error } = await withTimeout(signal => supabase.from('live_matches').delete()
    .eq('id', match.id).eq('club_id', clubId).eq('revision', match.revision).abortSignal(signal).select('id').single());
  if (error || !data) throw new Error(error?.code === 'PGRST116' || !error
    ? 'Le match a changé ou n’est plus accessible. Actualisez la liste.' : error.message);
}
