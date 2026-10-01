import test from 'node:test';
import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { mkdir, rm, readFile } from 'node:fs/promises';
import { JSDOM } from 'jsdom';
import { extractTenupPoolRound } from '../services/tenup-worker/parse-pool.mjs';
test('pool edge authorizes first, stores only validated worker data and never creates teams', async () => {
  const dir = new URL('../node_modules/.tmp/pool-edge/', import.meta.url);
  await mkdir(dir, { recursive: true });
  const out = new URL('edge.mjs', dir);
  await build({
    entryPoints: [
      new URL('../supabase/functions/tenup-sync/index.ts', import.meta.url)
        .pathname,
    ],
    outfile: out.pathname,
    bundle: true,
    platform: 'node',
    format: 'esm',
    plugins: [
      {
        name: 'mock',
        setup(b) {
          b.onResolve({ filter: /^https:/ }, () => ({
            path: 'api',
            namespace: 'mock',
          }));
          b.onLoad({ filter: /.*/, namespace: 'mock' }, () => ({
            contents:
              'export const createClient=(...args)=>globalThis.__poolApi(...args)',
          }));
        },
      },
    ],
  });
  const previous = {
    fetch: globalThis.fetch,
    Deno: globalThis.Deno,
    api: globalThis.__poolApi,
  };
  let handler,
    fetched = 0,
    denied = false,
    stored = [];
  const url =
    'https://tenup.fft.fr/championnat/82678463?division=144146&phase=233672&poule=513524';
  const body = {
    kind: 'pool',
    club_id: '00000000-0000-0000-0000-000000000001',
    competition_id: '00000000-0000-0000-0000-000000000011',
    url,
    payload: { division: 'malicious' },
  };
  const { round, ...p } = extractTenupPoolRound(
    new JSDOM(
      await readFile(
        new URL('./fixtures/tenup-pool.html', import.meta.url),
        'utf8'
      )
    ).window.document
  );
  let payload = { ...p, rounds: [round] };
  globalThis.Deno = {
    serve: (fn) => (handler = fn),
    env: {
      get: (key) =>
        key === 'TENUP_WORKER_URL' ? 'https://worker.example/api/extract' : key,
    },
  };
  globalThis.__poolApi = (_url, key) =>
    key === 'SUPABASE_SERVICE_ROLE_KEY'
      ? {
          from: (table) => {
            assert.equal(table, 'team_tenup_pool_previews');
            return {
              update: (data) => {
                stored.push(data);
                return {
                  eq: (key, value) => {
                    assert.equal(key, 'id');
                    assert.equal(value, 'snapshot');
                    return {
                      eq: (key, value) => {
                        assert.equal(key, 'actor_id');
                        assert.equal(value, 'actor');
                        return Promise.resolve({ error: null });
                      },
                    };
                  },
                };
              },
            };
          },
        }
      : {
          auth: {
            getUser: async () => ({
              data: { user: { id: 'actor' } },
              error: null,
            }),
          },
          rpc: async (name, args) => {
            assert.equal(name, 'team_tenup_pool_begin');
            assert.deepEqual(args, {
              p_club: body.club_id,
              p_competition: body.competition_id,
              p_url: url,
            });
            return {
              data: 'snapshot',
              error: denied
                ? { code: '42501', message: 'Administration requise.' }
                : null,
            };
          },
        };
  globalThis.fetch = async (endpoint, options) => {
    fetched++;
    assert.equal(String(endpoint), 'https://worker.example/api/extract');
    assert.equal(
      options.headers['x-vercel-protection-bypass'],
      'TENUP_WORKER_BYPASS_TOKEN'
    );
    assert.deepEqual(JSON.parse(options.body), { kind: 'pool', url });
    return Response.json(payload);
  };
  const request = (value = body, auth = true) =>
    new Request('https://edge.example', {
      method: 'POST',
      headers: auth ? { Authorization: 'Bearer token' } : {},
      body: JSON.stringify(value),
    });
  try {
    await import(out.href);
    assert.equal((await handler(request(body, false))).status, 401);
    assert.equal(fetched, 0);
    denied = true;
    assert.equal((await handler(request())).status, 403);
    assert.equal(fetched, 0);
    denied = false;
    assert.equal(
      (await handler(request({ ...body, url: url.split('?')[0] }))).status,
      400
    );
    assert.equal(fetched, 0);
    let r = await handler(request());
    assert.equal(r.status, 200);
    assert.deepEqual(await r.json(), { id: 'snapshot', url, ...payload });
    assert.deepEqual(stored, [{ payload }]);
    payload.rounds[0].matches.pop();
    r = await handler(request());
    assert.equal(r.status, 502);
    assert.equal(stored.length, 1, 'partial snapshots are not stored');
  } finally {
    globalThis.fetch = previous.fetch;
    if (previous.Deno === undefined) delete globalThis.Deno;
    else globalThis.Deno = previous.Deno;
    if (previous.api === undefined) delete globalThis.__poolApi;
    else globalThis.__poolApi = previous.api;
    await rm(dir, { recursive: true, force: true });
  }
});
