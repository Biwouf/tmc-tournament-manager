import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { PGlite } from '@electric-sql/pglite';
import { RESERVED_SLUGS } from '../shared/clubSlug.mjs';

const id = (n) => `00000000-0000-0000-0000-${String(n).padStart(12, '0')}`;
const migration = (file) => readFile(new URL(`../supabase/migrations/${file}`, import.meta.url), 'utf8');
const between = (text, start, end) => text.slice(text.indexOf(start), end ? text.indexOf(end) : undefined);
const CAC = id(1), CAC_ADMIN = id(101), SUPER = id(108), OUTSIDER = id(109);
const IMAGES = (club) => `https://project.supabase.co/storage/v1/object/public/content-images/${club}/config`;

// Socle réel : tables de PR1, helpers de PR3, console PR5, lecture publique PR9, puis S2.
async function fixture() {
  const db = new PGlite();
  const socle = await migration('20260629_multi_tenant_socle.sql');
  const rls = await migration('20260816_multi_tenant_rls.sql');
  await db.exec(`
    CREATE ROLE anon; CREATE ROLE authenticated; CREATE ROLE service_role;
    CREATE SCHEMA auth;
    CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $$
      SELECT nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
    CREATE FUNCTION auth.jwt() RETURNS jsonb LANGUAGE sql STABLE AS $$
      SELECT coalesce(nullif(current_setting('request.jwt.claims', true), ''), '{}')::jsonb $$;
    GRANT USAGE ON SCHEMA public, auth TO anon, authenticated, service_role;
    CREATE TABLE auth.users (id uuid PRIMARY KEY, email text, raw_app_meta_data jsonb DEFAULT '{}');
    CREATE TABLE profiles (id uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE);
    CREATE FUNCTION set_updated_at() RETURNS trigger LANGUAGE plpgsql AS $$
      BEGIN NEW.updated_at = now(); RETURN NEW; END $$;
    CREATE TABLE club_signup_requests (club_id uuid, user_id uuid REFERENCES auth.users(id) ON DELETE CASCADE);
  `);
  await db.exec(between(socle, 'DO $$ BEGIN\n  CREATE TYPE club_role', '-- ============================================================\n-- club_id NULLABLE'));
  await db.exec(`
    INSERT INTO clubs (id, slug, name, sport, status) VALUES ('${CAC}', 'cac-tennis', 'CAC Tennis Club', 'tennis', 'active');
    INSERT INTO auth.users (id, email) SELECT ('00000000-0000-0000-0000-' || lpad(n::text, 12, '0'))::uuid,
      'user' || n || '@example.test' FROM generate_series(101, 109) n;
    INSERT INTO profiles (id, is_super_admin) SELECT id, id = '${SUPER}' FROM auth.users;
    INSERT INTO club_members (club_id, user_id, role) VALUES ('${CAC}', '${CAC_ADMIN}', 'admin');
  `);
  await db.exec(between(rls, 'CREATE OR REPLACE FUNCTION public.auth_club_ids()', '-- ============================================================\n-- 2.'));
  for (const file of ['2026081802_super_admin_console.sql', '20260909_club_settings_public_read.sql', '2026102601_club_self_serve.sql']) {
    await db.exec(await migration(file));
  }
  // Une session : rôle PostgREST, sujet et claims du JWT, le temps d'une transaction.
  async function as(role, user, sql, params = [], amr) {
    await db.exec('BEGIN');
    try {
      await db.query(`SELECT set_config('request.jwt.claim.sub', $1, true), set_config('request.jwt.claims', $2, true)`,
        [user || '', JSON.stringify(user ? { sub: user, amr: amr ?? [] } : {})]);
      await db.exec(`SET LOCAL ROLE ${role}`);
      const result = await db.query(sql, params);
      await db.exec('COMMIT');
      return result.rows;
    } catch (error) { await db.exec('ROLLBACK'); throw error; }
  }
  let next = 500;
  const create = async ({ email = 'nouveau@example.test', slug = 'tc-nouveau', club = id(next++), logo, hero } = {}) =>
    (await as('service_role', null, 'SELECT club_self_serve_create($1,$2,$3,$4,$5,$6,$7,$8,$9) r',
      [club, email, ' TC Nouveau ', ' Moissac ', 'tennis', slug, '#1D4ED8', logo ?? `${IMAGES(club)}/1-logo-logo.png`, hero ?? null]))[0].r;
  const account = async (n, email, meta = {}) => {
    await db.query('INSERT INTO auth.users (id, email, raw_app_meta_data) VALUES ($1, $2, $3)', [id(n), email, meta]);
    await db.query('INSERT INTO profiles (id) VALUES ($1)', [id(n)]);
  };
  const club = async (slug) => (await db.query('SELECT * FROM clubs WHERE slug = $1', [slug])).rows[0];
  return { db, as, create, account, club };
}

test('club-signup SQL: CAC keeps its plan, publication and console rights', async () => {
  const f = await fixture();
  try {
    assert.deepEqual(await f.club('cac-tennis').then(({ status, plan, created_via, site_published, trial_ends_at }) =>
      ({ status, plan, created_via, site_published, trial_ends_at })),
    { status: 'active', plan: 'internal', created_via: 'console', site_published: true, trial_ends_at: null });
    assert.equal((await f.as('anon', null, "SELECT id FROM clubs WHERE slug = 'cac-tennis'")).length, 1);
    assert.equal((await f.as('anon', null, 'SELECT club_id FROM club_settings WHERE club_id = $1', [CAC])).length, 1);
    assert.equal((await f.as('authenticated', OUTSIDER, "SELECT id FROM clubs WHERE slug = 'cac-tennis'")).length, 1);

    // La console garde ses deux écritures : créer (internal) et suspendre / réactiver.
    await f.as('authenticated', SUPER, "INSERT INTO clubs (name, slug, sport) VALUES ('Console', 'tc-console', 'tennis')");
    assert.equal((await f.club('tc-console')).plan, 'internal');
    assert.equal((await f.db.query("SELECT 1 FROM club_settings s JOIN clubs c ON c.id = s.club_id WHERE c.slug = 'tc-console'")).rows.length, 1);
    await f.as('authenticated', SUPER, "UPDATE clubs SET status = 'suspended' WHERE id = $1", [CAC]);
    await f.as('authenticated', SUPER, "UPDATE clubs SET status = 'active' WHERE id = $1", [CAC]);
    assert.equal((await f.club('cac-tennis')).status, 'active');
    // Le CAC ne peut ni passer en pending (il serait purgé) ni être purgé.
    await assert.rejects(f.as('authenticated', SUPER, "UPDATE clubs SET status = 'pending' WHERE id = $1", [CAC]), /clubs_self_serve_lifecycle/);
    await f.db.query("UPDATE clubs SET created_at = now() - interval '1 year'");
    assert.deepEqual(await f.as('service_role', null, 'SELECT club_self_serve_purge_begin(50) id'), []);
    assert.deepEqual(await f.as('service_role', null, 'SELECT club_self_serve_purge($1) id', [CAC]), []);
    assert.equal((await f.club('cac-tennis')).status, 'active');
  } finally { await f.db.close(); }
});

test('club-signup SQL: slug rules match shared/clubSlug.mjs and the console CHECK', async () => {
  const f = await fixture();
  try {
    const check = async (slug) => (await f.as('anon', null, 'SELECT slug_available($1) r', [slug]))[0].r;
    for (const slug of ['ab', 'A-club', '-club', 'club-', 'tc_club', 'a'.repeat(33), '', 'tc club']) {
      assert.deepEqual(await check(slug), { available: false, reason: 'format' }, slug);
    }
    for (const slug of [...RESERVED_SLUGS.filter(s => s.length >= 3), 'app-tennis']) {
      assert.deepEqual(await check(slug), { available: false, reason: 'reserved' }, slug);
      await assert.rejects(f.db.query("INSERT INTO clubs (name, slug) VALUES ('x', $1)", [slug]), /clubs_slug_format/, slug);
    }
    assert.deepEqual(await check('cac-tennis'), { available: false, reason: 'taken' });
    assert.deepEqual(await check('a'.repeat(32)), { available: true, reason: null });
    await f.account(201, 'nouveau@example.test');
    await f.create({ slug: 'tc-pending' });
    assert.deepEqual(await check('tc-pending'), { available: false, reason: 'taken' }, 'a pending club holds its slug');

    // La copie SQL de la liste est exactement la liste partagée.
    const sql = await migration('2026102601_club_self_serve.sql');
    const listed = /p_slug IN \(([^)]+)\)/.exec(sql)[1].split(',').map(s => s.trim().replace(/'/g, ''));
    assert.deepEqual(listed, [...RESERVED_SLUGS]);
    const consoleCheck = await migration('2026081802_super_admin_console.sql');
    assert.ok(consoleCheck.includes(`slug NOT IN (${RESERVED_SLUGS.map(s => `'${s}'`).join(',')})`));
  } finally { await f.db.close(); }
});

test('club-signup SQL: creation is atomic, validated, idempotent per email and slug', async () => {
  const f = await fixture();
  try {
    await f.account(201, 'nouveau@example.test');
    await assert.rejects(f.create({ email: 'inconnu@example.test' }), /ACCOUNT_MISSING/);

    // Échec au milieu (l'appartenance) : ni club, ni réglages.
    await f.db.exec(`CREATE FUNCTION fail_member() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'boom'; END $$;
      CREATE TRIGGER fail_member BEFORE INSERT ON club_members FOR EACH ROW EXECUTE FUNCTION fail_member();`);
    await assert.rejects(f.create(), /boom/);
    assert.equal(await f.club('tc-nouveau'), undefined);
    assert.equal((await f.db.query('SELECT count(*)::int n FROM club_settings')).rows[0].n, 1);
    await f.db.exec('DROP TRIGGER fail_member ON club_members');

    for (const bad of [{ slug: 'admin' }, { slug: 'app-tc' }, { slug: 'Tc' }]) {
      await assert.rejects(f.create(bad), (e) => e.code === 'PT409' && /SLUG_UNAVAILABLE/.test(e.message), bad.slug);
    }
    await assert.rejects(f.create({ slug: 'cac-tennis' }), (e) => e.code === 'PT409');
    await assert.rejects(f.create({ logo: 'https://evil.example/logo.png' }), (e) => e.code === 'PT400');
    await assert.rejects(f.create({ hero: `${IMAGES(id(1))}/photo.jpg` }), (e) => e.code === 'PT400', 'another club folder');

    const clubId = id(900);
    const result = await f.create({ club: clubId, email: ' Nouveau@Example.TEST ', hero: `${IMAGES(clubId)}/2-hero-image-photo.jpg` });
    assert.deepEqual(result, { club_id: clubId, created: true });
    const row = await f.club('tc-nouveau');
    assert.deepEqual({ status: row.status, plan: row.plan, created_via: row.created_via, site_published: row.site_published, trial_ends_at: row.trial_ends_at, name: row.name },
      { status: 'pending', plan: 'trial', created_via: 'self_serve', site_published: false, trial_ends_at: null, name: 'TC Nouveau' });
    const { config } = (await f.db.query('SELECT config FROM club_settings WHERE club_id = $1', [clubId])).rows[0];
    assert.deepEqual(config, {
      brand: { name: 'TC Nouveau', city: 'Moissac', sport: 'Tennis', color: '#1d4ed8', logo: `${IMAGES(clubId)}/1-logo-logo.png` },
      home: { hero_image: `${IMAGES(clubId)}/2-hero-image-photo.jpg` },
    });
    assert.deepEqual((await f.db.query('SELECT user_id, role FROM club_members WHERE club_id = $1', [clubId])).rows,
      [{ user_id: id(201), role: 'admin' }]);

    // Même adresse, même slug, toujours pending : rien de recréé, seul le lien repart.
    assert.deepEqual(await f.create({ club: id(901) }), { club_id: clubId, created: false });
    // Autre adresse : le slug est pris.
    await f.account(202, 'autre@example.test');
    await assert.rejects(f.create({ email: 'autre@example.test' }), (e) => e.code === 'PT409');
    // Adresse connue (admin du CAC) : nouveau club rattaché au compte existant.
    await f.create({ email: 'user101@example.test', slug: 'tc-second' });
    assert.deepEqual((await f.db.query("SELECT m.user_id FROM club_members m JOIN clubs c ON c.id = m.club_id WHERE c.slug = 'tc-second'")).rows, [{ user_id: CAC_ADMIN }]);
    assert.equal((await f.db.query('SELECT count(*)::int n FROM auth.users')).rows[0].n, 11);
  } finally { await f.db.close(); }
});

test('club-signup SQL: pending clubs are invisible and the new columns are not writable', async () => {
  const f = await fixture();
  try {
    await f.account(201, 'nouveau@example.test');
    const { club_id: clubId } = await f.create();
    assert.equal((await f.as('anon', null, 'SELECT id FROM clubs WHERE id = $1', [clubId])).length, 0);
    assert.equal((await f.as('anon', null, 'SELECT club_id FROM club_settings WHERE club_id = $1', [clubId])).length, 0);
    assert.equal((await f.as('authenticated', OUTSIDER, 'SELECT id FROM clubs WHERE id = $1', [clubId])).length, 0);
    assert.equal((await f.as('authenticated', id(201), 'SELECT id FROM clubs WHERE id = $1', [clubId])).length, 1);
    assert.equal((await f.as('authenticated', SUPER, 'SELECT id FROM clubs WHERE id = $1', [clubId])).length, 1);

    for (const [column, value] of [['plan', "'saison'"], ['trial_ends_at', "now() + interval '1 year'"], ['created_via', "'console'"], ['site_published', 'true']]) {
      for (const user of [SUPER, CAC_ADMIN, id(201)]) {
        await assert.rejects(f.as('authenticated', user, `UPDATE clubs SET ${column} = ${value} WHERE id = $1`, [CAC]), /permission denied/, `${column} by ${user}`);
      }
    }
    await assert.rejects(f.as('authenticated', SUPER, "INSERT INTO clubs (name, slug, status) VALUES ('X', 'tc-x', 'pending')"), /permission denied/);
    await assert.rejects(f.as('authenticated', SUPER, "INSERT INTO clubs (name, slug, plan) VALUES ('X', 'tc-x', 'trial')"), /permission denied/);
    // La console ne réactive pas un club pending : il n'aurait pas de fin d'essai.
    await assert.rejects(f.as('authenticated', SUPER, "UPDATE clubs SET status = 'active' WHERE id = $1", [clubId]), /clubs_self_serve_lifecycle/);
    for (const role of ['anon', 'authenticated']) {
      for (const fn of ['club_self_serve_create(uuid,text,text,text,text,text,text,text,text)', 'club_self_serve_throttle(text,text)', 'club_self_serve_purge_begin(integer)', 'club_self_serve_purge(uuid)']) {
        assert.equal((await f.db.query(`SELECT has_function_privilege('${role}', 'public.${fn}', 'EXECUTE') ok`)).rows[0].ok, false, `${role} ${fn}`);
      }
      assert.equal((await f.db.query(`SELECT has_table_privilege('${role}', 'public.club_self_serve_attempts', 'SELECT') ok`)).rows[0].ok, false);
    }
    assert.equal((await f.db.query("SELECT has_function_privilege('anon', 'public.club_self_serve_activate()', 'EXECUTE') ok")).rows[0].ok, false);
  } finally { await f.db.close(); }
});

test('club-signup SQL: activation needs a magic link clicked after creation and is idempotent', async () => {
  const f = await fixture();
  try {
    await f.account(201, 'nouveau@example.test');
    const { club_id: clubId } = await f.create();
    const created = Math.floor(new Date((await f.club('tc-nouveau')).created_at).getTime() / 1000);
    const activate = (user, amr) => f.as('authenticated', user, 'SELECT club_self_serve_activate() id', [], amr);
    assert.deepEqual(await activate(id(201), [{ method: 'password', timestamp: created + 60 }]), []);
    assert.deepEqual(await activate(id(201), [{ method: 'otp', timestamp: created - 60 }]), []);
    assert.deepEqual(await activate(OUTSIDER, [{ method: 'otp', timestamp: created + 60 }]), []);
    assert.equal((await f.club('tc-nouveau')).status, 'pending');

    assert.deepEqual(await activate(id(201), [{ method: 'otp', timestamp: created + 60 }]), [{ id: clubId }]);
    const active = await f.club('tc-nouveau');
    assert.equal(active.status, 'active');
    const days = (new Date(active.trial_ends_at) - Date.now()) / 86_400_000;
    assert.ok(days > 29.9 && days <= 30, `trial ends in ${days} days`);
    assert.deepEqual(await activate(id(201), [{ method: 'magiclink', timestamp: created + 120 }]), []);
    assert.equal(String((await f.club('tc-nouveau')).trial_ends_at), String(active.trial_ends_at));
    assert.equal((await f.as('anon', null, 'SELECT id FROM clubs WHERE id = $1', [clubId])).length, 1);
    // Un essai activé ne peut plus redevenir pending.
    await assert.rejects(f.db.query("UPDATE clubs SET status = 'pending' WHERE id = $1", [clubId]), /clubs_self_serve_lifecycle/);
  } finally { await f.db.close(); }
});

test('club-signup SQL: sliding-window throttle per IP and per email', async () => {
  const f = await fixture();
  try {
    const hash = (c) => c.repeat(64);
    const throttle = async (ip, email) => (await f.as('service_role', null, 'SELECT club_self_serve_throttle($1,$2) ok', [hash(ip), hash(email)]))[0].ok;
    for (let i = 0; i < 3; i++) assert.equal(await throttle('a', 'b'), true);
    assert.equal(await throttle('a', 'b'), false, 'email: 3 per 24 h');
    assert.equal(await throttle('a', 'c'), true);
    assert.equal(await throttle('a', 'd'), true);
    assert.equal(await throttle('a', 'e'), false, 'ip: 5 per hour');
    assert.equal((await f.db.query('SELECT count(*)::int n FROM club_self_serve_attempts')).rows[0].n, 10, 'refusals are not counted');
    await f.db.query("UPDATE club_self_serve_attempts SET created_at = now() - interval '61 minutes'");
    assert.equal(await throttle('a', 'e'), true, 'the IP window slides');
    assert.equal(await throttle('f', 'b'), false, 'the email window is still full');
    await assert.rejects(throttle('x', 'not-hex'), (e) => e.code === 'PT400');
  } finally { await f.db.close(); }
});

test('club-signup SQL: purge removes stale pending clubs and only accounts created for them', async () => {
  const f = await fixture();
  try {
    await f.account(201, 'nouveau@example.test', { created_via: 'club_signup' });
    await f.account(202, 'deux@example.test', { created_via: 'club_signup' });
    await f.account(203, 'ancien@example.test');
    const stale = (await f.create({ slug: 'tc-stale' })).club_id;
    const staleKnown = (await f.create({ slug: 'tc-known', email: 'user101@example.test' })).club_id;
    const staleOld = (await f.create({ slug: 'tc-ancien', email: 'ancien@example.test' })).club_id;
    const staleTwice = (await f.create({ slug: 'tc-deux', email: 'deux@example.test' })).club_id;
    await f.create({ slug: 'tc-deux-b', email: 'deux@example.test' });
    const recent = (await f.create({ slug: 'tc-recent', email: 'deux@example.test' })).club_id;
    await f.db.query("UPDATE clubs SET created_at = now() - interval '8 days' WHERE slug IN ('tc-stale','tc-known','tc-ancien','tc-deux')");
    await f.db.query("UPDATE clubs SET created_at = now() - interval '6 days' WHERE slug IN ('tc-deux-b','tc-recent')");

    const due = (await f.as('service_role', null, 'SELECT club_self_serve_purge_begin(50) id')).map(r => r.id);
    assert.deepEqual(new Set(due), new Set([stale, staleKnown, staleOld, staleTwice]));
    const purge = async (club) => (await f.as('service_role', null, 'SELECT club_self_serve_purge($1) id', [club])).map(r => r.id);
    assert.deepEqual(await purge(stale), [id(201)], 'account created by the signup, nothing else');
    assert.deepEqual(await purge(staleKnown), [], 'CAC admin keeps their account');
    assert.deepEqual(await purge(staleOld), [], 'pre-existing account is never deleted');
    assert.deepEqual(await purge(staleTwice), [], 'still admin of another pending club');
    assert.deepEqual(await purge(recent), [], 'too recent');
    assert.deepEqual(await purge(stale), [], 'already purged');
    for (const slug of ['tc-stale', 'tc-known', 'tc-ancien', 'tc-deux']) assert.equal(await f.club(slug), undefined, slug);
    assert.equal((await f.db.query('SELECT count(*)::int n FROM club_settings WHERE club_id = ANY($1)', [[stale, staleKnown]])).rows[0].n, 0);
    assert.equal((await f.club('tc-recent')).status, 'pending');
    assert.equal((await f.club('cac-tennis')).status, 'active');
    assert.equal((await f.db.query('SELECT count(*)::int n FROM club_members WHERE user_id = $1', [CAC_ADMIN])).rows[0].n, 1);

    // Un club activé n'est jamais purgé, même vieux.
    const created = Math.floor(Date.now() / 1000) + 5;
    await f.db.query("UPDATE clubs SET created_at = now() WHERE slug = 'tc-recent'");
    await f.as('authenticated', id(202), 'SELECT club_self_serve_activate()', [], [{ method: 'otp', timestamp: created }]);
    await f.db.query("UPDATE clubs SET created_at = now() - interval '30 days' WHERE slug = 'tc-recent'");
    assert.deepEqual(await purge(recent), []);
    assert.equal((await f.club('tc-recent')).status, 'active');
  } finally { await f.db.close(); }
});
