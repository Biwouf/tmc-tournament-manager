// S8b — Edge `tenup-site` : contrôle SQL avant la lecture, lien ramené à la racine du club, réponse
// du worker validée, images copiées dans `content-images/<club>/config/` (jamais d'URL Ten'Up
// dans la proposition), échec marqué, tâche de fond sans attente, aucune écriture dans la config.
import test from 'node:test';
import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { mkdir, readFile } from 'node:fs/promises';
import { JSDOM } from 'jsdom';
import {
  extractTenupClubBoard, extractTenupClubHome, extractTenupClubOffers, extractTenupInstallation,
} from '../services/tenup-worker/parse-club-profile.mjs';

const CLUB = '00000000-0000-0000-0000-000000000002';
const doc = async (name) => new JSDOM(await readFile(new URL(`./fixtures/tenup-profile/${name}.html`, import.meta.url), 'utf8')).window.document;
const WEBP = new Uint8Array([0x52, 0x49, 0x46, 0x46, 0, 0, 0, 0, 0x57, 0x45, 0x42, 0x50, 1, 2, 3]);

async function profile() {
  const { installation: _i, ...club } = extractTenupClubHome(await doc('60820110-club'));
  return {
    url: 'https://tenup.fft.fr/club/60820110', pages: { club: 'ok', equipe: 'ok', offres: 'ok', installation: 'ok' },
    club, board: extractTenupClubBoard(await doc('60820110-equipe')).board,
    offers: extractTenupClubOffers(await doc('60820110-offres')).offers,
    courts: extractTenupInstallation(await doc('60820110-installation')).courts,
  };
}

test('tenup-site edge: SQL first, worker, images copied, proposal stored, nothing in the config', async () => {
  const dir = new URL('../node_modules/.tmp/tenup-site-edge/', import.meta.url);
  await mkdir(dir, { recursive: true });
  const out = new URL('edge.mjs', dir);
  await build({
    entryPoints: [new URL('../supabase/functions/tenup-site/index.ts', import.meta.url).pathname],
    outfile: out.pathname, bundle: true, platform: 'node', format: 'esm',
    plugins: [{ name: 'mock', setup(b) {
      b.onResolve({ filter: /^https:/ }, () => ({ path: 'api', namespace: 'mock' }));
      b.onLoad({ filter: /.*/, namespace: 'mock' }, () => ({ contents: 'export const createClient=(...args)=>globalThis.__siteApi(...args)' }));
    } }],
  });
  const worker = await profile();
  let handler, begun, rpcError = null, workerStatus = 200, workerBody = worker, imageBroken = false;
  const rpcs = [], writes = [], uploads = [], removed = [], fetched = [], waited = [];
  let proposal = null;
  globalThis.Deno = { serve: (fn) => (handler = fn), env: { get: (key) => (key === 'TENUP_WORKER_URL' ? 'https://worker.example/api/extract' : key) } };
  globalThis.EdgeRuntime = { waitUntil: (p) => waited.push(p) };
  globalThis.__siteApi = (_url, key) => {
    if (key === 'SUPABASE_SERVICE_ROLE_KEY') return {
      from(table) {
        const q = {
          filters: {},
          select() { return q; }, eq(k, v) { q.filters[k] = v; return q; },
          maybeSingle: async () => ({ data: table === 'club_tenup_site_proposals' ? proposal : null, error: null }),
          update(row) { q.row = row; q.op = 'update'; return q; },
          upsert: async (row) => { writes.push([table, 'upsert', row]); proposal = row; return { error: null }; },
          then(done) { writes.push([table, q.op, q.row, q.filters]); done({ error: null }); },
        };
        assert.notEqual(table, 'club_settings', 'the config is never written by the Edge');
        return q;
      },
      storage: { from: (bucket) => ({
        upload: async (path, bytes, options) => { uploads.push({ bucket, path, type: options.contentType, size: bytes.length }); return { error: null }; },
        getPublicUrl: (path) => ({ data: { publicUrl: `https://db.example/storage/v1/object/public/${bucket}/${path}` } }),
        remove: async (paths) => { removed.push(...paths); return { error: null }; },
      }) },
    };
    return {
      auth: { getUser: async () => ({ data: { user: { id: 'admin' } }, error: null }) },
      rpc: async (name, args) => { rpcs.push([name, args]); return { data: rpcError ? null : begun, error: rpcError }; },
    };
  };
  globalThis.fetch = async (url, options) => {
    fetched.push(String(url));
    if (String(url).startsWith('https://worker.example')) {
      assert.deepEqual(JSON.parse(options.body), { kind: 'club-profile', url: 'https://tenup.fft.fr/club/60820110' });
      return Response.json(workerBody, { status: workerStatus });
    }
    assert.match(String(url), /^https:\/\/cmsclub\.fft\.fr\//, 'images from the FFT club CMS only');
    return imageBroken ? new Response('<svg/>', { status: 200 }) : new Response(WEBP, { status: 200, headers: { 'content-type': 'image/webp' } });
  };
  const request = (body) => new Request('https://edge.example', { method: 'POST', headers: { Authorization: 'Bearer token' }, body: JSON.stringify(body) });
  await import(out.href);

  // Lien d'un onglet : ramené à la racine, contrôle SQL avec l'identifiant.
  begun = { started: true, read_id: 'r1', tenup_club_id: '60820110' };
  let res = await handler(request({ club_id: CLUB, url: 'https://tenup.fft.fr/club/60820110/offres' }));
  assert.equal(res.status, 200);
  assert.deepEqual(rpcs[0], ['club_tenup_site_begin', { p_club: CLUB, p_tenup_id: '60820110', p_background: false }]);
  const { payload } = await res.json();
  assert.equal(uploads.length, 2);
  for (const u of uploads) {
    assert.equal(u.bucket, 'content-images');
    assert.match(u.path, new RegExp(`^${CLUB}/config/\\d+-tenup-(logo|bandeau)\\.webp$`));
    assert.equal(u.type, 'image/webp');
  }
  assert.match(payload.club.logo, /^https:\/\/db\.example\/storage\/v1\/object\/public\/content-images\//);
  assert.doesNotMatch(JSON.stringify(payload.club), /cmsclub\.fft\.fr/, 'no Ten’Up image URL kept');
  assert.deepEqual(payload.image_errors, []);
  assert.equal(proposal.status, 'ready');
  assert.equal(proposal.images.length, 2);
  assert.deepEqual(writes.filter(([t]) => t === 'club_tenup_site_reads').map(([, , row, f]) => [row.status, f.id]), [['done', 'r1']]);
  assert.deepEqual(writes.find(([t]) => t === 'clubs').slice(2), [{ tenup_club_id: '60820110' }, { id: CLUB }]);

  // Nouvelle lecture : les images de la proposition non enregistrée sont supprimées ; image illisible signalée.
  const previousImages = proposal.images;
  imageBroken = true; uploads.length = 0; writes.length = 0;
  begun = { started: true, read_id: 'r2', tenup_club_id: '60820110' };
  res = await handler(request({ club_id: CLUB, url: 'https://tenup.fft.fr/club/60820110' }));
  const second = (await res.json()).payload;
  assert.deepEqual(second.image_errors, ['logo', 'banner']);
  assert.equal(second.club.logo, '');
  assert.equal(uploads.length, 0, 'not a PNG, JPEG or WebP: not stored');
  assert.deepEqual(removed, previousImages);
  imageBroken = false;

  // Refus SQL (24 h, droits, `internal`) : pas de lecture.
  const before = fetched.length;
  rpcError = { code: 'P0001', message: 'Votre club a déjà été lu sur Ten’Up dans les dernières 24 heures.' };
  res = await handler(request({ club_id: CLUB, url: 'https://tenup.fft.fr/club/60820110' }));
  assert.equal(res.status, 400);
  assert.match((await res.json()).error, /24 heures/);
  rpcError = { code: '42501', message: 'Le remplissage depuis Ten’Up n’est pas proposé pour ce club.' };
  assert.equal((await handler(request({ club_id: CLUB, url: 'https://tenup.fft.fr/club/60820110' }))).status, 403);
  rpcError = null;
  // Lien d'un autre hôte : refusé avant SQL.
  const rpcCount = rpcs.length;
  res = await handler(request({ club_id: CLUB, url: 'https://evil.test/club/1' }));
  assert.equal(res.status, 400);
  assert.equal(rpcs.length, rpcCount);
  assert.equal(fetched.length, before);

  // Worker en échec ou réponse hors schéma : lecture marquée en échec, rien de stocké.
  for (const [status, body] of [[502, { error: 'x' }], [200, { ...worker, club: { ...worker.club, logo: 'https://evil.test/x.png' } }]]) {
    workerStatus = status; workerBody = body; writes.length = 0;
    begun = { started: true, read_id: 'r3', tenup_club_id: '60820110' };
    res = await handler(request({ club_id: CLUB, url: 'https://tenup.fft.fr/club/60820110' }));
    assert.equal(res.status, 502);
    assert.match((await res.json()).error, /remplissez le site à la main/);
    assert.deepEqual(writes.map(([t, op, row]) => [t, op, row]), [['club_tenup_site_reads', 'update', { status: 'failed' }]]);
  }
  workerStatus = 200; workerBody = worker;

  // Tâche de fond : réponse immédiate, lecture confiée à `EdgeRuntime.waitUntil`.
  writes.length = 0;
  begun = { started: true, read_id: 'r4', tenup_club_id: '60310304' };
  workerBody = { ...worker, url: 'https://tenup.fft.fr/club/60310304' };
  globalThis.fetch = (orig => async (url, options) => {
    if (String(url).startsWith('https://worker.example')) return Response.json(workerBody);
    return orig(url, options);
  })(globalThis.fetch);
  res = await handler(request({ club_id: CLUB, background: true }));
  assert.equal(res.status, 202);
  assert.deepEqual(rpcs.at(-1), ['club_tenup_site_begin', { p_club: CLUB, p_tenup_id: null, p_background: true }]);
  assert.equal(waited.length, 1);
  await waited[0];
  assert.equal(proposal.tenup_club_id, '60310304');
  // Rien à lire (pas d'identifiant, lecture récente) : 200 sans lecture.
  begun = { started: false, reason: 'recent' };
  res = await handler(request({ club_id: CLUB, background: true }));
  assert.deepEqual(await res.json(), { started: false, reason: 'recent' });
  assert.equal(waited.length, 1);
});
