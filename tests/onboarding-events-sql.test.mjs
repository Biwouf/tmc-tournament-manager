// Onboarding P0 — `onboarding_events` : RPC réservée aux admins du club, déclencheur sur `clubs`.
// Fixture reprise de club-site-publish-sql.test.mjs.
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
  for (const file of ['2026081802_super_admin_console.sql', '20260909_club_settings_public_read.sql', '2026102601_club_self_serve.sql', '2026111401_club_site_publish.sql', '2026111502_onboarding_events.sql', '2026111903_onboarding_video_events.sql']) {
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
const log = (f, user, clubId, name, props) => f.as('authenticated', user, 'SELECT onboarding_event_log($1, $2, $3) r', [clubId, name, props === undefined ? '{}' : JSON.stringify(props)]);
const events = async (f) => (await f.db.query('SELECT club_id, name, props FROM onboarding_events ORDER BY id')).rows.map(r => [r.club_id, r.name, r.props]);

test('onboarding-events SQL: a self-serve club admin records the five browser events, count only on teams_imported', async () => {
  const f = await fixture();
  try {
    for (const name of ['teams_import_started', 'poster_generated', 'app_shared', 'first_steps_finished']) {
      assert.deepEqual(await log(f, SELF_ADMIN, SELF, name), [{ r: true }], name);
    }
    assert.deepEqual(await log(f, SELF_ADMIN, SELF, 'teams_imported', { count: 8 }), [{ r: true }]);
    assert.deepEqual((await events(f)).map(e => [e[1], e[2]]), [
      ['teams_import_started', {}], ['poster_generated', {}], ['app_shared', {}], ['first_steps_finished', {}], ['teams_imported', { count: 8 }]]);
    // Nom inconnu, événements du serveur, propriétés personnelles ou mal formées : refusés.
    for (const [name, props] of [['signup_view', {}], ['club_activated', {}], ['site_published', {}], [null, {}],
      ['app_shared', { email: 'a@b.fr' }], ['teams_imported', {}], ['teams_imported', { count: -1 }], ['teams_imported', { count: '3' }],
      ['teams_imported', { count: 2, name: 'TC' }], ['teams_imported', { count: 1.5 }]]) {
      await assert.rejects(log(f, SELF_ADMIN, SELF, name, props), (error) => error.code === '22023', `${name} ${JSON.stringify(props)}`);
    }
    assert.equal((await events(f)).length, 5);
  } finally { await f.db.close(); }
});

test('onboarding-events SQL (W1): the four video events, with only their short properties', async () => {
  const f = await fixture();
  try {
    assert.deepEqual(await log(f, SELF_ADMIN, SELF, 'video_previewed'), [{ r: true }]);
    assert.deepEqual(await log(f, SELF_ADMIN, SELF, 'video_exported', { seconds: 14, ms: 12980, bytes: 7104331 }), [{ r: true }]);
    assert.deepEqual(await log(f, SELF_ADMIN, SELF, 'video_shared', { method: 'share' }), [{ r: true }]);
    assert.deepEqual(await log(f, SELF_ADMIN, SELF, 'video_shared', { method: 'download' }), [{ r: true }]);
    assert.deepEqual(await log(f, SELF_ADMIN, SELF, 'video_export_failed', { reason: 'encode' }), [{ r: true }]);
    assert.deepEqual(await log(f, SELF_ADMIN, SELF, 'video_export_failed', { reason: 'share' }), [{ r: true }]);
    assert.deepEqual((await events(f)).map(e => e[1]), ['video_previewed', 'video_exported', 'video_shared', 'video_shared', 'video_export_failed', 'video_export_failed']);
    assert.deepEqual((await events(f))[1][2], { seconds: 14, ms: 12980, bytes: 7104331 });
    for (const [name, props] of [
      ['video_previewed', { seconds: 3 }],
      ['video_exported', {}], ['video_exported', { seconds: 14, ms: 1 }], ['video_exported', { seconds: 14, ms: 1, bytes: -1 }],
      ['video_exported', { seconds: 14.5, ms: 1, bytes: 1 }], ['video_exported', { seconds: '14', ms: 1, bytes: 1 }],
      ['video_exported', { seconds: 14, ms: 1, bytes: 1, club: 'Moissac' }],
      ['video_shared', {}], ['video_shared', { method: 'email' }], ['video_shared', { method: 'share', to: 'a@b.fr' }],
      ['video_export_failed', { reason: 'VideoEncoder: out of memory' }], ['video_export_failed', {}]]) {
      await assert.rejects(log(f, SELF_ADMIN, SELF, name, props), (error) => error.code === '22023', `${name} ${JSON.stringify(props)}`);
    }
    assert.equal((await events(f)).length, 6);
    // Toujours rien pour le CAC, et toujours réservé aux admins.
    assert.deepEqual(await log(f, CAC_ADMIN, CAC, 'video_previewed'), [{ r: false }]);
    await assert.rejects(log(f, SELF_MEMBER, SELF, 'video_previewed'), (error) => error.code === '42501');
    const source = await migration('2026111903_onboarding_video_events.sql');
    assert.doesNotMatch(source.replace(/^--.*$/gm, ''), /40001/);
  } finally { await f.db.close(); }
});

test('onboarding-events SQL: refuses members, other admins, outsiders, the support and anon; nothing for the CAC', async () => {
  const f = await fixture();
  try {
    for (const user of [SELF_MEMBER, CAC_ADMIN, OUTSIDER, SUPER]) {
      await assert.rejects(log(f, user, SELF, 'app_shared'), (error) => error.code === '42501', user);
    }
    await assert.rejects(f.as('anon', null, "SELECT onboarding_event_log($1, 'app_shared')", [SELF]), /permission denied/);
    // Club `console` (le CAC) : rien n'est écrit, sans erreur.
    assert.deepEqual(await log(f, CAC_ADMIN, CAC, 'app_shared'), [{ r: false }]);
    assert.deepEqual(await events(f), []);
    // Lecture et écriture directes fermées aux navigateurs.
    for (const user of [SELF_ADMIN, SUPER]) {
      await assert.rejects(f.as('authenticated', user, 'SELECT * FROM onboarding_events'), /permission denied/);
      await assert.rejects(f.as('authenticated', user, "INSERT INTO onboarding_events (club_id, name) VALUES ($1, 'app_shared')", [SELF]), /permission denied/);
    }
    // Club suspendu : son admin n'écrit plus.
    await f.db.query("UPDATE clubs SET status = 'suspended' WHERE id = $1", [SELF]);
    await assert.rejects(log(f, SELF_ADMIN, SELF, 'app_shared'), (error) => error.code === '42501');
  } finally { await f.db.close(); }
});

test('onboarding-events SQL: activation and site publication are recorded by the database, self-serve only', async () => {
  const f = await fixture();
  try {
    await f.db.query("UPDATE clubs SET status = 'pending', trial_ends_at = NULL WHERE id = $1", [SELF]);
    assert.deepEqual(await events(f), [], 'active → pending is not an event');
    await f.db.query("UPDATE clubs SET status = 'active', trial_ends_at = now() + interval '30 days' WHERE id = $1", [SELF]);
    await publish(f, SELF_ADMIN, SELF, true);
    await publish(f, SELF_ADMIN, SELF, true);
    // Dépublier puis republier : seule la première publication compte.
    await publish(f, SELF_ADMIN, SELF, false);
    await publish(f, SELF_ADMIN, SELF, true);
    await f.db.query('UPDATE clubs SET name = $2 WHERE id = $1', [SELF, 'TC Alpha 2']);
    // Suspendu puis repassé en attente et réactivé (support) : une seule activation.
    await f.db.query("UPDATE clubs SET status = 'pending', trial_ends_at = NULL WHERE id = $1", [SELF]);
    await f.db.query("UPDATE clubs SET status = 'active', trial_ends_at = now() + interval '30 days' WHERE id = $1", [SELF]);
    assert.deepEqual((await events(f)).map(e => [e[0], e[1]]), [[SELF, 'club_activated'], [SELF, 'site_published']], 'once each, nothing for a rename');
    // Le CAC : ni publication ni suspension/réactivation n'écrivent quoi que ce soit.
    await f.db.query("UPDATE clubs SET site_published = false WHERE id = $1", [CAC]);
    await publish(f, CAC_ADMIN, CAC, true);
    await f.db.query("UPDATE clubs SET status = 'suspended' WHERE id = $1", [CAC]);
    await f.db.query("UPDATE clubs SET status = 'active' WHERE id = $1", [CAC]);
    assert.equal((await events(f)).length, 2);
    const source = await migration('2026111502_onboarding_events.sql');
    assert.doesNotMatch(source.replace(/^--.*$/gm, ''), /40001/);
  } finally { await f.db.close(); }
});
