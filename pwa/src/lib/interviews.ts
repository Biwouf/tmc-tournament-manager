// Interview d'après-match (docs/specs/INTERVIEWS.md) : RPC live_interviews et Edge Function
// generate-interview. Les droits sont contrôlés côté serveur.
import { supabase } from './supabase';

export type InterviewStatus = 'pending' | 'ready' | 'published' | 'declined' | 'removed' | 'expired';
export type InterviewQuestion = { id: string; texte: string };
export type InterviewAnswer = { question_id: string; texte: string };
export type InterviewSummary = {
  id: string;
  club_id: string;
  live_match_id: string;
  side: 'j1' | 'j2' | 'j3' | 'j4';
  status: InterviewStatus;
  expires_at: string;
  opponent: string;
  result: 'win' | 'loss' | null;
  finished_at: string | null;
  sets: [number | null, number | null][];
  team: 'j1' | 'j2';
};
export type Interview = InterviewSummary & {
  questions: InterviewQuestion[];
  answers: InterviewAnswer[];
};
export type PublishedInterview = {
  id: string;
  side: string;
  player: string;
  published_at: string;
  items: { question: string; answer: string }[];
  can_delete: boolean;
};

/** Erreur dont le message SQL (français) peut être montré tel quel. */
export class InterviewError extends Error {
  code: string | undefined;
  constructor(message: string, code?: string) {
    super(message);
    this.code = code;
  }
}

async function rpc<T>(name: string, args: Record<string, unknown>): Promise<T> {
  const { data, error } = await supabase.rpc(name, args).abortSignal(AbortSignal.timeout(15000));
  if (error) throw new InterviewError(error.message, error.code);
  return data as T;
}

export const readMyPendingInterviews = (club: string) =>
  rpc<InterviewSummary[]>('interview_my_pending', { p_club: club });

export const readInterview = (id: string) => rpc<Interview>('interview_get', { p_id: id });

export const answerInterview = (id: string, answers: InterviewAnswer[]) =>
  rpc<{ status: 'published' }>('interview_answer', { p_id: id, p_answers: answers });

export const declineInterview = (id: string) => rpc<null>('interview_decline', { p_id: id });

export const deleteInterview = (id: string) => rpc<null>('interview_delete', { p_id: id });

export const readMatchInterviews = (match: string, club: string) =>
  rpc<PublishedInterview[]>('live_match_interviews', { p_match: match, p_club: club });

/** Fait préparer les questions par le journaliste (Claude), une seule fois par interview. */
export async function prepareQuestions(id: string): Promise<InterviewQuestion[]> {
  const { data, error } = await supabase.functions.invoke('generate-interview', { body: { interview_id: id } });
  if (error) {
    const context = (error as { context?: Response }).context;
    const body = context instanceof Response ? await context.json().catch(() => null) : null;
    throw new InterviewError(body?.error ?? 'Les questions n’ont pas pu être préparées. Réessaie dans un instant.');
  }
  return (data as { questions: InterviewQuestion[] }).questions;
}

/** Score du match du point de vue du joueur : « 6–4 3–6 10–8 ». */
export function interviewScore(i: Pick<InterviewSummary, 'sets' | 'team'>) {
  return i.sets
    .filter(([a, b]) => a !== null && b !== null && a + b > 0)
    .map(([a, b]) => (i.team === 'j1' ? `${a}–${b}` : `${b}–${a}`))
    .join(' ');
}

const DRAFT = (id: string) => `interview-draft:${id}`;

export function readDraft(id: string): Record<string, string> {
  try {
    const value = JSON.parse(localStorage.getItem(DRAFT(id)) ?? '{}');
    return value && typeof value === 'object' ? value : {};
  } catch {
    return {};
  }
}

export function writeDraft(id: string, draft: Record<string, string> | null) {
  try {
    if (draft) localStorage.setItem(DRAFT(id), JSON.stringify(draft));
    else localStorage.removeItem(DRAFT(id));
  } catch {
    // stockage indisponible : le brouillon reste en mémoire
  }
}
