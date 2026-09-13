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
    // PR11 : par défaut le club a renseigné son email de contact (contrat PR6d) et n'a
    // reçu aucun message récent — le cas nominal du formulaire.
    clubConfig: { contact: { email: 'contact@club.invalid' } }, recentMessages: 0,
    credentials: { 'club-a': { page_id: 'page-a', token: 'token-a' },
                   'club-b': { page_id: 'page-b', token: 'token-b' } }, ...options };
  const effects = [];
  // Les secrets Brevo sont posés par défaut : leur ABSENCE est un cas de test à part
  // (`env: { BREVO_API_KEY: undefined }`), pas la situation nominale.
  const env = { SUPABASE_URL: 'https://supabase.invalid', SUPABASE_SERVICE_ROLE_KEY: 'test',
    BREVO_API_KEY: 'brevo-key', CONTACT_FROM_EMAIL: 'contact@feelike.pro',
    CONTACT_IP_SALT: 'sel-de-test', ...config.env };
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
        gte(key, value) { filters[key] = value; return chain; },
        maybeSingle() { return chain; },
        single() { return chain; },
        insert(row) { effects.push({ insert: row }); return Promise.resolve({ error: null }); },
        upsert(row, opts) {
          effects.push({ upsert: row, opts });
          if (!opts.ignoreDuplicates) membershipRole = row.role;
          return Promise.resolve({ error: null });
        },
        then(resolve, reject) {
          let data;
          if (table === 'actus') data = { club_id: config.actuClub, published: config.published, contenu: 'Article', image_urls: [] };
          if (table === 'profiles') data = { is_super_admin: config.superAdmin };
          // `status: null` = club introuvable (PR11 : le `club_id` vient d'un visiteur).
          if (table === 'clubs') data = config.status === null ? null : { status: config.status, name: 'Club de test' };
          if (table === 'club_members') data = filters.club_id === config.actuClub && config.role ? { role: config.role } : null;
          if (table === 'club_social_credentials') data = config.credentials[filters.club_id] ?? null;
          if (table === 'club_settings') data = { config: config.clubConfig };
          // PR11 : la seule requête `contact_messages` qu'on attend ici est le COMPTAGE du
          // rate-limit — l'insert a sa propre branche et ne passe pas par `then`.
          if (table === 'contact_messages') {
            return Promise.resolve({ data: null, count: config.recentMessages, error: null }).then(resolve, reject);
          }
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
    // `crypto` / `TextEncoder` : `contact-form` hache l'IP du visiteur avec les API web
    // standard, présentes dans Deno mais pas dans un contexte `vm` nu.
    exports: {}, Request, Response, AbortSignal, console, crypto, TextEncoder, createClient: () => client,
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
      // PR11 : Brevo accepte, sauf quand un test demande explicitement une panne.
      if (url.startsWith('https://api.brevo.com')) {
        return config.brevoFails
          ? new Response('quota exceeded', { status: 402 })
          : Response.json({ messageId: '<test@feelike.app>' });
      }
      throw new Error(`Unexpected network request: ${url}`);
    },
  });
  return {
    effects,
    role: () => membershipRole,
    // `headers` remplace l'en-tête par défaut — `contact-form` doit répondre à un visiteur
    // qui n'a AUCUN `Authorization`, ce qu'on ne peut pas montrer en le laissant en place.
    call: (body, headers) => serve(new Request('https://function.invalid', {
      method: 'POST',
      headers: headers ?? { Authorization: 'Bearer test', 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
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

// PR11 — `contact-form`. Première function appelée par un VISITEUR ANONYME : le prologue
// d'autorisation des trois autres est absent, et ce sont ces tests qui tiennent sa place.
const VISITOR = { 'Content-Type': 'application/json', 'x-forwarded-for': '203.0.113.9' };
const VALID = { club_id: 'club-a', first_name: 'Jean', last_name: 'Dupont',
  email: 'jean@example.invalid', phone: '0612345678',
  message: 'Bonjour, je souhaite des informations sur les cours adultes.' };
const inserts = (app) => app.effects.filter(e => typeof e === 'object' && e.insert);
const brevoCalls = (app) => app.effects.filter(e => typeof e === 'string' && e.startsWith('https://api.brevo.com'));

for (const [label, options, body, expected, written] of [
  // Le visiteur n'a pas de session : c'est le cas NOMINAL, pas une anomalie.
  ['anonymous visitor is served', {}, VALID, 200, true],
  // Honeypot : succès simulé, aucune écriture. On ne dit jamais à un bot qu'il est repéré.
  ['honeypot silently discards', {}, { ...VALID, website: 'http://spam.invalid' }, 200, false],
  ['suspended club', { status: 'suspended' }, VALID, 403, false],
  ['unknown club', { status: null }, VALID, 404, false],
  ['invalid email', {}, { ...VALID, email: 'jean.dupont@gmail' }, 400, false],
  ['missing first name', {}, { ...VALID, first_name: '  ' }, 400, false],
  ['message too short', {}, { ...VALID, message: 'Bonjour' }, 400, false],
  ['message too long', {}, { ...VALID, message: 'x'.repeat(10000) }, 400, false],
  // Rate-limit : 5 messages déjà reçus pour ce haché dans la fenêtre → le 6ᵉ est refusé,
  // AVANT l'écriture (sinon la limite grossirait la table qu'elle protège).
  ['rate limited beyond 5 per 15 min', { recentMessages: 5 }, VALID, 429, false],
  ['fifth message still passes', { recentMessages: 4 }, VALID, 200, true],
]) {
  test(`Contact form: ${label}`, async () => {
    const app = await handler('contact-form', options);
    const response = await app.call(body, VISITOR);
    assert.equal(response.status, expected);
    assert.equal(inserts(app).length, written ? 1 : 0, 'écriture attendue');
    if (expected >= 400) {
      // Le front affiche ce message tel quel : il doit être en français et lisible.
      const payload = await response.json();
      assert.equal(payload.success, false);
      assert.match(payload.error, /^[A-ZÀ-Ü]/, 'message français');
      assert.equal(brevoCalls(app).length, 0, 'aucune notification sur un refus');
    }
  });
}

// LA propriété de cette function : le message est enregistré même quand l'email ne part
// pas. Une panne Brevo, une clé absente ou un club sans `contact.email` ne doivent pas
// faire perdre un prospect — la base est la source de vérité, l'email la notification.
for (const [label, options] of [
  ['without a Brevo key', { env: { BREVO_API_KEY: undefined } }],
  ['without a sender address', { env: { CONTACT_FROM_EMAIL: undefined } }],
  ['when the club has no contact.email', { clubConfig: { contact: {} } }],
]) {
  test(`Contact form: stores the message ${label}`, async () => {
    const app = await handler('contact-form', options);
    const response = await app.call(VALID, VISITOR);
    assert.equal(response.status, 200, 'le visiteur ne voit pas un échec');
    const payload = await response.json();
    assert.equal(payload.success, true);
    assert.equal(payload.email_sent, false, 'la réponse dit que rien n’est parti');
    assert.ok(payload.email_error, 'et pourquoi');
    assert.equal(inserts(app).length, 1, 'le message est en base');
    assert.equal(brevoCalls(app).length, 0);
  });
}

test('Contact form: writes to the database before notifying, and hashes the IP', async () => {
  const app = await handler('contact-form');
  const response = await app.call(VALID, VISITOR);
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { success: true, email_sent: true, email_error: null });

  // L'ORDRE est la décision de conception : l'insert précède l'appel réseau, jamais
  // l'inverse. Inversé, une panne Brevo perdrait le message.
  const insertIndex = app.effects.findIndex(e => typeof e === 'object' && e.insert);
  const brevoIndex = app.effects.findIndex(e => typeof e === 'string' && e.startsWith('https://api.brevo.com'));
  assert.ok(insertIndex >= 0 && brevoIndex >= 0, 'les deux ont eu lieu');
  assert.ok(insertIndex < brevoIndex, 'insert avant notification');

  // L'IP brute n'est JAMAIS stockée : seulement un sha256 salé (§5.3 du brief).
  const row = inserts(app)[0].insert;
  assert.match(row.ip_hash, /^[0-9a-f]{64}$/, 'sha256 hexadécimal');
  assert.ok(!JSON.stringify(row).includes('203.0.113.9'), 'aucune IP en clair');
  assert.equal(row.club_id, 'club-a');

  // `replyTo` = le visiteur (décision D7) : le club répond en un clic, il ne configure
  // rien. Sans lui, « Répondre » partirait vers `contact@feelike.pro`, c'est-à-dire nulle part.
  const mail = app.effects.find(e => typeof e === 'object' && e.feed)?.feed;
  assert.equal(mail.replyTo.email, 'jean@example.invalid');
  assert.equal(mail.to[0].email, 'contact@club.invalid');
});

// Le cas que l'ordre insert-puis-email existe pour couvrir : Brevo répond une erreur. Le
// message est déjà en base, le visiteur n'a rien à refaire, le club le verra au BO.
test('Contact form: a Brevo failure does not lose the message', async () => {
  const app = await handler('contact-form', { brevoFails: true });
  const response = await app.call(VALID, VISITOR);
  assert.equal(response.status, 200);
  const payload = await response.json();
  assert.equal(payload.success, true);
  assert.equal(payload.email_sent, false);
  assert.equal(inserts(app).length, 1, 'le message est en base malgré l’échec');
  assert.equal(brevoCalls(app).length, 1, 'la tentative a bien eu lieu');
});

for (const body of [null, [], { ...VALID, email: 123 }, { ...VALID, message: {} }]) {
  test('Contact form: rejects malformed field types before writes', async () => {
    const app = await handler('contact-form');
    const response = await app.call(body, VISITOR);
    assert.equal(response.status, 400);
    assert.equal(inserts(app).length, 0);
    assert.equal(brevoCalls(app).length, 0);
  });
}
test('Contact form: recipient is configuration, never a visitor-supplied address', async () => {
  const app = await handler('contact-form', { clubConfig: { contact: { email: 'cactennis82@gmail.com' } } });
  const response = await app.call({ ...VALID, to: 'attacker@example.invalid' }, VISITOR);
  assert.equal(response.status, 200);
  const mail = app.effects.find(e => typeof e === 'object' && e.feed)?.feed;
  assert.equal(mail.to[0].email, 'cactennis82@gmail.com');
  assert.equal(mail.sender.email, 'contact@feelike.pro');
  assert.equal(mail.replyTo.email, VALID.email);
});
