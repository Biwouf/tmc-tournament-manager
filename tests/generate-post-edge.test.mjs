import test from 'node:test';
import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { mkdir, rm } from 'node:fs/promises';
import { buildPostFacts, firstName, FORMAT_POINTS } from '../shared/teamPostFacts.mjs';
import { FORMAT_SPECS } from '../src/components/teamMatches/teamMatchLabels.ts';

const CLUB = '00000000-0000-0000-0000-000000000001';
const R1 = '00000000-0000-0000-0000-0000000000a1';
const R2 = '00000000-0000-0000-0000-0000000000a2';

// Base simulée : deux rencontres du club 1, la seconde avec un score global incohérent.
function database() {
  return {
    team_rencontres: [
      { id: R1, club_id: CLUB, etape_id: 'e1', club_adverse: 'TC Voisin', date_heure: '2026-11-08T13:00:00Z', domicile: true, score_club: 3, score_adverse: 1, wo: false },
      { id: R2, club_id: CLUB, etape_id: 'e2', club_adverse: 'AS Rivale', date_heure: '2026-11-09T13:00:00Z', domicile: false, score_club: 3, score_adverse: 0, wo: false },
    ],
    team_etapes: [
      { id: 'e1', club_id: CLUB, equipe_id: 'q1', phase: 'poule', numero_journee: 3, stade_finale: null },
      { id: 'e2', club_id: CLUB, equipe_id: 'q2', phase: 'finale', numero_journee: null, stade_finale: '1/2' },
    ],
    team_equipes: [
      { id: 'q1', club_id: CLUB, competition_id: 'c1', numero: 1, division: 'R1A' },
      { id: 'q2', club_id: CLUB, competition_id: 'c2', numero: 2, division: 'D2' },
    ],
    team_competitions: [
      { id: 'c1', club_id: CLUB, nom: 'Interclubs', type: 'adultes', genre: 'hommes', categorie: '35_ans', format: '3S1D' },
      { id: 'c2', club_id: CLUB, nom: 'Coupe jeunes', type: 'jeunes', genre: 'filles', categorie: '13/14 ans', format: '2S1D' },
    ],
    team_match_lines: [
      { rencontre_id: R1, club_id: CLUB, match_type: 'double', slot: 1, ordre: 4, joueurs_club: [{ prenom: 'Paul', nom: 'Martin' }, { prenom: 'Luc', nom: 'Petit' }], score: '6-3 6-4', gagnant: 'club', result_kind: 'normal' },
      { rencontre_id: R1, club_id: CLUB, match_type: 'simple', slot: 1, ordre: 1, joueurs_club: [{ prenom: 'Jean DUPONT', nom: '' }], score: '6-4 3-6 10-8', gagnant: 'club', result_kind: 'normal' },
      { rencontre_id: R1, club_id: CLUB, match_type: 'simple', slot: 2, ordre: 2, joueurs_club: [{ prenom: 'Marc', nom: 'Durand' }], score: '2-6 2-6', gagnant: 'adverse', result_kind: 'normal' },
      { rencontre_id: R1, club_id: CLUB, match_type: 'simple', slot: 3, ordre: 3, joueurs_club: [{ prenom: 'Hugo', nom: 'Bernard' }], score: null, gagnant: 'club', result_kind: 'wo' },
      { rencontre_id: R2, club_id: CLUB, match_type: 'simple', slot: 1, ordre: 1, joueurs_club: [{ prenom: 'Léa', nom: 'Roux' }], score: '6-0 6-0', gagnant: 'club', result_kind: 'normal' },
      { rencontre_id: R2, club_id: CLUB, match_type: 'simple', slot: 2, ordre: 2, joueurs_club: [{ prenom: 'Zoé', nom: 'Faure' }], score: '1-6 1-6', gagnant: 'adverse', result_kind: 'normal' },
      { rencontre_id: R2, club_id: CLUB, match_type: 'double', slot: 1, ordre: 3, joueurs_club: [{ prenom: 'Léa', nom: 'Roux' }, { prenom: 'Zoé', nom: 'Faure' }], score: '6-2 6-2', gagnant: 'club', result_kind: 'normal' },
    ],
  };
}

// Requêtes supabase-js simulées : select / eq / in, résolues comme une promesse.
function query(rows) {
  let result = rows;
  const q = {
    select: () => q,
    eq: (col, value) => { result = result.filter(r => r[col] === value); return q; },
    in: (col, values) => { result = result.filter(r => values.includes(r[col])); return q; },
    then: (resolve, reject) => Promise.resolve({ data: result, error: null }).then(resolve, reject),
  };
  return q;
}

test('shared facts: first names only, singles first, code-side coherence warnings', () => {
  for (const [format, spec] of Object.entries(FORMAT_SPECS)) assert.deepEqual(FORMAT_POINTS[format], spec, `format ${format} in sync`);
  assert.equal(firstName({ prenom: 'Jean DUPONT' }), 'Jean');
  assert.equal(firstName({ prenom: 'Jean-Marc' }), 'Jean-Marc');
  assert.equal(firstName({ prenom: 'Marie Claire', nom: 'X' }), 'Marie Claire');
  assert.equal(firstName({ prenom: 'A' }), 'A', 'a single capital letter is kept');

  const db = database();
  const source = id => {
    const rencontre = db.team_rencontres.find(r => r.id === id);
    const etape = db.team_etapes.find(e => e.id === rencontre.etape_id);
    const equipe = db.team_equipes.find(e => e.id === etape.equipe_id);
    return { rencontre, etape, equipe, competition: db.team_competitions.find(c => c.id === equipe.competition_id), lines: db.team_match_lines.filter(l => l.rencontre_id === id) };
  };
  const { facts, warnings } = buildPostFacts({ rencontres: [source(R1), source(R2)], extras: { [R1]: { note: '  Premier match en équipe adulte pour Hugo  ', contexte: '1re place en jeu' } } });
  const r1 = facts.find(f => f.adversaire === 'TC Voisin');
  assert.equal(r1.equipe, 'Messieurs +35 ans');
  assert.equal(r1.resultat, 'victoire');
  assert.equal(r1.lieu, 'domicile');
  assert.equal(r1.journee, 'journée 3');
  assert.equal(r1.date, 'dimanche 8 novembre');
  assert.deepEqual(r1.matchs.map(m => m.type), ['simple', 'simple', 'simple', 'double'], 'singles first');
  assert.deepEqual(r1.matchs[0].joueurs, ['Jean'], 'the Ten’Up surname is removed');
  assert.equal(r1.matchs[2].issue, 'forfait');
  assert.equal(r1.note, 'Premier match en équipe adulte pour Hugo');
  const r2 = facts.find(f => f.adversaire === 'AS Rivale');
  assert.equal(r2.equipe, 'Filles 13/14 ans (équipe 2)');
  assert.equal(r2.jeunes, true);
  assert.equal(r2.journee, 'demi-finale');
  const serialized = JSON.stringify(facts);
  for (const surname of ['Martin', 'Petit', 'DUPONT', 'Durand', 'Bernard', 'Roux', 'Faure']) assert.ok(!serialized.includes(surname), `${surname} never leaves`);
  assert.deepEqual(warnings, ['Filles 13/14 ans (équipe 2) contre AS Rivale : le score global (3-0) ne correspond pas aux matchs (2-1).']);
});

test('generate-post: admin + quota before Claude, facts from the database, counted after success', async () => {
  const dir = new URL('../node_modules/.tmp/generate-post-edge/', import.meta.url); await mkdir(dir, { recursive: true });
  const out = new URL('edge.mjs', dir);
  await build({
    entryPoints: [new URL('../supabase/functions/generate-post/index.ts', import.meta.url).pathname], outfile: out.pathname, bundle: true, platform: 'node', format: 'esm',
    plugins: [{ name: 'mocks', setup(b) {
      b.onResolve({ filter: /^https:/ }, () => ({ path: 'supabase', namespace: 'mock' }));
      b.onResolve({ filter: /^npm:@anthropic-ai\/sdk/ }, () => ({ path: 'anthropic', namespace: 'mock' }));
      b.onLoad({ filter: /^supabase$/, namespace: 'mock' }, () => ({ contents: 'export const createClient=(...args)=>globalThis.__genClient(...args);' }));
      b.onLoad({ filter: /^anthropic$/, namespace: 'mock' }, () => ({ contents: `class APIError extends Error { constructor(status){ super('api'); this.status=status; } }
        class RateLimitError extends APIError {} class APIConnectionTimeoutError extends Error {}
        export default class Anthropic { static APIError=APIError; static RateLimitError=RateLimitError; static APIConnectionTimeoutError=APIConnectionTimeoutError;
          constructor(options){ globalThis.__genOptions=options; this.messages={create:p=>globalThis.__genCreate(p)}; } }` }));
    } }],
  });
  const previous = { Deno: globalThis.Deno, log: console.log };
  const logs = [];
  let handler, user = { id: 'admin' }, key = 'sk-secret', quotaError = null, db = database(), params = null;
  const rpcs = [];
  let reply = { stop_reason: 'end_turn', usage: { input_tokens: 900, output_tokens: 200 }, content: [{ type: 'thinking', thinking: '' }, { type: 'text', text: JSON.stringify({
    titre: 'Week-end des équipes', paragraphes: [
      { texte: 'Les messieurs +35 ans\n🟢 Victoire 3-1 face au TC Voisin.', rencontres: ['R2'] },
      { texte: '***Les filles***\n\n🔴 Demi-finale contre l’AS Rivale.\n![Légende](https://inventee.example/photo.png)', rencontres: ['R1', 'R9', 'x'] },
      { texte: '![](https://inventee.example/seule.png)', rencontres: ['R1'] },
      { texte: 'Merci aux joueurs et aux supporters !', rencontres: [] },
    ],
    warnings: ['Le score de la rencontre contre AS Rivale ne colle pas aux matchs.'],
  }) }] };
  globalThis.Deno = { serve: fn => { handler = fn; }, env: { get: name => name === 'ANTHROPIC_API_KEY' ? key : name === 'POST_GEN_GLOBAL_DAILY_LIMIT' ? '300' : name } };
  globalThis.__genClient = () => ({
    auth: { getUser: async () => ({ data: { user }, error: user ? null : { message: 'expired' } }) },
    rpc: async (name, args) => { rpcs.push([name, args]); return name === 'post_gen_check' ? { data: quotaError ? null : 7, error: quotaError } : { data: null, error: null }; },
    from: table => query(db[table]),
  });
  let created = 0;
  globalThis.__genCreate = async p => { created++; params = p; if (reply instanceof Error) throw reply; return reply; };
  console.log = line => logs.push(line);
  const body = { club_id: CLUB, rencontre_ids: [R1, R2], extras: { [R1]: { note: 'perf', contexte: '' } }, length: 'short', tone: 'fun', consigne: 'Mentionne la météo' };
  const request = (payload = body, auth = true) => new Request('https://edge.example', { method: 'POST', headers: auth ? { Authorization: 'Bearer user-token' } : {}, body: typeof payload === 'string' ? payload : JSON.stringify(payload) });
  try {
    await import(out.href);
    assert.equal((await handler(request(body, false))).status, 401);
    user = null; assert.equal((await handler(request())).status, 401); user = { id: 'admin' };
    key = undefined; assert.equal((await handler(request())).status, 503); key = 'sk-secret';
    assert.equal((await handler(request({ ...body, rencontre_ids: [] }))).status, 400);
    assert.equal((await handler(request({ ...body, rencontre_ids: ['x'] }))).status, 400);
    assert.equal((await handler(request({ ...body, tone: 'sarcastique' }))).status, 400);
    assert.equal((await handler(request('{'))).status, 400);
    assert.equal(rpcs.length, 0); assert.equal(created, 0, 'nothing reaches Claude before identity and input are checked');

    quotaError = { code: '42501', message: 'Réservé aux administrateurs du club.' };
    assert.equal((await handler(request())).status, 403, 'a member, a manager or another club’s admin is refused');
    quotaError = { code: 'PT429', message: 'Limite de 30 générations ce mois-ci atteinte pour le club.' };
    const limited = await handler(request());
    assert.equal(limited.status, 429);
    assert.deepEqual(await limited.json(), { success: false, error: 'Limite de 30 générations ce mois-ci atteinte pour le club.' });
    quotaError = null;
    assert.equal(created, 0, 'refused or over quota: no paid call');
    assert.ok(!rpcs.some(([name]) => name === 'post_gen_record'), 'nothing counted without a generation');

    // Rencontre d'un autre club : la RLS/le filtre club ne la rend pas, la fonction refuse.
    db.team_rencontres[1].club_id = 'other';
    assert.equal((await handler(request())).status, 404);
    assert.equal(created, 0);
    db = database();

    rpcs.length = 0;
    const response = await handler(request());
    assert.equal(response.status, 200);
    const result = await response.json();
    assert.equal(result.success, true);
    assert.equal(result.titre, 'Week-end des équipes');
    assert.equal(result.text, 'Les messieurs +35 ans\n🟢 Victoire 3-1 face au TC Voisin.\n\nLes filles\n🔴 Demi-finale contre l’AS Rivale.\n\nMerci aux joueurs et aux supporters !', 'one blank line between paragraphs, none inside, no model-written image or Markdown emphasis');
    // Faits triés par genre : R1 = filles (AS Rivale), R2 = hommes (TC Voisin). Repères inconnus ignorés.
    assert.deepEqual(result.anchors, { [R2]: 'Les filles\n🔴 Demi-finale contre l’AS Rivale.', [R1]: 'Les messieurs +35 ans\n🟢 Victoire 3-1 face au TC Voisin.' });
    assert.equal(result.remaining, 6);
    assert.equal(result.warnings[0], 'Filles 13/14 ans (équipe 2) contre AS Rivale : le score global (3-0) ne correspond pas aux matchs (2-1).', 'code-side warning first');
    assert.equal(result.warnings[1], 'Le score de la rencontre contre AS Rivale ne colle pas aux matchs.');
    assert.deepEqual(rpcs.map(([name]) => name), ['post_gen_check', 'post_gen_record'], 'counted after the successful call');
    assert.deepEqual(rpcs[1][1], { p_club: CLUB, p_input_tokens: 900, p_output_tokens: 200 });
    assert.equal(globalThis.__genOptions.apiKey, 'sk-secret');
    assert.equal(params.model, 'claude-haiku-5-5');
    assert.ok(params.max_tokens <= 4000);
    assert.deepEqual(params.thinking, { type: 'disabled' }, 'thinking would eat the output budget');
    assert.equal(params.output_config.format.type, 'json_schema');
    const sent = params.messages[0].content;
    assert.match(sent, /"consigne": "Mentionne la météo"/);
    assert.match(sent, /"note": "perf"/);
    for (const surname of ['Martin', 'DUPONT', 'Durand', 'Roux', 'user-token', 'admin']) assert.ok(!sent.includes(surname), `${surname} is not sent to Claude`);
    const okLog = JSON.parse(logs.at(-1));
    assert.deepEqual(Object.keys(okLog).sort(), ['club_id', 'fn', 'input_tokens', 'latency_ms', 'output_tokens', 'rencontres', 'status']);
    assert.ok(!logs.join('\n').match(/Paul|Jean|TC Voisin|Les messieurs|sk-secret/), 'logs carry neither content nor names');
    assert.match(sent, /"ref": "R1"/);

    rpcs.length = 0;
    reply = { stop_reason: 'refusal', usage: { input_tokens: 1, output_tokens: 0 }, content: [] };
    assert.equal((await handler(request())).status, 502);
    reply = { stop_reason: 'max_tokens', usage: { input_tokens: 1, output_tokens: 2000 }, content: [{ type: 'text', text: '{"titre":"x","tex' }] };
    assert.equal((await handler(request())).status, 502);
    assert.ok(!rpcs.some(([name]) => name === 'post_gen_record'), 'an unusable answer is not counted');

    reply = new Error('upstream sk-secret');
    const failed = await handler(request());
    assert.equal(failed.status, 502);
    assert.equal((await failed.text()).includes('sk-secret'), false);
  } finally {
    console.log = previous.log;
    if (previous.Deno === undefined) delete globalThis.Deno; else globalThis.Deno = previous.Deno;
    delete globalThis.__genClient; delete globalThis.__genCreate; delete globalThis.__genOptions;
    await rm(dir, { recursive: true, force: true });
  }
});

test('team spirit visuals go inline, right after the paragraph about their encounter', async () => {
  const { insertInlineImages } = await import('../src/lib/actuInlineImages.ts');
  const text = 'Récap du week-end ! 🎾\n\nLes dames\n🔴 Défaite face à l’AS Rivale.\n\nLes messieurs\n🟢 Victoire contre le TC Voisin.\n\nMerci à tous !';
  assert.equal(insertInlineImages(text, [{ adversaire: 'TC Voisin', url: 'https://x/v.jpg' }, { adversaire: 'AS RIVALE', url: 'https://x/r.jpg' }]),
    'Récap du week-end ! 🎾\n\nLes dames\n🔴 Défaite face à l’AS Rivale.\n\n![](https://x/r.jpg)\n\nLes messieurs\n🟢 Victoire contre le TC Voisin.\n\n![](https://x/v.jpg)\n\nMerci à tous !');
  assert.equal(insertInlineImages(text, [{ adversaire: 'Inconnu', url: 'u' }]).endsWith('Victoire contre le TC Voisin.\n\n![](u)\n\nMerci à tous !'), true, 'unmatched: before the closing thanks');
  assert.equal(insertInlineImages('Seul paragraphe.', [{ adversaire: 'X', url: 'u' }]), 'Seul paragraphe.\n\n![](u)');
  assert.equal(insertInlineImages(text, []), text);

  // Montauban (ATM 2) en base, « Montauban » dans le texte : l'adversaire ne se retrouve pas, le
  // paragraphe désigné par Claude si — même retouché hors de sa ligne principale.
  const generated = 'Récap !\n\nLes dames\n🔴 Défaite 0-3 à Montauban en Challenge d’Hiver.\n\nMerci !';
  const anchor = 'Les dames\n🔴 Défaite 0-3 à Montauban en Challenge d’Hiver.';
  assert.equal(insertInlineImages(generated.replace('Les dames', 'Côté dames'), [{ anchor, adversaire: 'ATM 2', url: 'u' }]),
    'Récap !\n\nCôté dames\n🔴 Défaite 0-3 à Montauban en Challenge d’Hiver.\n\n![](u)\n\nMerci !');
  assert.equal(insertInlineImages('Intro\n\nAutre chose\n\nFin', [{ anchor: 'paragraphe disparu après réécriture', adversaire: 'Rival', url: 'u' }]),
    'Intro\n\nAutre chose\n\n![](u)\n\nFin', 'anchor lost: fallback before the last paragraph');
});
