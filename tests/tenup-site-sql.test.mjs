// SaaS S8b — lectures du profil Ten'Up : admin seulement, jamais `internal`, une lecture réussie par
// club et par 24 h (tâche de fond comprise, hors plafond d'essai), 3 échecs au plus ; proposition
// lisible des seuls admins du club ; identifiant Ten'Up non modifiable par le navigateur.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { PGlite } from '@electric-sql/pglite';

const id = (n) => `00000000-0000-0000-0000-${String(n).padStart(12, '0')}`;
const migration = (file) => readFile(new URL(`../supabase/migrations/${file}`, import.meta.url), 'utf8');
const between = (text, start, end) => text.slice(text.indexOf(start), end ? text.indexOf(end) : undefined);
const CAC = id(1), SELF = id(2), OTHER = id(3), OTHER_ADMIN = id(104), CAC_ADMIN = id(101), SELF_ADMIN = id(102), SELF_MEMBER = id(103), SUPER = id(108), OUTSIDER = id(109);

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
  for (const file of ['2026081802_super_admin_console.sql', '20260909_club_settings_public_read.sql', '2026102601_club_self_serve.sql', '2026111401_club_site_publish.sql', '2026111402_tenup_site_profile.sql']) {
    await db.exec(await migration(file));
  }
  // Club self-serve déjà activé (l'activation par lien magique est testée par club-signup-sql).
  await db.exec(`
    INSERT INTO clubs (id, slug, name, sport, status, plan, created_via, site_published, trial_ends_at)
      VALUES ('${SELF}', 'tc-alpha', 'TC Alpha', 'tennis', 'active', 'trial', 'self_serve', false, now() + interval '30 days');
    INSERT INTO club_members (club_id, user_id, role) VALUES
      ('${CAC}', '${CAC_ADMIN}', 'admin'), ('${SELF}', '${SELF_ADMIN}', 'admin'), ('${SELF}', '${SELF_MEMBER}', 'member');
    INSERT INTO clubs (id, slug, name, sport, status, plan, created_via, trial_ends_at)
      VALUES ('${OTHER}', 'tc-beta', 'TC Beta', 'tennis', 'active', 'trial', 'self_serve', now() + interval '30 days');
    INSERT INTO club_members (club_id, user_id, role) VALUES ('${OTHER}', '${OTHER_ADMIN}', 'admin');
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

const begin = (f, user, club, tenupId = '60820110', background = false) =>
  f.as('authenticated', user, 'SELECT club_tenup_site_begin($1, $2, $3) r', [club, tenupId, background]).then((rows) => rows[0].r);
const state = (f, user, club) => f.as('authenticated', user, 'SELECT club_tenup_site_state($1) r', [club]).then((rows) => rows[0].r);
const age = (f, club, interval) => f.db.query(`UPDATE club_tenup_site_reads SET created_at = created_at - interval '${interval}' WHERE club_id = $1`, [club]);
const finish = (f, readId, status) => f.db.query('UPDATE club_tenup_site_reads SET status = $2 WHERE id = $1', [readId, status]);

test('tenup-site SQL: one successful read per club and per 24 h, background included', async () => {
  const f = await fixture();
  try {
    await f.db.query(`UPDATE clubs SET tenup_club_id = '60820110' WHERE id = $1`, [SELF]);
    const first = await begin(f, SELF_ADMIN, SELF);
    assert.equal(first.started, true);
    assert.equal(first.tenup_club_id, '60820110');
    // Lecture en cours : une seconde est refusée, la tâche de fond s'abstient sans erreur.
    await assert.rejects(begin(f, SELF_ADMIN, SELF), /déjà en cours/);
    assert.deepEqual(await begin(f, SELF_ADMIN, SELF, null, true), { started: false, reason: 'recent' });
    assert.equal((await state(f, SELF_ADMIN, SELF)).running, true);
    await finish(f, first.read_id, 'done');
    await assert.rejects(begin(f, SELF_ADMIN, SELF, '57950125'), /dernières 24 heures. Nouvelle lecture possible le \d\d\/\d\d à \d\dh\d\d/);
    const s = await state(f, SELF_ADMIN, SELF);
    assert.equal(s.available, true);
    assert.equal(s.running, false);
    assert.ok(s.next_read_at);
    // Un autre club n'est pas concerné ; le lendemain, nouvelle lecture possible.
    assert.equal((await begin(f, OTHER_ADMIN, OTHER)).started, true);
    await age(f, SELF, '25 hours');
    assert.equal((await begin(f, SELF_ADMIN, SELF)).started, true);
    // Hors plafond d'essai (décision 3) : le compteur des 40 lectures n'est jamais appelé.
    assert.doesNotMatch(await migration('2026111402_tenup_site_profile.sql'), /team_tenup_read_begin|team_tenup_competition_requests/);
  } finally { await f.db.close(); }
});

test('tenup-site SQL: failed reads do not count, three failures block for the day', async () => {
  const f = await fixture();
  try {
    await f.db.query(`UPDATE clubs SET tenup_club_id = '60820110' WHERE id = $1`, [SELF]);
    for (let i = 0; i < 3; i++) {
      const read = await begin(f, SELF_ADMIN, SELF);
      assert.equal(read.started, true, `failure ${i} does not block`);
      await finish(f, read.read_id, 'failed');
    }
    await assert.rejects(begin(f, SELF_ADMIN, SELF), /trois lectures/);
    assert.deepEqual(await begin(f, SELF_ADMIN, SELF, null, true), { started: false, reason: 'failures' });
    assert.equal((await state(f, SELF_ADMIN, SELF)).failures, 3);
    // Une lecture restée « en cours » au-delà de 2 minutes (Edge interrompue) est un échec.
    await f.db.query('DELETE FROM club_tenup_site_reads');
    await begin(f, SELF_ADMIN, SELF);
    await age(f, SELF, '3 minutes');
    assert.equal((await begin(f, SELF_ADMIN, SELF)).started, true);
  } finally { await f.db.close(); }
});

test('tenup-site SQL: background read uses the stored Ten’Up id, quietly', async () => {
  const f = await fixture();
  try {
    assert.deepEqual(await begin(f, SELF_ADMIN, SELF, null, true), { started: false, reason: 'no_id' });
    await assert.rejects(begin(f, SELF_ADMIN, SELF, null, false), /Collez le lien/);
    await f.db.query(`UPDATE clubs SET tenup_club_id = '60310304' WHERE id = $1`, [SELF]);
    const read = await begin(f, SELF_ADMIN, SELF, null, true);
    assert.equal(read.started, true);
    assert.equal(read.tenup_club_id, '60310304');
    assert.equal((await f.db.query('SELECT background FROM club_tenup_site_reads WHERE id = $1', [read.read_id])).rows[0].background, true);
    await assert.rejects(begin(f, SELF_ADMIN, SELF, '12ab'), /invalide/);
    await assert.rejects(f.db.query(`UPDATE clubs SET tenup_club_id = 'x' WHERE id = $1`, [SELF]), /clubs_tenup_club_id_format/);
  } finally { await f.db.close(); }
});

test('tenup-site SQL: admins only, never an internal club; browser cannot write the id', async () => {
  const f = await fixture();
  try {
    await assert.rejects(begin(f, SELF_MEMBER, SELF), /administrateurs/);
    await assert.rejects(begin(f, OTHER_ADMIN, SELF), /administrateurs/);
    await assert.rejects(f.as('anon', null, 'SELECT club_tenup_site_begin($1, $2, false)', [SELF, '1']), /permission denied/);
    await assert.rejects(begin(f, CAC_ADMIN, CAC), /pas proposé/);
    assert.deepEqual(await state(f, CAC_ADMIN, CAC), { available: false });
    await assert.rejects(state(f, SELF_MEMBER, SELF), /administrateurs/);
    await assert.rejects(f.as('authenticated', SELF_ADMIN, `UPDATE clubs SET tenup_club_id = '1' WHERE id = $1`, [SELF]), /permission denied/);
    await assert.rejects(f.as('authenticated', SELF_ADMIN, 'SELECT * FROM club_tenup_site_reads'), /permission denied/);
    // Le support (super-admin) peut lire pour un club.
    assert.equal((await begin(f, SUPER, SELF)).started, true);
  } finally { await f.db.close(); }
});

test('tenup-site SQL: the proposal is readable by the club admins only, consumed once', async () => {
  const f = await fixture();
  try {
    await f.db.query(`INSERT INTO club_tenup_site_proposals (club_id, tenup_club_id, payload) VALUES ($1, '60820110', '{"club":{"name":"TC"}}')`, [SELF]);
    const read = (user) => f.as('authenticated', user, 'SELECT club_id, status FROM club_tenup_site_proposals');
    assert.deepEqual(await read(SELF_ADMIN), [{ club_id: SELF, status: 'ready' }]);
    assert.deepEqual(await read(SELF_MEMBER), []);
    assert.deepEqual(await read(OTHER_ADMIN), []);
    await assert.rejects(f.as('anon', null, 'SELECT * FROM club_tenup_site_proposals'), /permission denied/);
    await assert.rejects(f.as('authenticated', SELF_ADMIN, `UPDATE club_tenup_site_proposals SET status = 'consumed'`), /permission denied/);
    await assert.rejects(f.as('authenticated', SELF_MEMBER, 'SELECT club_tenup_site_consume($1)', [SELF]), /administrateurs/);
    assert.deepEqual(await f.as('authenticated', SELF_ADMIN, 'SELECT club_tenup_site_consume($1) r', [SELF]), [{ r: true }]);
    assert.deepEqual(await f.as('authenticated', SELF_ADMIN, 'SELECT club_tenup_site_consume($1) r', [SELF]), [{ r: false }]);
    // La migration se rejoue sans erreur.
    await f.db.exec(await migration('2026111402_tenup_site_profile.sql'));
  } finally { await f.db.close(); }
});
