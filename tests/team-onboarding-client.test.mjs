// SaaS S6 — étape « Vos équipes » : déductions, choix de la saison, enchaînement saison →
// compétition → poule → équipe, avec un client Supabase simulé (aucun service externe).
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { createRequire } from 'node:module';
import vm from 'node:vm';
import ts from 'typescript';

const base = resolve(new URL('..', import.meta.url).pathname);
const req = createRequire(resolve(base, 'package.json'));
function load(relative) {
  const cache = new Map();
  function read(file) {
    if (cache.has(file)) return cache.get(file).exports;
    const mod = { exports: {} }; cache.set(file, mod);
    const code = ts.transpileModule(readFileSync(file, 'utf8'), { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS, esModuleInterop: true } }).outputText;
    const require = (name) => {
      if (!name.startsWith('.')) return req(name);
      const p = resolve(dirname(file), name);
      return read([p, `${p}.ts`, `${p}.tsx`].find(existsSync));
    };
    vm.runInThisContext(`(function(require,module,exports){${code}\n})`, { filename: file })(require, mod, mod.exports);
    return mod.exports;
  }
  return read(resolve(base, relative));
}
const labels = load('src/components/teamMatches/teamMatchLabels.ts');
const io = load('src/components/teamMatches/teamImport.ts');

test('genre, type and category from real Ten’Up championship names; never a guess', () => {
  const deduce = (nom) => { const d = io.deduceCompetition({ url: 'u', nom, format: '3S1D2', singles_set3_format: 'super_tiebreak' }); return [d.type, d.categorie, d.genre]; };
  assert.deepEqual(deduce('Championnat de France Interclubs Seniors Messieurs 2027'), ['adultes', 'Seniors', 'hommes']);
  assert.deepEqual(deduce('CHAMPIONNAT DEPARTEMENTAL SENIORS DAMES'), ['adultes', 'Seniors', 'femmes']);
  assert.deepEqual(deduce('GAN 70 MESSIEURS'), ['adultes', '+70 ans', 'hommes']);
  assert.deepEqual(deduce('Challenge Féminin Max Espiaut'), ['adultes', 'Seniors', 'femmes']);
  assert.deepEqual(deduce('Championnat +35 ans Hommes'), ['adultes', '+35 ans', 'hommes']);
  assert.deepEqual(deduce('Raquettes FFT Mixte'), ['adultes', 'Seniors', 'mixte']);
  assert.deepEqual(deduce('Coupe de Printemps 13/14 ans Garçons'), ['jeunes', '13/14 ans', 'garcons']);
  assert.deepEqual(deduce('Championnat 15/16 ans Filles'), ['jeunes', '15/16 ans', 'filles']);
  // Doute → null : le fondateur choisit.
  assert.deepEqual(deduce('Pyrénées Interclubs'), ['adultes', 'Seniors', null]);
  assert.deepEqual(deduce('Championnat Interclubs Seniors Plus 45'), ['adultes', '+45 ans', null]);
  assert.deepEqual(deduce('Championnat Seniors Messieurs et Dames'), ['adultes', 'Seniors', null]);
  assert.deepEqual(deduce('Championnat 17/18 ans Messieurs'), ['jeunes', '17/18 ans', null], 'Messieurs is not a youth genre');
  assert.deepEqual(deduce('Notre-Dame Open'), ['adultes', 'Seniors', null], 'singular "dame" is not a genre');
  assert.equal(labels.inferGenre('Mixte 11/12 ans', 'jeunes'), null);
  assert.equal(labels.inferType('+45 ans'), 'adultes');
  assert.equal(labels.inferType('11/12 ans'), 'jeunes');
  const missing = io.deduceCompetition({ url: 'u', nom: 'Pyrénées Interclubs', format: null, singles_set3_format: null });
  assert.deepEqual(io.missingFields(missing), ['genre', 'format', 'singles_set3_format']);
});

test('season: active reused, otherwise this sporting year (September → August), activated or created', () => {
  assert.equal(labels.seasonLabel(new Date(2026, 10, 7)), '2026/2027');
  assert.equal(labels.seasonLabel(new Date(2027, 7, 31)), '2026/2027');
  assert.equal(labels.seasonLabel(new Date(2027, 8, 1)), '2027/2028');
  const now = new Date(2026, 10, 7);
  const s = (label, actif) => ({ id: label, label, actif, created_at: '' });
  assert.deepEqual(io.chooseSeason([], now), { kind: 'create', label: '2026/2027' });
  assert.deepEqual(io.chooseSeason([s('2025/2026', false), s('2024', true)], now), { kind: 'reuse', saison: s('2024', true), activate: false });
  assert.deepEqual(io.chooseSeason([s('2025/2026', false), s('2026/2027', false)], now), { kind: 'reuse', saison: s('2026/2027', false), activate: true });
  assert.deepEqual(io.chooseSeason([s('2025/2026', false)], now), { kind: 'create', label: '2026/2027' });
});

test('helpers shared with CreateEquipeForm', () => {
  assert.equal(io.nextTeamNumber([], 'c'), 1);
  assert.equal(io.nextTeamNumber([{ competition_id: 'c', numero: 2 }, { competition_id: 'x', numero: 9 }], 'c'), 3);
  const pool = { teams: [{ id: '1', name: 'TC ALPHA 1' }, { id: '2', name: 'TC ALPHA 2' }, { id: '3', name: 'US BETA 1' }], rounds: [] };
  assert.deepEqual(io.clubTeamCandidates(pool, ['TC Alpha'], '', [{ competition_id: 'c', tenup_team_id: '1' }], 'c'), ['2']);
  const form = readFileSync(resolve(base, 'src/components/teamMatches/CreateEquipeForm.tsx'), 'utf8');
  assert.match(form, /nextTeamNumber\(/);
  assert.match(form, /clubTeamCandidates\(/);
});

// --- Enchaînement, client simulé ---
const POOL_URL = 'https://tenup.fft.fr/championnat/82145789?division=4&phase=1&poule=2';
const MATCH = (n) => `https://tenup.fft.fr/championnat/82145789/division/4/phase/1/poule/2/rencontre/${n}`;
const POOL = {
  division: 'Division 2', phase: 'Phase 1', poule: 'Poule B',
  teams: [{ id: '11', name: 'TC ALPHA 1' }, { id: '12', name: 'US BETA 1' }, { id: '13', name: 'AS GAMMA 1' }, { id: '14', name: 'RC DELTA 1' }],
  rounds: [
    { numero: 1, matches: [{ url: MATCH(1), home_id: '11', away_id: '12', date: '2026-11-15' }, { url: MATCH(2), home_id: '13', away_id: '14', date: '2026-11-15' }] },
    { numero: 2, matches: [{ url: MATCH(3), home_id: '13', away_id: '11', date: '2026-11-22' }, { url: MATCH(4), home_id: '12', away_id: '14', date: '2026-11-22' }] },
  ],
};
const refusal = (message, status = 400) => ({ data: null, error: { context: new Response(JSON.stringify({ error: message }), { status }) } });
function fakeClient({ saisons = [], competitions = [], equipes = [], competition = { nom: 'Championnat Seniors Messieurs', format: '3S1D2', singles_set3_format: 'super_tiebreak' }, invoke } = {}) {
  const db = { team_saisons: [...saisons], team_competitions: [...competitions], team_equipes: [...equipes] };
  const calls = [];
  const client = {
    db, calls,
    functions: { async invoke(name, { body }) {
      calls.push(['invoke', body.kind]);
      if (invoke) { const r = await invoke(body); if (r) return r; }
      if (body.kind === 'competition') return { data: { url: body.url, warnings: [], ...competition }, error: null };
      return { data: { id: 'preview-1', url: body.url, ...structuredClone(POOL) }, error: null };
    } },
    async rpc(name, args) { calls.push(['rpc', name, args]); return client.rpcResult ?? { data: 'equipe-1', error: null }; },
    from(table) {
      const filters = []; let op = null; let single = false;
      const q = {
        select() { return q; }, order() { return q; },
        eq(k, v) { filters.push((r) => r[k] === v); return q; },
        in(k, vs) { filters.push((r) => vs.includes(r[k])); return q; },
        single() { single = true; return q; },
        insert(payload) { calls.push(['insert', table, payload]); op = () => {
          if (table === 'team_competitions' && db[table].some((c) => c.saison_id === payload.saison_id && c.tenup_url?.split('?')[0] === payload.tenup_url.split('?')[0])) return { error: { code: '23505', message: 'duplicate' } };
          const row = { id: `${table}-${db[table].length + 1}`, created_at: '', ...payload }; db[table].push(row); return { data: [row] };
        }; return q; },
        update(payload) { calls.push(['update', table, payload]); op = () => { const rows = db[table].filter((r) => filters.every((f) => f(r))); rows.forEach((r) => Object.assign(r, payload)); return { data: rows }; }; return q; },
        then(resolve) {
          const out = op ? op() : { data: db[table].filter((r) => filters.every((f) => f(r))) };
          if (out.error) return resolve({ data: null, error: out.error });
          resolve({ data: single ? out.data[0] : out.data, error: null });
        },
      };
      return q;
    },
  };
  return client;
}
const reads = (client) => client.calls.filter((c) => c[0] === 'invoke').map((c) => c[1]);

test('new club: season created, championship read and created with its deductions, pool read, team recognised and created', async () => {
  const client = fakeClient();
  const saison = await io.ensureSeason(client, 'c1', new Date(2026, 10, 7));
  assert.deepEqual(client.calls.find((c) => c[0] === 'insert'), ['insert', 'team_saisons', { club_id: 'c1', label: '2026/2027', actif: true }]);
  const prepared = await io.prepareCompetition(client, 'c1', saison.id, POOL_URL);
  assert.deepEqual(prepared.draft, { nom: 'Championnat Seniors Messieurs', tenup_url: POOL_URL, type: 'adultes', categorie: 'Seniors', genre: 'hommes', format: '3S1D2', singles_set3_format: 'super_tiebreak' });
  const competition = await io.createCompetition(client, 'c1', saison.id, prepared.draft);
  assert.equal(competition.club_id, 'c1');
  const reading = await io.readPool(client, 'c1', competition, POOL_URL, ['TC Alpha'], 'Alphaville');
  assert.deepEqual(reading.candidates, ['11']);
  assert.equal(io.encounterCount(reading.preview, '11'), 2);
  await io.createTeamFromPool(client, 'c1', competition.id, reading, '11');
  assert.deepEqual(client.calls.find((c) => c[0] === 'rpc'), ['rpc', 'team_equipe_create', {
    p_club: 'c1', p_competition: competition.id, p_numero: 1, p_division: 'Division 2', p_journees: 2, p_preview: 'preview-1', p_team_id: '11',
  }]);
  assert.deepEqual(reads(client), ['competition', 'pool'], 'two Ten’Up reads');
});

test('second team of the same championship: no season, no competition read, no duplicate', async () => {
  const saison = { id: 's1', club_id: 'c1', label: '2026/2027', actif: true };
  const competition = { id: 'k1', club_id: 'c1', saison_id: 's1', nom: 'Championnat Seniors Messieurs', tenup_url: 'https://tenup.fft.fr/championnat/82145789?division=4&phase=1&poule=1' };
  const client = fakeClient({ saisons: [saison], competitions: [competition], equipes: [{ id: 'e1', club_id: 'c1', competition_id: 'k1', numero: 1, tenup_team_id: '99' }] });
  assert.equal((await io.ensureSeason(client, 'c1')).id, 's1');
  const prepared = await io.prepareCompetition(client, 'c1', 's1', POOL_URL);
  assert.equal(prepared.competition.id, 'k1', 'found by championship, other pool');
  const reading = await io.readPool(client, 'c1', prepared.competition, POOL_URL, ['TC Alpha'], '');
  await io.createTeamFromPool(client, 'c1', 'k1', reading, '11');
  assert.equal(client.calls.find((c) => c[0] === 'rpc')[2].p_numero, 1, 'number read from the Ten’Up name « TC ALPHA 1 »');
  assert.deepEqual(reads(client), ['pool'], 'one Ten’Up read');
  assert.equal(client.calls.filter((c) => c[0] === 'insert').length, 0);
  // Une compétition créée entre-temps (autre onglet, essai précédent) est reprise.
  const draft = { nom: 'x', tenup_url: POOL_URL, type: 'adultes', categorie: 'Seniors', genre: 'hommes', format: '3S1D2', singles_set3_format: 'normal' };
  assert.equal((await io.createCompetition(client, 'c1', 's1', draft)).id, 'k1');
  await assert.rejects(io.createCompetition(client, 'c1', 's1', { ...draft, genre: null }), /Précisez le genre/);
});

test('same pool pasted twice: the team is reported as already imported, no candidate left', async () => {
  const competition = { id: 'k1', club_id: 'c1', saison_id: 's1', tenup_url: POOL_URL };
  const client = fakeClient({ competitions: [competition], equipes: [{ id: 'e1', club_id: 'c1', competition_id: 'k1', numero: 1, tenup_team_id: '11', tenup_team_name: 'TC ALPHA 1' }] });
  const reading = await io.readPool(client, 'c1', competition, POOL_URL, ['TC Alpha'], '');
  assert.deepEqual(reading.candidates, []);
  assert.deepEqual(reading.alreadyImported.map((e) => e.id), ['e1']);
});

test('failures surface the server’s human message: quota, trial cap, invalid pool, worker down', async () => {
  const competition = { id: 'k1', club_id: 'c1', saison_id: 's1', tenup_url: POOL_URL };
  for (const message of ['Trop de demandes Ten’Up. Réessayez dans une minute.', 'Limite de l’essai atteinte : 20 lectures Ten’Up par 24 heures. Réessayez demain, ou ajoutez vos autres équipes plus tard depuis Matches par équipe.']) {
    const client = fakeClient({ invoke: () => refusal(message) });
    await assert.rejects(io.prepareCompetition(client, 'c1', 's1', POOL_URL), (err) => err.message === message);
    await assert.rejects(io.readPool(client, 'c1', competition, POOL_URL, [], ''), (err) => err.message === message);
  }
  const down = fakeClient({ invoke: () => refusal('Le calendrier Ten’Up est indisponible. Réessayez ou créez l’équipe manuellement.', 502) });
  await assert.rejects(io.readPool(down, 'c1', competition, POOL_URL, [], ''), /indisponible/);
  // Calendrier partiel : refusé par validateTenupPool, rien n'est créé.
  const partial = fakeClient({ invoke: (body) => body.kind === 'pool' && { data: { id: 'p', url: POOL_URL, ...POOL, rounds: [{ numero: 1, matches: [POOL.rounds[0].matches[0]] }] }, error: null } });
  await assert.rejects(io.readPool(partial, 'c1', competition, POOL_URL, [], ''), /Journées Ten’Up incomplètes/);
  assert.equal(partial.calls.filter((c) => c[0] === 'rpc').length, 0);
  // Lien qui n'est pas une poule : refusé avant toute lecture.
  const none = fakeClient();
  await assert.rejects(io.prepareCompetition(none, 'c1', 's1', 'https://tenup.fft.fr/championnat/82145789'), /lien Ten’Up de la poule/);
  await assert.rejects(io.prepareCompetition(none, 'c1', 's1', 'https://example.com/x'), /invalide/);
  assert.deepEqual(reads(none), []);
});

test('expired preview: the creation error is returned as is, the flow offers to read again', async () => {
  const competition = { id: 'k1', club_id: 'c1', saison_id: 's1', tenup_url: POOL_URL };
  const client = fakeClient({ competitions: [competition] });
  const reading = await io.readPool(client, 'c1', competition, POOL_URL, ['TC Alpha'], '');
  client.rpcResult = { data: null, error: { message: 'Aperçu expiré ou incomplet. Relancez la lecture Ten’Up.' } };
  await assert.rejects(io.createTeamFromPool(client, 'c1', 'k1', reading, '11'), (err) => /expiré/.test(io.errorMessage(err, '')));
});

// --- S6b : import de toutes les équipes du club depuis sa page Ten'Up ---
const club = load('src/components/teamMatches/clubImport.ts');
const POOL2 = 'https://tenup.fft.fr/championnat/82145789?division=4&phase=1&poule=3';
const OTHER = 'https://tenup.fft.fr/championnat/90000001?division=7&phase=1&poule=9';
const PAGE = {
  club: 'TC ALPHA', skipped: 0,
  teams: [
    { pool_url: POOL_URL, competition: 'Championnat Seniors Messieurs', team: 'TC ALPHA 1', level: 'Départemental', category: 'Senior', genre: 'Homme', dates: ['dimanche 15 novembre 2026', 'dimanche 22 novembre 2026'] },
    { pool_url: OTHER, competition: 'Pyrénées Interclubs', team: 'TC ALPHA 1', level: 'Régional', category: 'Senior', genre: 'Femme', dates: ['dimanche 22 novembre 2026'] },
    { pool_url: POOL2, competition: 'Championnat Seniors Messieurs', team: 'TC ALPHA 2', level: 'Départemental', category: 'Senior', genre: 'Homme', dates: ['dimanche 29 novembre 2026'] },
  ],
};

test('club page badges: gender and category are read, the Ten’Up number is kept', () => {
  assert.equal(io.badgeGenre('Femme', 'adultes'), 'femmes');
  assert.equal(io.badgeGenre('Homme', 'adultes'), 'hommes');
  assert.equal(io.badgeGenre('Homme', 'jeunes'), 'garcons');
  assert.equal(io.badgeGenre('Femme', 'jeunes'), 'filles');
  assert.equal(io.badgeGenre('Mixte', 'adultes'), 'mixte');
  assert.equal(io.badgeGenre('Mixte', 'jeunes'), null);
  assert.equal(io.badgeGenre('', 'adultes'), null);
  assert.equal(io.badgeCategorie('Senior'), 'Seniors');
  assert.equal(io.badgeCategorie('13/14 ans'), '13/14 ans');
  assert.equal(io.badgeCategorie('Régional'), null);
  // Le badge l'emporte ; le nom reste le repli.
  const d = io.deduceCompetition({ url: 'u', nom: 'Pyrénées Interclubs', format: '3S1D2', singles_set3_format: 'normal' }, { category: 'Senior', genre: 'Femme' });
  assert.deepEqual([d.type, d.categorie, d.genre], ['adultes', 'Seniors', 'femmes']);
  assert.equal(io.deduceCompetition({ url: 'u', nom: 'GAN 70 MESSIEURS', format: null, singles_set3_format: null }, {}).genre, 'hommes');
  assert.equal(io.teamNumber('CASTELSARRASIN TENNIS CLUB 4', [], 'c'), 4);
  assert.equal(io.teamNumber('ENTENTE SANS NUMERO', [{ competition_id: 'c', numero: 2 }], 'c'), 3);
});

test('club page grouped by championship; already imported teams are flagged; pool team found by exact name', () => {
  const competitions = [{ id: 'k1', saison_id: 's1', tenup_url: POOL_URL }];
  const equipes = [{ id: 'e1', competition_id: 'k1', tenup_source_url: POOL_URL, tenup_team_name: 'tc  alpha 1', tenup_team_id: '11' }];
  const groups = club.groupClubTeams(PAGE, competitions, equipes);
  assert.deepEqual(groups.map((g) => [g.name, g.competition?.id ?? null, g.teams.map((t) => [t.team, t.imported])]), [
    ['Championnat Seniors Messieurs', 'k1', [['TC ALPHA 1', true], ['TC ALPHA 2', false]]],
    ['Pyrénées Interclubs', null, [['TC ALPHA 1', false]]],
  ]);
  assert.equal(club.poolTeamId(POOL, 'tc alpha 1'), '11');
  assert.equal(club.poolTeamId(POOL, 'TC ALPHA 9'), null);
  assert.equal(club.poolTeamId({ teams: [{ id: '1', name: 'X 1' }, { id: '2', name: 'x 1' }] }, 'X 1'), null, 'ambiguous');
});

test('club import: competitions reused or read with badges, pools read three at a time, teams created; quota retried; misses reported', async () => {
  const pools = {
    [POOL_URL]: structuredClone(POOL),
    [POOL2]: { ...structuredClone(POOL), teams: POOL.teams.map((t) => (t.id === '11' ? { id: '21', name: 'TC ALPHA 2' } : t)),
      rounds: POOL.rounds.map((r) => ({ ...r, matches: r.matches.map((m) => ({ ...m, url: m.url.replace('/poule/2/', '/poule/3/'), home_id: m.home_id === '11' ? '21' : m.home_id, away_id: m.away_id === '11' ? '21' : m.away_id })) })) },
    [OTHER]: { ...structuredClone(POOL), teams: POOL.teams.map((t) => (t.id === '11' ? { id: '11', name: 'TC OMEGA 1' } : t)),
      rounds: POOL.rounds.map((r) => ({ ...r, matches: r.matches.map((m) => ({ ...m, url: m.url.replace('/82145789/division/4/phase/1/poule/2/', '/90000001/division/7/phase/1/poule/9/') })) })) },
  };
  let quotaOnce = true, inFlight = 0, maxInFlight = 0;
  const client = fakeClient({
    saisons: [{ id: 's1', club_id: 'c1', label: '2026/2027', actif: true }],
    competitions: [{ id: 'k1', club_id: 'c1', saison_id: 's1', nom: 'Championnat Seniors Messieurs', tenup_url: POOL_URL }],
    invoke: async (body) => {
      if (body.kind === 'competition') return { data: { url: body.url, nom: 'Pyrénées Interclubs', format: '3S1D2', singles_set3_format: 'normal', warnings: [] }, error: null };
      inFlight++; maxInFlight = Math.max(maxInFlight, inFlight);
      await new Promise((r) => setTimeout(r, 5));
      inFlight--;
      if (body.url === POOL2 && quotaOnce) { quotaOnce = false; return refusal('Trop de demandes Ten’Up. Réessayez dans une minute.'); }
      return { data: { id: `p-${body.url.slice(-1)}`, url: body.url, ...pools[body.url] }, error: null };
    },
  });
  const groups = club.groupClubTeams(PAGE, client.db.team_competitions, []);
  const selection = groups.map((group) => ({ group, teams: group.teams }));
  const prepared = await club.prepareClubCompetitions(client, 'c1', 's1', selection);
  assert.equal(prepared[0].competition.id, 'k1', 'existing championship: no read');
  assert.deepEqual([prepared[1].draft.genre, prepared[1].draft.categorie], ['femmes', 'Seniors'], 'gender from the « Femme » badge');
  assert.deepEqual(reads(client), ['competition']);
  const outcomes = {};
  const pauses = [];
  await club.importClubTeams(client, 'c1', 's1', prepared, (key, o) => { outcomes[key] = o; }, { pause: async (ms) => { pauses.push(ms); } });
  const byTeam = Object.fromEntries(Object.entries(outcomes).map(([k, o]) => [k.replace(/^.*poule=(\d+)\|/, '$1 '), o]));
  assert.deepEqual(byTeam['2 TC ALPHA 1'], { status: 'done', count: 2 });
  assert.deepEqual(byTeam['3 TC ALPHA 2'], { status: 'done', count: 2 }, 'retried after the quota pause');
  assert.equal(byTeam['9 TC ALPHA 1'].status, 'failed');
  assert.match(byTeam['9 TC ALPHA 1'].message, /introuvable dans la poule/);
  assert.deepEqual(pauses, [30_000]);
  assert.ok(maxInFlight <= 3);
  const created = client.calls.filter((c) => c[0] === 'rpc').map((c) => [c[2].p_competition, c[2].p_numero, c[2].p_team_id]);
  assert.deepEqual(created.sort(), [['k1', 1, '11'], ['k1', 2, '21']], 'numbers from the Ten’Up names');
  assert.equal(client.db.team_competitions.length, 2, 'Pyrénées Interclubs created');
  assert.equal(client.db.team_competitions[1].genre, 'femmes');
  // Relancé : déjà présente, sans nouvelle création.
  client.db.team_equipes.push({ id: 'e1', club_id: 'c1', competition_id: 'k1', numero: 1, tenup_team_id: '11' });
  const again = {};
  await club.importClubTeams(client, 'c1', 's1', [{ teams: [groups[0].teams[0]], competition: prepared[0].competition }], (key, o) => { again[key] = o; });
  assert.deepEqual(Object.values(again).at(-1), { status: 'already' });
});

test('club import: a championship that cannot be read or created fails alone', async () => {
  const client = fakeClient({ invoke: (body) => body.kind === 'competition' && refusal('Limite de l’essai atteinte : 40 lectures Ten’Up par 24 heures.') });
  const groups = club.groupClubTeams(PAGE, [], []);
  const prepared = await club.prepareClubCompetitions(client, 'c1', 's1', groups.map((group) => ({ group, teams: group.teams })));
  assert.ok(prepared.every((p) => /Limite de l’essai/.test(p.error)));
  const ok = fakeClient();
  const outcomes = {};
  const draft = { nom: 'x', tenup_url: POOL_URL, type: 'adultes', categorie: 'Seniors', genre: null, format: '3S1D2', singles_set3_format: 'normal' };
  await club.importClubTeams(ok, 'c1', 's1', [{ teams: [groups[0].teams[0]], draft }], (key, o) => { outcomes[key] = o; });
  assert.match(Object.values(outcomes)[0].message, /Précisez le genre/);
  assert.equal(ok.calls.filter((c) => c[0] === 'invoke').length, 0, 'no pool read without its competition');
});
