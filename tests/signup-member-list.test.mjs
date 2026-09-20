import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';
import ts from 'typescript';
const source = (await readFile(new URL('../supabase/functions/club-members/index.ts', import.meta.url), 'utf8'))
  .replace(/import \{ createClient \} from 'https:[^']+';/, '');
const js = ts.transpileModule(source, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS } }).outputText;
async function list({ role = 'admin', detailsError = false, noDetails = false } = {}) {
  const reads = [];
  const client = {
    auth: {
      getUser: async () => ({ data: { user: { id: 'admin' } }, error: null }),
      admin: { getUserById: async () => ({ data: { user: { email: 'alice@example.test', last_sign_in_at: '2026-09-20' } }, error: null }) },
    },
    from(table) {
      const filters = {};
      const q = {
        select() { return q; },
        eq(key, value) { filters[key] = value; return q; },
        in(key, value) { filters[key] = value; return q; },
        maybeSingle() { return q; },
        then(resolve, reject) {
          reads.push({ table, filters });
          let data;
          if (table === 'clubs') data = { status: 'active' };
          if (table === 'club_members') data = filters.user_id ? { role } : [{ user_id: 'alice', role: 'member', created_at: '2026-09-20' }];
          if (table === 'profiles') data = filters.id === 'admin' ? { is_super_admin: false } : [{ id: 'alice', prenom: 'Alice', nom: 'Dupont' }];
          if (table === 'profile_details') data = noDetails ? [] : [{ user_id: 'alice', sex: 'female', classement: '30' }];
          return Promise.resolve({ data, error: table === 'profile_details' && detailsError ? { message: 'unavailable' } : null }).then(resolve, reject);
        },
      };
      return q;
    },
  };
  let serve;
  vm.runInNewContext(js, {
    exports: {}, Response, console, createClient: () => client,
    Deno: { env: { get: () => 'test' }, serve: fn => { serve = fn; } },
  });
  const response = await serve(new Request('https://test.invalid', { method: 'POST', headers: { Authorization: 'Bearer test' }, body: JSON.stringify({ club_id: 'club', action: 'list' }) }));
  return { response, body: await response.json(), reads };
}
test('member list: admin receives saved identity, sex and ranking scoped to member IDs', async () => {
  const { response, body, reads } = await list();
  assert.equal(response.status, 200);
  assert.deepEqual(body.members[0], { user_id: 'alice', prenom: 'Alice', nom: 'Dupont', email: 'alice@example.test', sex: 'female', classement: '30', role: 'member', created_at: '2026-09-20', status: 'active' });
  assert.deepEqual(Array.from(reads.find(r => r.table === 'profile_details').filters.user_id), ['alice']);
});
test('member list: manager cannot read profile details', async () => {
  const { response, reads } = await list({ role: 'manager' });
  assert.equal(response.status, 403);
  assert.equal(reads.some(r => r.table === 'profile_details'), false);
});
test('member list: missing sex stays null; database errors are surfaced', async () => {
  assert.equal((await list({ noDetails: true })).body.members[0].sex, null);
  assert.equal((await list({ detailsError: true })).response.status, 500);
});
