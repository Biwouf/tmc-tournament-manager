// S6b — Edge tenup-sync, kind « club » : autorisation SQL d'abord, lien canonique, réponse validée, aucune écriture.
// Lecture en échec (worker, réponse) : rendue via `team_tenup_read_failed`, import de club compris.
import test from 'node:test';
import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { mkdir, readFile } from 'node:fs/promises';
import { JSDOM } from 'jsdom';
import { extractTenupClub } from '../services/tenup-worker/parse-club.mjs';

test('club edge: SQL check before the billed read, canonical link, validated payload only', async () => {
  const dir = new URL('../node_modules/.tmp/club-edge/', import.meta.url);
  await mkdir(dir, { recursive: true });
  const out = new URL('edge.mjs', dir);
  await build({
    entryPoints: [new URL('../supabase/functions/tenup-sync/index.ts', import.meta.url).pathname],
    outfile: out.pathname, bundle: true, platform: 'node', format: 'esm',
    plugins: [{ name: 'mock', setup(b) {
      b.onResolve({ filter: /^https:/ }, () => ({ path: 'api', namespace: 'mock' }));
      b.onLoad({ filter: /.*/, namespace: 'mock' }, () => ({ contents: 'export const createClient=(...args)=>globalThis.__clubApi(...args)' }));
    } }],
  });
  const canonical = 'https://tenup.fft.fr/club/60820056/competitions/rencontres';
  const club = extractTenupClub(new JSDOM(await readFile(new URL('./fixtures/tenup-club.html', import.meta.url), 'utf8')).window.document);
  let handler, fetched = 0, rpcError = null, payload = club, workerStatus = 200;
  const rpcs = [], marks = [];
  globalThis.Deno = { serve: (fn) => (handler = fn), env: { get: (key) => (key === 'TENUP_WORKER_URL' ? 'https://worker.example/api/extract' : key) } };
  globalThis.__clubApi = (_url, key) => {
    // Clé service : uniquement pour rendre une lecture en échec, jamais pour écrire.
    if (key === 'SUPABASE_SERVICE_ROLE_KEY') return { rpc: async (name, args) => { marks.push([name, args]); return { data: true, error: null }; } };
    return {
      auth: { getUser: async () => ({ data: { user: { id: 'actor' } }, error: null }) },
      rpc: async (name, args) => { rpcs.push([name, args]); return { data: true, error: rpcError }; },
    };
  };
  globalThis.fetch = async (_endpoint, options) => { fetched++; assert.deepEqual(JSON.parse(options.body), { kind: 'club', url: canonical }); return Response.json(payload, { status: workerStatus }); };
  const request = (body) => new Request('https://edge.example', { method: 'POST', headers: { Authorization: 'Bearer token' }, body: JSON.stringify(body) });
  const clubId = '00000000-0000-0000-0000-000000000001';
  await import(out.href);
  // Lien du club sous une autre forme : normalisé avant le contrôle SQL.
  let res = await handler(request({ kind: 'club', club_id: clubId, url: 'https://tenup.fft.fr/club/60820056' }));
  assert.equal(res.status, 200);
  assert.deepEqual(rpcs[0], ['team_tenup_club_begin', { p_club: clubId, p_url: canonical }]);
  assert.equal((await res.json()).teams.length, 6);
  assert.equal(marks.length, 0, 'a successful read stays counted');
  // Refus SQL (droits, quota, plafond) : aucune lecture facturée.
  rpcError = { code: '42501', message: 'Administration du club requise.' };
  res = await handler(request({ kind: 'club', club_id: clubId, url: canonical }));
  assert.equal(res.status, 403);
  rpcError = { code: 'P0001', message: 'Limite de l’essai atteinte : 40 lectures Ten’Up par 24 heures.' };
  res = await handler(request({ kind: 'club', club_id: clubId, url: canonical }));
  assert.equal(res.status, 400);
  assert.match((await res.json()).error, /Limite de l’essai/);
  assert.equal(fetched, 1);
  assert.equal(marks.length, 0, 'a read refused by SQL was never counted');
  rpcError = null;
  // Lien invalide ou club mal formé : refusé sans SQL ni lecture.
  const before = rpcs.length;
  assert.equal((await handler(request({ kind: 'club', club_id: clubId, url: 'https://evil.test/club/1' }))).status, 400);
  assert.equal((await handler(request({ kind: 'club', club_id: 'x', url: canonical }))).status, 400);
  assert.equal(rpcs.length, before);
  // Réponse du worker hors schéma : refusée.
  payload = { ...club, teams: [{ ...club.teams[0], pool_url: 'https://evil.test/x' }] };
  res = await handler(request({ kind: 'club', club_id: clubId, url: canonical }));
  assert.equal(res.status, 502);
  const mark = ['team_tenup_read_failed', { p_actor: 'actor', p_club: clubId, p_club_import: true }];
  assert.deepEqual(marks, [mark], 'an unreadable page is not counted');
  // Worker verrouillé ou en erreur : la lecture est rendue, le message reste « indisponible ».
  payload = club; workerStatus = 502;
  res = await handler(request({ kind: 'club', club_id: clubId, url: canonical }));
  assert.equal(res.status, 502);
  assert.match((await res.json()).error, /indisponible/);
  assert.deepEqual(marks, [mark, mark]);
  // Worker injoignable (exception) : rendue aussi.
  globalThis.fetch = async () => { throw new Error('timeout'); };
  assert.equal((await handler(request({ kind: 'club', club_id: clubId, url: canonical }))).status, 502);
  assert.deepEqual(marks, [mark, mark, mark]);
});
