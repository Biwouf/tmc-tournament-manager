import Anthropic from 'npm:@anthropic-ai/sdk@0.128.0';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { buildPostFacts, MAX_RENCONTRES } from '../../../shared/teamPostFacts.mjs';
import { SYSTEM_PROMPT } from './prompt.ts';

// Génère le titre et le texte d'une actu à partir de rencontres par équipe (docs/specs/ACTUS.md,
// « Génération depuis des rencontres »). Réservé aux administrateurs du club, plafonné par
// post_gen_check AVANT l'appel payant, compté par post_gen_record APRÈS un appel réussi.
// Les faits sont relus en base avec le jeton de l'appelant (RLS + filtre club) : rien de ce que
// le client affirme sur les résultats n'est cru. Les logs ne contiennent ni texte ni prénom.
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
const FAILED = 'Le texte n’a pas pu être généré. Réessayez dans un instant ou rédigez l’actu à la main.';

const SCHEMA = {
  type: 'object',
  properties: {
    titre: { type: 'string' },
    paragraphes: {
      type: 'array',
      items: {
        type: 'object',
        properties: { texte: { type: 'string' }, rencontres: { type: 'array', items: { type: 'string' } } },
        required: ['texte', 'rencontres'],
        additionalProperties: false,
      },
    },
    warnings: { type: 'array', items: { type: 'string' } },
  },
  required: ['titre', 'paragraphes', 'warnings'],
  additionalProperties: false,
};

type Body = {
  club_id: string;
  rencontre_ids: string[];
  extras: Record<string, { note?: string; contexte?: string }>;
  consigne: string;
  length: 'short' | 'normal';
  tone: 'fun' | 'serious';
  previous: string;
};

const str = (value: unknown, max: number) => typeof value === 'string' ? value.trim().slice(0, max) : '';

function parseBody(raw: unknown): Body | null {
  if (!raw || typeof raw !== 'object') return null;
  const b = raw as Record<string, unknown>;
  const ids = Array.isArray(b.rencontre_ids) ? [...new Set(b.rencontre_ids)] : [];
  if (typeof b.club_id !== 'string' || !uuid.test(b.club_id)) return null;
  if (ids.length === 0 || ids.length > MAX_RENCONTRES || !ids.every(id => typeof id === 'string' && uuid.test(id))) return null;
  const length = b.length ?? 'short';
  const tone = b.tone ?? 'fun';
  if (length !== 'short' && length !== 'normal') return null;
  if (tone !== 'fun' && tone !== 'serious') return null;
  const extras: Body['extras'] = {};
  if (b.extras && typeof b.extras === 'object') {
    for (const id of ids as string[]) {
      const e = (b.extras as Record<string, unknown>)[id] as Record<string, unknown> | undefined;
      if (e && typeof e === 'object') extras[id] = { note: str(e.note, 300), contexte: str(e.contexte, 200) };
    }
  }
  return { club_id: b.club_id, rencontre_ids: ids as string[], extras, consigne: str(b.consigne, 500), length, tone, previous: str(b.previous, 6000) };
}

/**
 * Paragraphe rendu par le modèle, nettoyé : aucune image Markdown (seul l'écran du BO place des
 * images ; une URL écrite par le modèle serait inventée, donc cassée), pas de gras ni d'italique
 * Markdown (texte brut), pas de ligne vide interne.
 */
function cleanParagraph(value: unknown): string {
  return str(value, 3000)
    .replace(/!\[[^\]\n]*\]\([^)\n]*\)/g, '')
    .replace(/\*{1,3}([^*\n]+?)\*{1,3}/g, '$1')
    .split('\n').map(line => line.trim()).filter(Boolean).join('\n');
}

function log(entry: Record<string, unknown>) {
  console.log(JSON.stringify({ fn: 'generate-post', ...entry }));
}

Deno.serve(async req => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers });
  if (req.method !== 'POST') return json(405, { error: 'Méthode non autorisée.' });
  const started = Date.now();
  let clubId: string | null = null;
  try {
    const authorization = req.headers.get('Authorization');
    if (!authorization?.startsWith('Bearer ')) return json(401, { error: 'Connexion requise.' });
    const client = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_ANON_KEY')!, { global: { headers: { Authorization: authorization } } });
    const { data: { user }, error: authError } = await client.auth.getUser();
    if (authError || !user) return json(401, { error: 'Session expirée. Reconnectez-vous.' });
    const apiKey = Deno.env.get('ANTHROPIC_API_KEY');
    if (!apiKey) return json(503, { error: 'La génération n’est pas disponible. Rédigez l’actu à la main.' });
    const raw = await req.text();
    if (raw.length > 50_000) return json(413, { error: 'Requête trop volumineuse.' });
    let parsed: unknown;
    try { parsed = JSON.parse(raw); } catch { return json(400, { error: 'Requête invalide.' }); }
    const body = parseBody(parsed);
    if (!body) return json(400, { error: `Requête invalide : choisissez entre 1 et ${MAX_RENCONTRES} rencontres.` });
    clubId = body.club_id;

    const globalLimit = Number(Deno.env.get('POST_GEN_GLOBAL_DAILY_LIMIT') ?? '300');
    const { data: remaining, error: quotaError } = await client.rpc('post_gen_check', { p_club: body.club_id, p_global_daily_limit: Number.isFinite(globalLimit) ? globalLimit : 300 });
    if (quotaError) {
      const status = quotaError.code === '42501' ? 403 : quotaError.code === 'PT429' ? 429 : 400;
      log({ club_id: clubId, status: status === 429 ? 'quota' : 'refused', latency_ms: Date.now() - started });
      return json(status, { error: quotaError.message });
    }

    // Faits relus en base : la RLS et le filtre club écartent toute rencontre d'un autre club.
    const club = body.club_id;
    const { data: rencontres, error: rError } = await client.from('team_rencontres')
      .select('id,etape_id,club_adverse,date_heure,domicile,score_club,score_adverse,wo').eq('club_id', club).in('id', body.rencontre_ids);
    if (rError) throw rError;
    if (!rencontres || rencontres.length !== body.rencontre_ids.length) return json(404, { error: 'Rencontre introuvable pour ce club.' });
    const { data: etapes, error: eError } = await client.from('team_etapes')
      .select('id,equipe_id,phase,numero_journee,stade_finale').eq('club_id', club).in('id', rencontres.map(r => r.etape_id));
    if (eError) throw eError;
    const { data: equipes, error: qError } = await client.from('team_equipes')
      .select('id,competition_id,numero,division').eq('club_id', club).in('id', [...new Set((etapes ?? []).map(e => e.equipe_id))]);
    if (qError) throw qError;
    const { data: competitions, error: cError } = await client.from('team_competitions')
      .select('id,nom,type,genre,categorie,format').eq('club_id', club).in('id', [...new Set((equipes ?? []).map(e => e.competition_id))]);
    if (cError) throw cError;
    const { data: lines, error: lError } = await client.from('team_match_lines')
      .select('rencontre_id,match_type,slot,ordre,joueurs_club,score,gagnant,result_kind').eq('club_id', club).in('rencontre_id', body.rencontre_ids);
    if (lError) throw lError;

    const sources = [];
    for (const rencontre of rencontres) {
      const etape = etapes?.find(e => e.id === rencontre.etape_id);
      const equipe = equipes?.find(e => e.id === etape?.equipe_id);
      const competition = competitions?.find(c => c.id === equipe?.competition_id);
      if (!etape || !equipe || !competition) return json(404, { error: 'Rencontre introuvable pour ce club.' });
      sources.push({ rencontre, etape, equipe, competition, lines: (lines ?? []).filter(l => l.rencontre_id === rencontre.id) });
    }
    const { facts, warnings, ids } = buildPostFacts({ rencontres: sources, extras: body.extras });

    const request = {
      options: { longueur: body.length, ton: body.tone },
      consigne: body.consigne || null,
      texte_precedent: body.previous || null,
      rencontres: facts,
    };
    const anthropic = new Anthropic({ apiKey, timeout: 30_000, maxRetries: 1 });
    const message = await anthropic.messages.create({
      model: MODEL,
      // Réflexion désactivée (permis sur Haiku 5.5 à effort low) : sinon ses tokens consomment
      // max_tokens et tronquent le texte (incident du 13/11/2026).
      max_tokens: 4000,
      thinking: { type: 'disabled' },
      output_config: { effort: 'low', format: { type: 'json_schema', schema: SCHEMA } },
      system: SYSTEM_PROMPT,
      messages: [{ role: 'user', content: `Rédige la publication à partir de ces faits :\n${JSON.stringify(request, null, 1)}` }],
    });
    const usage = { input_tokens: message.usage?.input_tokens ?? 0, output_tokens: message.usage?.output_tokens ?? 0 };
    const block = message.stop_reason === 'end_turn' ? message.content.find(b => b.type === 'text') : undefined;
    let output: { titre?: unknown; paragraphes?: unknown; warnings?: unknown } | null = null;
    if (block && block.type === 'text') { try { output = JSON.parse(block.text); } catch { output = null; } }
    // Un paragraphe par élément (lignes vides internes resserrées) ; `rencontres` dit lesquelles il
    // raconte : le BO y accroche le visuel « Esprit d'équipe » de chacune (`anchors`).
    const paragraphes = (Array.isArray(output?.paragraphes) ? output.paragraphes as { texte?: unknown; rencontres?: unknown }[] : [])
      .map(p => ({ texte: cleanParagraph(p?.texte), refs: Array.isArray(p?.rencontres) ? p.rencontres.filter(r => typeof r === 'string') : [] }))
      .filter(p => p.texte);
    const texte = paragraphes.map(p => p.texte).join('\n\n').slice(0, 6000);
    const anchors: Record<string, string> = {};
    for (const p of paragraphes) {
      for (const ref of p.refs) {
        const id = ids[Number(/^R(\d+)$/.exec(ref)?.[1]) - 1];
        if (id && !anchors[id]) anchors[id] = p.texte;
      }
    }
    if (!output || !texte) {
      log({ club_id: clubId, status: message.stop_reason === 'refusal' ? 'model_refusal' : 'unusable_output', stop_reason: message.stop_reason, ...usage, latency_ms: Date.now() - started });
      return json(502, { error: FAILED });
    }

    const { error: recordError } = await client.rpc('post_gen_record', { p_club: body.club_id, p_input_tokens: usage.input_tokens, p_output_tokens: usage.output_tokens });
    if (recordError) log({ club_id: clubId, status: 'record_failed', code: recordError.code });
    const modelWarnings = Array.isArray(output.warnings) ? output.warnings.map(w => str(w, 300)).filter(Boolean).slice(0, 10) : [];
    log({ club_id: clubId, status: 'ok', rencontres: facts.length, ...usage, latency_ms: Date.now() - started });
    return json(200, {
      titre: str(output.titre, 120),
      text: texte,
      anchors,
      warnings: [...warnings, ...modelWarnings],
      remaining: typeof remaining === 'number' ? Math.max(remaining - 1, 0) : null,
    });
  } catch (error) {
    const timeout = error instanceof Anthropic.APIConnectionTimeoutError;
    const busy = error instanceof Anthropic.RateLimitError || (error instanceof Anthropic.APIError && error.status === 529);
    // Diagnostic sans contenu : classe, statut HTTP et type d'erreur de l'API. Le message n'est
    // gardé que pour une erreur de l'API Anthropic (il décrit la requête, pas les faits envoyés).
    const api = error instanceof Anthropic.APIError ? error : null;
    log({
      club_id: clubId, status: timeout ? 'timeout' : busy ? 'api_busy' : 'error', latency_ms: Date.now() - started,
      error_name: error instanceof Error ? error.name : typeof error,
      ...(api ? { http_status: api.status, api_error: String(api.message ?? '').slice(0, 300) } : {}),
    });
    if (timeout) return json(504, { error: 'La génération a pris trop de temps. Réessayez.' });
    if (busy) return json(503, { error: 'Service de génération saturé. Réessayez dans une minute.' });
    return json(502, { error: FAILED });
  }
});
