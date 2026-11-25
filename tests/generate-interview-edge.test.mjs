import test from 'node:test';
import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { mkdir } from 'node:fs/promises';
import { buildInterviewFacts, nameKey } from '../shared/interviewFacts.ts';

const P = (prenom, nom, classement = '30') => ({ prenom, nom, classement });
const sets = (s) => ({
  set1_j1: s[0][0], set1_j2: s[0][1], set1_tb_j1: s[0][2] ?? null, set1_tb_j2: s[0][3] ?? null,
  set2_j1: s[1]?.[0] ?? null, set2_j2: s[1]?.[1] ?? null, set2_tb_j1: null, set2_tb_j2: null,
  set3_j1: s[2]?.[0] ?? null, set3_j2: s[2]?.[1] ?? null, set3_tb_j1: null, set3_tb_j2: null,
});
const live = (side, date, j1, j2, score, winner, extra = {}) => ({
  source: 'live', date, side, match_type: 'simple', j1, j2, j3: null, j4: null,
  ...sets(score), set3_format: null, winner, retired_player: null, ...extra,
});

// Joueuse du club en j2 : premier set perdu 6-7 (5), puis 6-2 6-3 contre mieux classée.
function raw() {
  const snapshots = [];
  let a = 0, b = 0;
  for (const side of ['j1', 'j1', 'j1', 'j2', 'j2', 'j2', 'j2', 'j2', 'j2']) {
    if (side === 'j1') a++; else b++;
    snapshots.push({ set1_j1: 7, set1_j2: 6, set2_j1: a, set2_j2: b, at: `2026-11-19T10:${String(snapshots.length).padStart(2, '0')}:00Z` });
  }
  return {
    side: 'j2',
    player: { prenom: 'Élodie', nom: 'Dupré' },
    match: {
      ...live('j2', '2026-11-19T12:00:00Z', P('Alex', 'Martin', '15/2'), P('Élodie', 'Dupré', '15/5'),
        [[7, 6, 7, 5], [3, 6], [3, 6]], 'j2', { first_server: 'j1', finished_at: '2026-11-19T12:00:00Z' }),
      court: '2', started_at: '2026-11-19T10:00:00Z', set1_ended_at: null, set2_ended_at: null,
    },
    recap: { messages: 4, photos: 2, reactions: 9, viewers: 12, score: [{ set1_j1: 7, set1_j2: 6, set2_j1: 0, set2_j2: 0, at: '2026-11-19T10:00:00Z' }, ...snapshots] },
    event: null,
    team: { club_adverse: 'TC Voisin', score_club: 3, score_adverse: 1, competition: 'Interclubs', equipe: 2 },
    history: [
      live('j1', '2026-11-10T12:00:00Z', P('Élodie', 'Dupré'), P('Zoé', 'Faure'), [[6, 1], [6, 1]], 'j1'),
      live('j2', '2026-11-01T12:00:00Z', P('alex', 'MARTIN'), P('Élodie', 'Dupré'), [[6, 2], [6, 2]], 'j1'),
    ],
    team_history: [{ source: 'team', date: '2026-11-05T12:00:00Z', match_type: 'simple', joueurs_adverse: [P('Paul PIERRE', '')],
      score: '6-4 6-4', gagnant: 'club', result_kind: 'normal', club_adverse: 'AS Rivale' }],
    previous_interviews: [{ date: '2026-11-10T13:00:00Z', opponent: 'Zoé Faure',
      questions: [{ id: 'q1', texte: 'Ton secret ?' }, { id: 'q2', texte: 'Passée ?' }],
      answers: [{ question_id: 'q1', texte: 'Le service.' }, { question_id: 'q2', texte: '' }] }],
  };
}

test('interview facts: player point of view, highlight, history, continuity, first names only', () => {
  assert.equal(nameKey(P('Jean-Marc', 'Dupré')), 'jeanmarcdupre', 'same key as live_name_key');
  const f = buildInterviewFacts(raw());
  assert.equal(f.joueur, 'Élodie');
  assert.equal(f.match.resultat, 'victoire');
  assert.deepEqual(f.match.score, ['6-7 (5)', '6-3', '6-3'], 'sets read from the j2 side');
  assert.equal(f.match.perf, true, 'win against a better ranked opponent');
  assert.equal(f.match.duree_minutes, 120);
  assert.match(f.match.moment_fort, /Mené 0–3, Élodie retourne la situation/);
  assert.ok(f.match.breaks.pour >= 1);
  assert.deepEqual(f.match.adversaires, [{ prenom: 'Alex', classement: '15/2' }]);
  assert.equal(f.cadre.adversaire, 'TC Voisin');
  assert.equal(f.cadre.score_rencontre, '3-1');
  assert.deepEqual(f.ambiance, { spectateurs: 12, messages: 4, photos: 2, reactions: 9 });
  assert.deepEqual(f.historique.map((h) => h.resultat), ['victoire', 'victoire', 'défaite']);
  assert.deepEqual(f.historique[1].contre, ['Paul'], 'Ten’Up surname removed');
  assert.equal(f.serie, '3 victoires de suite');
  assert.deepEqual(f.face_a_face, [{ date: '1 novembre', resultat: 'défaite', score: '2-6 2-6' }], 'same opponent, any case');
  assert.deepEqual(f.interviews_precedentes, [{ date: '10 novembre', contre: 'Zoé', echanges: [{ question: 'Ton secret ?', reponse: 'Le service.' }] }]);
  const serialized = JSON.stringify(f);
  for (const surname of ['Martin', 'MARTIN', 'Dupré', 'Faure', 'PIERRE']) assert.ok(!serialized.includes(surname), `${surname} never leaves`);
});

test('generate-interview: rights and quota before Claude, questions saved by the service role', async () => {
  const dir = new URL('../node_modules/.tmp/generate-interview-edge/', import.meta.url);
  await mkdir(dir, { recursive: true });
  const out = new URL('edge.mjs', dir);
  await build({
    entryPoints: [new URL('../supabase/functions/generate-interview/index.ts', import.meta.url).pathname], outfile: out.pathname, bundle: true, platform: 'node', format: 'esm',
    plugins: [{ name: 'mocks', setup(b) {
      b.onResolve({ filter: /^https:/ }, () => ({ path: 'supabase', namespace: 'mock' }));
      b.onResolve({ filter: /^npm:@anthropic-ai\/sdk/ }, () => ({ path: 'anthropic', namespace: 'mock' }));
      b.onLoad({ filter: /^supabase$/, namespace: 'mock' }, () => ({ contents: 'export const createClient=(...args)=>globalThis.__ivClient(...args);' }));
      b.onLoad({ filter: /^anthropic$/, namespace: 'mock' }, () => ({ contents: `class APIError extends Error { constructor(status){ super('api'); this.status=status; } }
        class RateLimitError extends APIError {} class APIConnectionTimeoutError extends Error {}
        export default class Anthropic { static APIError=APIError; static RateLimitError=RateLimitError; static APIConnectionTimeoutError=APIConnectionTimeoutError;
          constructor(options){ this.messages={create:p=>globalThis.__ivCreate(p)}; } }` }));
    } }],
  });
  const previous = { Deno: globalThis.Deno, log: console.log };
  const ID = '00000000-0000-0000-0000-0000000000aa';
  let handler, user = { id: 'u103' }, key = 'sk', begin = { data: { status: 'pending', facts: raw() }, error: null }, params = null;
  const calls = [];
  let reply = { stop_reason: 'end_turn', usage: { input_tokens: 800, output_tokens: 90 }, content: [{ type: 'text', text: JSON.stringify({
    questions: ['1. **Mené 0-3**, qu’est-ce qui a changé ?', '- Et ce premier set au tie-break ?', ' ', 'Q3 ?', 'Q4 ?', 'Q5 ?'] }) }] };
  globalThis.Deno = { serve: (fn) => { handler = fn; }, env: { get: (n) => n === 'ANTHROPIC_API_KEY' ? key : n === 'INTERVIEW_GEN_GLOBAL_DAILY_LIMIT' ? '200' : n } };
  globalThis.__ivClient = (url, apiKey) => ({
    auth: { getUser: async () => ({ data: { user }, error: user ? null : { message: 'expired' } }) },
    rpc: async (name, args) => {
      calls.push([name, apiKey, args]);
      if (name === 'interview_gen_begin') return begin;
      return { data: args.p_questions.map((t, i) => ({ id: `q${i + 1}`, texte: t })), error: null };
    },
  });
  let created = 0;
  globalThis.__ivCreate = async (p) => { created++; params = p; if (reply instanceof Error) throw reply; return reply; };
  const logs = [];
  console.log = (line) => logs.push(line);
  const request = (body = { interview_id: ID }, auth = 'Bearer jwt') => new Request('https://x/functions/v1/generate-interview', {
    method: 'POST', headers: auth ? { Authorization: auth } : {}, body: JSON.stringify(body) });
  try {
    await import(out.href);
    assert.equal((await handler(request(undefined, null))).status, 401);
    assert.equal((await handler(request({ interview_id: 'x' }))).status, 400);
    for (const [code, status] of [['42501', 403], ['P0002', 404], ['PT429', 429]]) {
      begin = { data: null, error: { code, message: 'Refusé.' } };
      const res = await handler(request());
      assert.equal(res.status, status);
      assert.equal((await res.json()).error, 'Refusé.');
    }
    assert.equal(created, 0, 'no Claude call when refused');

    begin = { data: { status: 'ready', questions: [{ id: 'q1', texte: 'Déjà prête ?' }] }, error: null };
    assert.deepEqual((await (await handler(request())).json()).questions, [{ id: 'q1', texte: 'Déjà prête ?' }]);
    assert.equal(created, 0, 'ready questions are not regenerated');

    begin = { data: { status: 'pending', facts: raw() }, error: null };
    calls.length = 0;
    const ok = await handler(request());
    assert.equal(ok.status, 200);
    assert.deepEqual((await ok.json()).questions.map((q) => q.texte),
      ['Mené 0-3, qu’est-ce qui a changé ?', 'Et ce premier set au tie-break ?', 'Q3 ?', 'Q4 ?']);
    assert.equal(params.model, 'claude-haiku-5-5');
    assert.match(params.system, /Tutoiement/);
    assert.ok(!params.messages[0].content.includes('Dupré'), 'first names only');
    assert.deepEqual(calls.map(([name, apiKey]) => [name, apiKey]),
      [['interview_gen_begin', 'SUPABASE_ANON_KEY'], ['interview_gen_save', 'SUPABASE_SERVICE_ROLE_KEY']]);
    assert.equal(calls[1][2].p_member, 'u103', 'saved for the authenticated player');
    assert.ok(logs.every((l) => !l.includes('Mené')), 'no question in logs');

    reply = { stop_reason: 'end_turn', usage: {}, content: [{ type: 'text', text: '{"questions":["Une seule ?"]}' }] };
    assert.equal((await handler(request())).status, 502, 'fewer than 2 questions');
    key = undefined;
    assert.equal((await handler(request())).status, 503);
  } finally {
    globalThis.Deno = previous.Deno;
    console.log = previous.log;
    delete globalThis.__ivClient;
    delete globalThis.__ivCreate;
  }
});
