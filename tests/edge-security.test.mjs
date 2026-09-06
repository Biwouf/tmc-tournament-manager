import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import vm from 'node:vm';
import ts from 'typescript';

// Execute the actual Deno handler with local API doubles. No network or publication.
async function handler(name, options = {}) {
  // PR8 : les credentials Facebook ne sont plus des variables d'environnement liées à un
  // club unique, mais une ligne par club dans `club_social_credentials`.
  const config = { role: 'manager', status: 'active', published: true,
    actuClub: 'club-a', superAdmin: false,
    credentials: { 'club-a': { page_id: 'page-a', token: 'token-a' },
                   'club-b': { page_id: 'page-b', token: 'token-b' } }, ...options };
  const effects = [];
  const env = { SUPABASE_URL: 'https://supabase.invalid', SUPABASE_SERVICE_ROLE_KEY: 'test' };
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
          if (table === 'club_social_credentials') data = config.credentials[filters.club_id] ?? null;
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
    fetch: async (url, init) => {
      effects.push(url);
      // Le corps du POST /feed porte l'`access_token` : c'est la seule façon de vérifier
      // QUEL compte a publié, et donc que chaque club utilise bien le sien (PR8).
      if (init?.body) effects.push({ feed: JSON.parse(init.body) });
      if (url.startsWith('https://graph.facebook.com')) {
        // `/me?metadata=1` est ce qui distingue une Page d'un compte utilisateur : le double
        // rend le `metadata.type` que Graph API renverrait pour le token présenté.
        if (url.includes('/me?')) {
          return Response.json({ id: 'page_post', name: 'Page du club',
            metadata: { type: url.includes('user-token') ? 'user' : 'page' } });
        }
        return Response.json({ id: 'page_post' });
      }
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
  ['manager of the club', {}, 200],
  ['admin of the club', { role: 'admin' }, 200],
  ['member', { role: 'member' }, 403],
  ['non-member', { role: null }, 403],
  ['draft', { published: false }, 403],
  ['suspended', { status: 'suspended' }, 403],
  ['super-admin cannot publish suspended club', { status: 'suspended', superAdmin: true }, 403],
  // PR8 : remplace le cas « missing binding » (FACEBOOK_CLUB_ID). L'absence de page connectée
  // n'est plus une erreur de configuration serveur (500) mais un club à compléter (400).
  ['club without a connected page', { credentials: {} }, 400],
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

// PR8 : le remplaçant du binding `FACEBOOK_CLUB_ID`. Chaque club publie avec SON token —
// c'est la propriété que la table existe pour garantir, et un repli sur des credentials
// globaux la ferait échouer en publiant tout sur la même page.
for (const [club, token] of [['club-a', 'token-a'], ['club-b', 'token-b']]) {
  test(`Facebook: publishes with the credentials of ${club}`, async () => {
    const app = await handler('post-to-facebook', { actuClub: club });
    assert.equal((await app.call({ actu_id: 'article' })).status, 200);
    const [publication] = app.effects.filter(e => typeof e === 'string' && e.startsWith('https://graph.facebook.com'));
    assert.ok(publication, 'one publication');
    const body = app.effects.find(e => typeof e === 'object' && e.feed)?.feed;
    assert.equal(body.access_token, token, 'token of the actu club');
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
const SUSPENDED_ACTION = { 'invite-user': 'send', 'club-members': 'list', 'social-credentials': 'disconnect' };
for (const name of ['invite-user','club-members','social-credentials']) {
  test(`${name}: suspended club admin is rejected before writes`, async () => {
    const app = await handler(name, { role: 'admin', status: 'suspended' });
    const response = await app.call({ email: 'existing@example.invalid', club_id: 'club-a', role: 'member', action: SUSPENDED_ACTION[name] });
    assert.equal(response.status,403);
    assert.equal(app.effects.length,0);
  });
}

// PR8 : connecter une page est réservé à l'admin du club. Le point sensible est l'ORDRE —
// l'autorisation doit précéder l'appel à Facebook, sinon le token d'un tiers partirait chez
// Graph API avant d'être refusé.
for (const [label, options, body, expected] of [
  ['admin connects a page', { role: 'admin' }, { action: 'connect', token: 'EAA-token' }, 200],
  ['manager cannot connect', { role: 'manager' }, { action: 'connect', token: 'EAA-token' }, 403],
  ['non-member cannot connect', { role: null }, { action: 'connect', token: 'EAA-token' }, 403],
  ['manager cannot disconnect', { role: 'manager' }, { action: 'disconnect' }, 403],
  ['anonymous', { noUser: true }, { action: 'connect', token: 'EAA-token' }, 401],
  // Le piège que la procédure d'obtention du token tend à tout le monde : le token
  // utilisateur longue durée ressemble en tout point à un token de Page. Il doit être
  // refusé ICI, pas six semaines plus tard au premier échec de publication.
  ['user token instead of a page token', { role: 'admin' }, { action: 'connect', token: 'EAA-user-token' }, 400],
]) {
  test(`Social credentials: ${label}`, async () => {
    const app = await handler('social-credentials', options);
    const response = await app.call({ club_id: 'club-a', ...body });
    assert.equal(response.status, expected);
    const graph = app.effects.filter(e => typeof e === 'string' && e.startsWith('https://graph.facebook.com'));
    const authorized = expected === 200 || label.startsWith('user token');
    assert.equal(graph.length === 0, !authorized, 'no token leaves before authorization');
    if (expected === 200) {
      const row = app.effects.find(e => typeof e === 'object' && e.upsert)?.upsert;
      assert.equal(row.token, 'EAA-token');
      // La page vient de Graph API, pas du client : c'est la garantie qu'on ne peut pas
      // enregistrer un `page_id` qui ne correspond pas au token.
      assert.equal(row.page_id, 'page_post');
    }
    if (expected !== 200) {
      assert.equal(app.effects.some(e => typeof e === 'object' && e.upsert), false, 'nothing written');
    }
  });
}
