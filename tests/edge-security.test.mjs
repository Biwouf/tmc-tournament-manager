import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import vm from 'node:vm';
import ts from 'typescript';

// Execute the actual Deno handler with local API doubles. No network or publication.
async function handler(name, options = {}) {
  const config = { role: 'manager', status: 'active', published: true,
    actuClub: 'club-a', binding: 'club-a', superAdmin: false, ...options };
  const effects = [];
  const env = { SUPABASE_URL: 'https://supabase.invalid', SUPABASE_SERVICE_ROLE_KEY: 'test',
    FACEBOOK_PAGE_ID: 'test-page', FACEBOOK_PAGE_ACCESS_TOKEN: 'test', FACEBOOK_CLUB_ID: config.binding };
  let membershipRole = config.role;
  const client = {
    auth: {
      getUser: async () => ({ data: { user: config.noUser ? null : { id: 'caller' } } }),
      admin: {
        inviteUserByEmail: async () => { effects.push('invite'); return { error: { code: 'email_exists' } }; },
        generateLink: async () => { effects.push('generate-link'); return { error: { code: 'email_exists' } }; },
      },
    },
    from(table) {
      const filters = {};
      const chain = {
        select() { return chain; },
        eq(key, value) { filters[key] = value; return chain; },
        maybeSingle() { return chain; },
        single() { return chain; },
        upsert(row, opts) {
          effects.push({ upsert: row, opts });
          if (!opts.ignoreDuplicates) membershipRole = row.role;
          return Promise.resolve({ error: null });
        },
        then(resolve, reject) {
          let data;
          if (table === 'actus') data = { club_id: config.actuClub, published: config.published, contenu: 'Article', image_urls: [] };
          if (table === 'profiles') data = { is_super_admin: config.superAdmin };
          if (table === 'clubs') data = { status: config.status };
          if (table === 'club_members') data = filters.club_id === config.actuClub && config.role ? { role: config.role } : null;
          return Promise.resolve({ data, error: config.lookupError && table === 'clubs' ? { message: 'down' } : null }).then(resolve, reject);
        },
      };
      return chain;
    },
  };
  let serve;
  const source = (await readFile(new URL(`../supabase/functions/${name}/index.ts`, import.meta.url),'utf8'))
    .replace(/import \{ createClient \} from 'https:[^']+';/, '');
  const js = ts.transpileModule(source, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS } }).outputText;
  vm.runInNewContext(js, {
    exports: {}, Request, Response, console, createClient: () => client,
    Deno: { env: { get: (key) => env[key] }, serve: (fn) => { serve = fn; } },
    fetch: async (url) => {
      effects.push(url);
      if (url.startsWith('https://graph.facebook.com')) return Response.json({ id: 'page_post' });
      if (url.startsWith('https://supabase.invalid/auth/v1/admin/users')) return Response.json({ users: [{ id: 'caller', email: 'existing@example.invalid' }] });
      throw new Error(`Unexpected network request: ${url}`);
    },
  });
  return {
    effects,
    role: () => membershipRole,
    call: (body) => serve(new Request('https://function.invalid', {
      method: 'POST', headers: { Authorization: 'Bearer test', 'Content-Type': 'application/json' }, body: JSON.stringify(body),
    })),
  };
}

for (const [label, options, expected] of [
  ['manager of bound club', {}, 200],
  ['admin of bound club', { role: 'admin' }, 200],
  ['member', { role: 'member' }, 403],
  ['non-member', { role: null }, 403],
  ['different Facebook club', { actuClub: 'club-b' }, 403],
  ['draft', { published: false }, 403],
  ['suspended', { status: 'suspended' }, 403],
  ['super-admin cannot publish suspended club', { status: 'suspended', superAdmin: true }, 403],
  ['missing binding', { binding: undefined }, 500],
  ['lookup failure', { lookupError: true }, 500],
  ['anonymous', { noUser: true }, 401],
]) {
  test(`Facebook: ${label}`, async () => {
    const app = await handler('post-to-facebook', options);
    const response = await app.call({ actu_id: 'article' });
    assert.equal(response.status, expected);
    const publications = app.effects.filter(e => typeof e === 'string' && e.startsWith('https://graph.facebook.com'));
    assert.equal(publications.length, expected === 200 ? 1 : 0, 'reject before external side effects');
  });
}
for (const action of ['send', 'generate-link']) {
  test(`Invitation ${action}: existing membership keeps its admin role`, async () => {
    const app = await handler('invite-user', { role: 'admin' });
    const response = await app.call({ email: 'existing@example.invalid', club_id: 'club-a', role: 'member', action });
    assert.equal(response.status,200);
    assert.equal(app.role(),'admin');
    assert.equal(app.effects.find(e => typeof e === 'object').opts.ignoreDuplicates,true);
  });
}
for (const name of ['invite-user','club-members']) {
  test(`${name}: suspended club admin is rejected before writes`, async () => {
    const app = await handler(name, { role: 'admin', status: 'suspended' });
    const response = await app.call({ email: 'existing@example.invalid', club_id: 'club-a', role: 'member', action: name === 'club-members' ? 'list' : 'send' });
    assert.equal(response.status,403);
    assert.equal(app.effects.length,0);
  });
}
