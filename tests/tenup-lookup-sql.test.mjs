// Onboarding Ten'Up d'abord, P1-back — migration 2026111520 dans PGlite : identifiant Ten'Up
// unique, `club_self_serve_create` avec identifiant et nom court (conflit → PT410, rejeu
// prioritaire), cache des lectures et `tenup_lookup_throttle` (20 / h / IP) réservés au service
// role, CAC inchangé.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { PGlite } from '@electric-sql/pglite';

const id = (n) => `00000000-0000-0000-0000-${String(n).padStart(12, '0')}`;
const migration = (file) => readFile(new URL(`../supabase/migrations/${file}`, import.meta.url), 'utf8');
const between = (text, start, end) => text.slice(text.indexOf(start), end ? text.indexOf(end) : undefined);
const CAC = id(1), OUTSIDER = id(109);
const IMAGES = (club) => `https://project.supabase.co/storage/v1/object/public/content-images/${club}/config`;
const HASH = (c) => c.repeat(64);

async function fixture({ duplicate = false } = {}) {
  const db = new PGlite();
  const socle = await migration('20260629_multi_tenant_socle.sql');
  const rls = await migration('20260816_multi_tenant_rls.sql');
  await db.exec(`
    CREATE ROLE anon; CREATE ROLE authenticated; CREATE ROLE service_role BYPASSRLS; -- comme sur Supabase
    CREATE SCHEMA auth; CREATE SCHEMA storage;
    CREATE FUNCTION storage.foldername(name text) RETURNS text[] LANGUAGE sql AS $$
      SELECT (string_to_array(name, '/'))[1:array_length(string_to_array(name, '/'), 1) - 1] $$;
    CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $$
      SELECT nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
    CREATE FUNCTION auth.jwt() RETURNS jsonb LANGUAGE sql STABLE AS $$
      SELECT coalesce(nullif(current_setting('request.jwt.claims', true), ''), '{}')::jsonb $$;
    GRANT USAGE ON SCHEMA public, auth, storage TO anon, authenticated, service_role;
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
    INSERT INTO profiles (id, is_super_admin) SELECT id, id = '${id(108)}' FROM auth.users;
    INSERT INTO club_members (club_id, user_id, role) VALUES ('${CAC}', '${id(101)}', 'admin'), ('${CAC}', '${id(102)}', 'manager');
  `);
  await db.exec(between(rls, 'CREATE OR REPLACE FUNCTION public.auth_club_ids()', '-- ============================================================\n-- 2.'));
  for (const file of ['2026081802_super_admin_console.sql', '20260909_club_settings_public_read.sql', '2026102601_club_self_serve.sql',
    '2026111401_club_site_publish.sql', '2026111402_tenup_site_profile.sql']) {
    await db.exec(await migration(file));
  }
  // Un club self-serve déjà rattaché à Moissac (import de ses équipes, S6b).
  await db.exec(`INSERT INTO clubs (id, slug, name, sport, status, plan, created_via, trial_ends_at, tenup_club_id)
    VALUES ('${id(2)}', 'tc-alpha', 'TC Alpha', 'tennis', 'active', 'trial', 'self_serve', now() + interval '30 days', '60820110')`);
  if (duplicate) await db.exec(`INSERT INTO clubs (id, slug, name, sport, status, plan, created_via, trial_ends_at, tenup_club_id)
    VALUES ('${id(3)}', 'tc-beta', 'TC Beta', 'tennis', 'active', 'trial', 'self_serve', now() + interval '30 days', '60820110')`);
  await db.exec(await migration('2026111520_tenup_club_unique.sql'));

  async function as(role, user, sql, params = []) {
    await db.exec('BEGIN');
    try {
      await db.query(`SELECT set_config('request.jwt.claim.sub', $1, true), set_config('request.jwt.claims', $2, true)`,
        [user || '', JSON.stringify(user ? { sub: user } : {})]);
      await db.exec(`SET LOCAL ROLE ${role}`);
      const result = await db.query(sql, params);
      await db.exec('COMMIT');
      return result.rows;
    } catch (error) { await db.exec('ROLLBACK'); throw error; }
  }
  let next = 500;
  const create = async ({ email = 'nouveau@example.test', slug = 'moissac-tc', club = id(next++), tenup = null, short = null } = {}) =>
    (await as('service_role', null, 'SELECT club_self_serve_create($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11) r',
      [club, email, 'Moissac Tennis Club', 'Moissac', 'tennis', slug, '#1f6f43', `${IMAGES(club)}/1-logo.webp`, `${IMAGES(club)}/1-hero-image.webp`, tenup, short]))[0].r;
  const account = (n, email) => db.query('INSERT INTO auth.users (id, email) VALUES ($1, $2)', [id(n), email]);
  return { db, as, create, account };
}

const code = async (promise) => { try { await promise; return null; } catch (error) { return error.code; } };

test('tenup lookup SQL: existing duplicates make the migration fail (to be resolved before)', async () => {
  await assert.rejects(fixture({ duplicate: true }), /clubs_tenup_club_id_key|duplicate key|could not create unique index/);
});

test('tenup lookup SQL: unique Ten\'Up id, create with id and short name, conflict → PT410', async () => {
  const f = await fixture();
  try {
    // Index unique, NULL autorisé plusieurs fois (le CAC et les clubs saisis à la main).
    assert.equal(await code(f.db.query(`UPDATE clubs SET tenup_club_id = '60820110' WHERE id = '${CAC}'`)), '23505');
    assert.equal((await f.db.query('SELECT count(*)::int n FROM clubs WHERE tenup_club_id IS NULL')).rows[0].n, 1);

    await f.account(301, 'nouveau@example.test');
    const result = await f.create({ tenup: '60310304', short: ' Blagnac TC ' });
    assert.equal(result.created, true);
    const row = (await f.db.query('SELECT c.tenup_club_id, c.status, s.config FROM clubs c JOIN club_settings s ON s.club_id = c.id WHERE c.id = $1', [result.club_id])).rows[0];
    assert.equal(row.tenup_club_id, '60310304');
    assert.equal(row.status, 'pending');
    assert.equal(row.config.brand.short_name, 'Blagnac TC');
    assert.equal(row.config.brand.name, 'Moissac Tennis Club');
    assert.match(row.config.home.hero_image, /\/config\/1-hero-image\.webp$/);

    // Rejeu (même adresse, même slug, club encore pending) : prioritaire sur le conflit d'identifiant.
    assert.deepEqual(await f.create({ tenup: '60310304' }), { club_id: result.club_id, created: false });
    // Identifiant tenu par un club actif, ou par un club pending (comme le slug) : PT410.
    await f.account(302, 'autre@example.test');
    assert.equal(await code(f.create({ email: 'autre@example.test', slug: 'autre-club', tenup: '60820110' })), 'PT410');
    assert.equal(await code(f.create({ email: 'autre@example.test', slug: 'autre-club', tenup: '60310304' })), 'PT410');
    assert.equal((await f.db.query("SELECT count(*)::int n FROM clubs WHERE slug = 'autre-club'")).rows[0].n, 0, 'nothing created');
    // Slug pris sans conflit d'identifiant : PT409 inchangé.
    assert.equal(await code(f.create({ email: 'autre@example.test', slug: 'tc-alpha', tenup: '57950125' })), 'PT409');

    // Validation : identifiant hors format, nom court de plus de 12 caractères.
    assert.equal(await code(f.create({ email: 'autre@example.test', slug: 'autre-club', tenup: '6082a' })), 'PT400');
    assert.equal(await code(f.create({ email: 'autre@example.test', slug: 'autre-club', short: 'Castelsarrasin' })), 'PT400');

    // Sans identifiant ni nom court : comportement S2 (signature à 9 arguments toujours valable).
    const bare = (await f.as('service_role', null, 'SELECT club_self_serve_create($1,$2,$3,$4,$5,$6,$7,$8,$9) r',
      [id(900), 'autre@example.test', 'TC Manuel', 'Albi', 'tennis', 'tc-manuel', '#1d4ed8', null, null]))[0].r;
    assert.equal(bare.created, true);
    const manual = (await f.db.query('SELECT c.tenup_club_id, s.config FROM clubs c JOIN club_settings s ON s.club_id = c.id WHERE c.id = $1', [id(900)])).rows[0];
    assert.equal(manual.tenup_club_id, null);
    assert.equal('short_name' in manual.config.brand, false);

    // Réservé au service role.
    for (const role of ['anon', 'authenticated']) {
      assert.equal(await code(f.as(role, role === 'anon' ? null : OUTSIDER, 'SELECT club_self_serve_create($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)',
        [id(901), 'autre@example.test', 'TC X', 'Albi', 'tennis', 'tc-x', '#1d4ed8', null, null, '1', null])), '42501');
    }
    assert.equal((await f.db.query("SELECT count(*)::int n FROM pg_proc WHERE proname = 'club_self_serve_create'")).rows[0].n, 1, 'old signature dropped');

    // Le CAC n'est pas touché.
    const cac = (await f.db.query('SELECT status, plan, tenup_club_id FROM clubs WHERE id = $1', [CAC])).rows[0];
    assert.deepEqual(cac, { status: 'active', plan: 'internal', tenup_club_id: null });
  } finally { await f.db.close(); }
});

test('tenup lookup SQL: throttle 20 per hour per IP, cache for the service role only', async () => {
  const f = await fixture();
  try {
    const throttle = (ip) => f.as('service_role', null, 'SELECT tenup_lookup_throttle($1) r', [ip]).then((rows) => rows[0].r);
    for (let i = 0; i < 20; i++) assert.equal(await throttle(HASH('a')), true);
    assert.equal(await throttle(HASH('a')), false, '21st read in the hour');
    assert.equal(await throttle(HASH('b')), true, 'another IP');
    assert.equal((await f.db.query(`SELECT count(*)::int n FROM club_self_serve_attempts WHERE bucket = 'lookup-ip:${HASH('a')}'`)).rows[0].n, 20, 'a refused read is not counted');
    // Une heure plus tard, la limite est levée ; la purge S2 (2 jours) nettoie aussi ces buckets.
    await f.db.exec("UPDATE club_self_serve_attempts SET created_at = now() - interval '61 minutes'");
    assert.equal(await throttle(HASH('a')), true);
    await f.db.exec("UPDATE club_self_serve_attempts SET created_at = now() - interval '3 days'");
    await f.as('service_role', null, 'SELECT club_self_serve_purge_begin(50)');
    assert.equal((await f.db.query('SELECT count(*)::int n FROM club_self_serve_attempts')).rows[0].n, 0);
    // Les limites de club-signup gardent leur format.
    assert.equal(await f.as('service_role', null, 'SELECT club_self_serve_throttle($1, $2) r', [HASH('c'), HASH('d')]).then((r) => r[0].r), true);
    assert.equal(await code(throttle('203.0.113.7')), 'PT400', 'never a clear IP');
    for (const role of ['anon', 'authenticated']) {
      assert.equal(await code(f.as(role, role === 'anon' ? null : OUTSIDER, 'SELECT tenup_lookup_throttle($1)', [HASH('e')])), '42501');
    }

    await f.as('service_role', null, "INSERT INTO tenup_lookup_cache (tenup_club_id, payload, images) VALUES ('60820110', '{\"name\":\"MOISSAC TENNIS CLUB\"}', '{_lookup/60820110/1-logo.webp}')");
    assert.equal(await code(f.as('service_role', null, "INSERT INTO tenup_lookup_cache (tenup_club_id, payload) VALUES ('x1', '{}')")), '23514');
    for (const role of ['anon', 'authenticated']) {
      assert.equal(await code(f.as(role, role === 'anon' ? null : OUTSIDER, 'SELECT * FROM tenup_lookup_cache')), '42501');
    }
  } finally { await f.db.close(); }
});

test('tenup lookup SQL: a concurrent sync writing the same id between check and insert → PT410, not PT409', async () => {
  const f = await fixture();
  try {
    await f.account(301, 'nouveau@example.test');
    // Simule `tenup-sync` qui écrit l'identifiant sur un autre club juste avant l'INSERT (après le
    // contrôle EXISTS) : seule la contrainte d'unicité voit le conflit.
    await f.db.exec(`
      CREATE FUNCTION race() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN
        IF NEW.tenup_club_id = '57950125' THEN UPDATE clubs SET tenup_club_id = '57950125' WHERE slug = 'tc-alpha'; END IF;
        RETURN NEW; END $$;
      CREATE TRIGGER race BEFORE INSERT ON clubs FOR EACH ROW EXECUTE FUNCTION race();`);
    assert.equal(await code(f.create({ tenup: '57950125' })), 'PT410');
    assert.equal((await f.db.query('SELECT conname FROM pg_constraint WHERE conname = $1', ['clubs_tenup_club_id_key'])).rows.length, 1, 'a table constraint');
    // Rejeu de la migration : idempotente.
    await f.db.exec(await migration('2026111520_tenup_club_unique.sql'));
  } finally { await f.db.close(); }
});

test('tenup lookup SQL: CAC admins keep their legacy paths but never write into _lookup/', async () => {
  const f = await fixture();
  try {
    const can = (user, path) => f.as('authenticated', user, 'SELECT can_write_club_object($1) r', [path]).then((rows) => rows[0].r);
    assert.equal(await can(id(101), 'legacy/image.png'), true, 'CAC admin, legacy path');
    assert.equal(await can(id(102), 'root.png'), true, 'CAC manager, root');
    assert.equal(await can(id(101), `${CAC}/config/logo.png`), true);
    for (const user of [id(101), id(102)]) {
      assert.equal(await can(user, '_lookup/60820110/1-logo.webp'), false, `${user} _lookup`);
      assert.equal(await can(user, '_lookup/x.png'), false);
    }
    assert.equal(await can(id(103), 'legacy/image.png'), false, 'not a CAC member');
    assert.equal(await can(id(108), '_lookup/60820110/1-logo.webp'), true, 'super-admin (console)');
  } finally { await f.db.close(); }
});
