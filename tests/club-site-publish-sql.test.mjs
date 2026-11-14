// SaaS S8 — `club_set_site_published` : seul chemin d'écriture de `site_published` côté navigateur.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { PGlite } from '@electric-sql/pglite';

const id = (n) => `00000000-0000-0000-0000-${String(n).padStart(12, '0')}`;
const migration = (file) => readFile(new URL(`../supabase/migrations/${file}`, import.meta.url), 'utf8');
const between = (text, start, end) => text.slice(text.indexOf(start), end ? text.indexOf(end) : undefined);
const CAC = id(1), SELF = id(2), CAC_ADMIN = id(101), SELF_ADMIN = id(102), SELF_MEMBER = id(103), SUPER = id(108), OUTSIDER = id(109);

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
  `);
  await db.exec(between(rls, 'CREATE OR REPLACE FUNCTION public.auth_club_ids()', '-- ============================================================\n-- 2.'));
  for (const file of ['2026081802_super_admin_console.sql', '20260909_club_settings_public_read.sql', '2026102601_club_self_serve.sql', '2026111401_club_site_publish.sql']) {
    await db.exec(await migration(file));
  }
  // Club self-serve déjà activé (l'activation par lien magique est testée par club-signup-sql).
  await db.exec(`
    INSERT INTO clubs (id, slug, name, sport, status, plan, created_via, site_published, trial_ends_at)
      VALUES ('${SELF}', 'tc-alpha', 'TC Alpha', 'tennis', 'active', 'trial', 'self_serve', false, now() + interval '30 days');
    INSERT INTO club_members (club_id, user_id, role) VALUES
      ('${CAC}', '${CAC_ADMIN}', 'admin'), ('${SELF}', '${SELF_ADMIN}', 'admin'), ('${SELF}', '${SELF_MEMBER}', 'member');
  `);
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
  const club = async (clubId) => (await db.query('SELECT status, plan, created_via, site_published, trial_ends_at FROM clubs WHERE id = $1', [clubId])).rows[0];
  return { db, as, club };
}

const publish = (f, user, clubId, value) => f.as('authenticated', user, 'SELECT club_set_site_published($1, $2) r', [clubId, value]);

test('club-site-publish SQL: a club admin publishes and unpublishes, nothing else changes', async () => {
  const f = await fixture();
  try {
    const before = await f.club(SELF);
    assert.deepEqual(await publish(f, SELF_ADMIN, SELF, true), [{ r: true }]);
    assert.deepEqual(await f.club(SELF), { ...before, site_published: true });
    assert.deepEqual(await publish(f, SELF_ADMIN, SELF, false), [{ r: false }]);
    assert.deepEqual(await f.club(SELF), before);
    // Support : le super-admin peut agir sur n'importe quel club.
    assert.deepEqual(await publish(f, SUPER, SELF, true), [{ r: true }]);
    await assert.rejects(publish(f, SELF_ADMIN, SELF, null), /manquante/);
  } finally { await f.db.close(); }
});

test('club-site-publish SQL: refuses a member, another club admin, an outsider and anon', async () => {
  const f = await fixture();
  try {
    for (const user of [SELF_MEMBER, CAC_ADMIN, OUTSIDER]) {
      await assert.rejects(publish(f, user, SELF, true), (error) => error.code === '42501', user);
    }
    // L'admin du club n'agit pas sur un autre club.
    await assert.rejects(publish(f, SELF_ADMIN, CAC, false), (error) => error.code === '42501');
    await assert.rejects(f.as('anon', null, 'SELECT club_set_site_published($1, true)', [SELF]), /permission denied/);
    assert.equal((await f.db.query("SELECT has_function_privilege('anon', 'public.club_set_site_published(uuid,boolean)', 'EXECUTE') ok")).rows[0].ok, false);
    assert.equal((await f.club(SELF)).site_published, false);
    assert.equal((await f.club(CAC)).site_published, true);
    // Club suspendu : plus d'admin actif, même son admin est refusé.
    await f.db.query("UPDATE clubs SET status = 'suspended' WHERE id = $1", [SELF]);
    await assert.rejects(publish(f, SELF_ADMIN, SELF, true), (error) => error.code === '42501');
    await assert.rejects(publish(f, SUPER, id(999), true), (error) => error.code === 'P0002');
  } finally { await f.db.close(); }
});

test('club-site-publish SQL: authenticated still cannot write site_published directly; never 40001', async () => {
  const f = await fixture();
  try {
    for (const user of [SELF_ADMIN, SUPER]) {
      await assert.rejects(f.as('authenticated', user, 'UPDATE clubs SET site_published = true WHERE id = $1', [SELF]), /permission denied/);
    }
    const source = await migration('2026111401_club_site_publish.sql');
    assert.doesNotMatch(source.replace(/^--.*$/gm, ''), /40001/);
  } finally { await f.db.close(); }
});
