import Anthropic from 'npm:@anthropic-ai/sdk@0.128.0';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { buildInterviewFacts } from '../../../shared/interviewFacts.ts';
import type { RawInterviewFacts } from '../../../shared/interviewFacts.ts';
import { SYSTEM_PROMPT } from './prompt.ts';

// Questions de l'interview d'après-match (docs/specs/INTERVIEWS.md). Appelée par la PWA à
// l'ouverture de l'interview, avec le jeton du joueur. interview_gen_begin contrôle les droits et
// les plafonds AVANT l'appel payant et renvoie les faits relus en base (rien n'est cru du
// client) ; interview_gen_save, réservée au service_role, enregistre les questions : le joueur ne
// peut pas écrire les siennes. Les logs ne contiennent ni question ni prénom.
const headers = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Content-Type': 'application/json', 'Cache-Control': 'no-store',
};
const json = (status: number, body: Record<string, unknown>) =>
  new Response(JSON.stringify({ success: status === 200, ...body }), { status, headers });
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const MODEL = 'claude-haiku-5-5';
const FAILED = 'Les questions n’ont pas pu être préparées. Réessaie dans un instant.';
const SCHEMA = {
  type: 'object',
  properties: { questions: { type: 'array', items: { type: 'string' } } },
  required: ['questions'],
  additionalProperties: false,
};

function log(entry: Record<string, unknown>) {
  console.log(JSON.stringify({ fn: 'generate-interview', ...entry }));
}

/** Questions utilisables : texte brut, sans numérotation ni Markdown, 4 au plus. */
export function cleanQuestions(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value
    .filter((q): q is string => typeof q === 'string')
    .map(q => q.replace(/\*{1,3}([^*\n]+?)\*{1,3}/g, '$1').replace(/^\s*(?:\d+[.)]|[-•])\s*/, '').replace(/\s+/g, ' ').trim())
    .filter(Boolean)
    .map(q => q.slice(0, 300))
    .slice(0, 4);
}

Deno.serve(async req => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers });
  if (req.method !== 'POST') return json(405, { error: 'Méthode non autorisée.' });
  const started = Date.now();
  let interviewId: string | null = null;
  try {
    const authorization = req.headers.get('Authorization');
    if (!authorization?.startsWith('Bearer ')) return json(401, { error: 'Connexion requise.' });
    const url = Deno.env.get('SUPABASE_URL')!;
    const client = createClient(url, Deno.env.get('SUPABASE_ANON_KEY')!, { global: { headers: { Authorization: authorization } } });
    const { data: { user }, error: authError } = await client.auth.getUser();
    if (authError || !user) return json(401, { error: 'Session expirée. Reconnecte-toi.' });
    const raw = await req.text();
    if (raw.length > 2_000) return json(413, { error: 'Requête trop volumineuse.' });
    let body: { interview_id?: unknown };
    try { body = JSON.parse(raw); } catch { return json(400, { error: 'Requête invalide.' }); }
    if (typeof body?.interview_id !== 'string' || !uuid.test(body.interview_id)) return json(400, { error: 'Requête invalide.' });
    interviewId = body.interview_id;

    const globalLimit = Number(Deno.env.get('INTERVIEW_GEN_GLOBAL_DAILY_LIMIT') ?? '200');
    const { data: begun, error: beginError } = await client.rpc('interview_gen_begin', {
      p_id: interviewId, p_global_daily_limit: Number.isFinite(globalLimit) ? globalLimit : 200,
    });
    if (beginError) {
      const status = beginError.code === '42501' ? 403 : beginError.code === 'P0002' ? 404 : beginError.code === 'PT429' ? 429 : 400;
      log({ interview_id: interviewId, status: status === 429 ? 'quota' : 'refused', code: beginError.code, latency_ms: Date.now() - started });
      return json(status, { error: beginError.message });
    }
    if (begun?.status === 'ready') return json(200, { questions: begun.questions });

    const apiKey = Deno.env.get('ANTHROPIC_API_KEY');
    if (!apiKey) return json(503, { error: 'Les interviews ne sont pas disponibles pour le moment.' });
    const facts = buildInterviewFacts(begun.facts as RawInterviewFacts);
    const anthropic = new Anthropic({ apiKey, timeout: 30_000, maxRetries: 1 });
    const message = await anthropic.messages.create({
      model: MODEL,
      // Réflexion désactivée, comme generate-post : ses tokens tronqueraient la sortie.
      max_tokens: 1500,
      thinking: { type: 'disabled' },
      output_config: { effort: 'low', format: { type: 'json_schema', schema: SCHEMA } },
      system: SYSTEM_PROMPT,
      messages: [{ role: 'user', content: `Prépare les questions de l'interview à partir de ces faits :\n${JSON.stringify(facts, null, 1)}` }],
    });
    const usage = { input_tokens: message.usage?.input_tokens ?? 0, output_tokens: message.usage?.output_tokens ?? 0 };
    const block = message.stop_reason === 'end_turn' ? message.content.find(b => b.type === 'text') : undefined;
    let questions: string[] = [];
    if (block && block.type === 'text') { try { questions = cleanQuestions(JSON.parse(block.text)?.questions); } catch { questions = []; } }
    if (questions.length < 2) {
      log({ interview_id: interviewId, status: message.stop_reason === 'refusal' ? 'model_refusal' : 'unusable_output', stop_reason: message.stop_reason, ...usage, latency_ms: Date.now() - started });
      return json(502, { error: FAILED });
    }

    const admin = createClient(url, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!);
    const { data: saved, error: saveError } = await admin.rpc('interview_gen_save', { p_id: interviewId, p_member: user.id, p_questions: questions });
    if (saveError) {
      log({ interview_id: interviewId, status: 'save_failed', code: saveError.code, latency_ms: Date.now() - started });
      return json(saveError.code === 'P0002' ? 404 : 502, { error: saveError.code === 'P0002' ? saveError.message : FAILED });
    }
    log({ interview_id: interviewId, status: 'ok', questions: questions.length, ...usage, latency_ms: Date.now() - started });
    return json(200, { questions: saved });
  } catch (error) {
    const timeout = error instanceof Anthropic.APIConnectionTimeoutError;
    const busy = error instanceof Anthropic.RateLimitError || (error instanceof Anthropic.APIError && error.status === 529);
    const api = error instanceof Anthropic.APIError ? error : null;
    log({
      interview_id: interviewId, status: timeout ? 'timeout' : busy ? 'api_busy' : 'error', latency_ms: Date.now() - started,
      error_name: error instanceof Error ? error.name : typeof error,
      ...(api ? { http_status: api.status, api_error: String(api.message ?? '').slice(0, 300) } : {}),
    });
    if (timeout) return json(504, { error: 'La préparation a pris trop de temps. Réessaie.' });
    if (busy) return json(503, { error: 'Service saturé. Réessaie dans une minute.' });
    return json(502, { error: FAILED });
  }
});
