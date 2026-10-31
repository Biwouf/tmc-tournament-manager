import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { PGlite } from '@electric-sql/pglite';
import { coursesFixtureSQL, id } from './helpers/courses-fixture.mjs';

const migration = (name) =>
  readFile(new URL(`../supabase/migrations/${name}.sql`, import.meta.url), 'utf8');

async function setup() {
  const db = new PGlite();
  await db.exec(coursesFixtureSQL + 'CREATE ROLE service_role; GRANT USAGE ON SCHEMA public TO service_role;');
  for (const name of ['2026091001_courses', '2026091002_courses_pwa', '2026091101_course_owner_identity',
    '2026092301_course_email', '2026092302_course_email_requester', '2026092303_course_email_denial_reason',
    '2026092402_course_web_push']) await db.exec(await migration(name));
  await db.exec(`CREATE TABLE events(id uuid PRIMARY KEY,club_id uuid NOT NULL,titre text NOT NULL,date_debut timestamptz NOT NULL);
    CREATE TABLE actus(id uuid PRIMARY KEY,club_id uuid NOT NULL,titre text NOT NULL,published boolean NOT NULL DEFAULT false);
    CREATE FUNCTION set_updated_at() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN NEW.updated_at=now(); RETURN NEW; END $$;
    CREATE FUNCTION can_manage_club_content(cid uuid) RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER AS $$ SELECT EXISTS(SELECT 1 FROM club_members WHERE club_id=cid AND user_id=auth.uid() AND role IN ('admin','manager')) $$;`);
  await db.exec((await migration('20260423_live_matches')).replace('ALTER PUBLICATION supabase_realtime ADD TABLE live_matches;', ''));
  await db.exec(`ALTER TABLE live_matches ADD COLUMN club_id uuid NOT NULL DEFAULT '${id(1)}', ADD COLUMN court text,ADD COLUMN started_at timestamptz,ADD COLUMN retired_player live_match_winner;
    GRANT SELECT ON club_members TO authenticated;`);
  for (const name of ['20260907_live_match_consistency', '2026093001_live_activity', '2026101102_live_photos',
    '2026101104_live_reactions_throttle', '2026101501_live_post_reactions', '2026102001_live_post_after_finish',
    '2026101301_live_set_times', '2026102401_live_web_push', '2026102402_live_push_start_text',
    '2026102403_live_push_result_text', '2026102404_live_push_score_format', '2026102901_content_web_push'])
    await db.exec(await migration(name));
  await db.exec(`INSERT INTO actus VALUES('${id(30)}','${id(1)}','Assemblée générale',true),
      ('${id(31)}','${id(1)}','Brouillon',false),('${id(32)}','${id(2)}','Autre club',true);
    INSERT INTO events VALUES('${id(40)}','${id(1)}','Tournoi de Noël','2026-12-20 13:30:00+00');`);
  async function as(user, sql, args = []) {
    await db.exec(`BEGIN; SET LOCAL ROLE ${user === null ? 'anon' : 'authenticated'};
      SELECT set_config('request.jwt.claim.sub','${user === null ? '' : id(user)}',true);`);
    try {
      const { rows } = await db.query(sql, args);
      await db.exec('COMMIT');
      return rows;
    } catch (e) {
      await db.exec('ROLLBACK');
      throw e;
    }
  }
  const subscribe = (user, prefs, club = id(1)) => as(user,
    'SELECT * FROM push_subscribe($1,$2,$3,$4,$5,$6,$7)',
    [club, `https://fcm.googleapis.com/fcm/send/u${user}`, 'p'.repeat(40), 'a'.repeat(20), ...prefs]);
  const announce = (user, kind, content) =>
    as(user, 'SELECT content_push_announce($1,$2,$3) n', [id(1), kind, id(content)]).then((r) => r[0].n);
  const jobs = async () => (await db.query(`SELECT s.user_id,d.kind,d.title,d.body,d.url
    FROM content_push_deliveries d JOIN course_push_subscriptions s ON s.id=d.subscription_id
    ORDER BY d.kind,s.user_id`)).rows;
  return { db, as, subscribe, announce, jobs };
}

test('content push: news preference, announcement rights, recipients, dedupe and claim', async () => {
  const { db, as, subscribe, announce, jobs } = await setup();
  try {
    // Existing devices keep news on; new devices start with news on; NULL keeps the preference.
    await as(103, 'SELECT course_push_subscribe($1,$2,$3,$4)',
      [id(1), 'https://fcm.googleapis.com/fcm/send/u103', 'p'.repeat(40), 'a'.repeat(20)]);
    assert.deepEqual((await subscribe(103, [null, null, null]))[0],
      { notify_courses: true, notify_live: false, notify_news: true });
    assert.deepEqual((await subscribe(104, [null, true, null]))[0],
      { notify_courses: false, notify_live: true, notify_news: true });
    assert.deepEqual((await subscribe(105, [null, null, false]))[0].notify_news, false);
    await subscribe(101, [null, null, null]);
    await assert.rejects(as(103, 'SELECT * FROM content_push_deliveries'), /permission denied/);

    // Only admins and managers of the club; actus must be published.
    await assert.rejects(announce(103, 'actu', 30), /gestionnaires du club/);
    await assert.rejects(announce(106, 'actu', 30), /gestionnaires du club/);
    await assert.rejects(announce(101, 'actu', 31), /introuvable/);
    await assert.rejects(announce(101, 'actu', 32), /introuvable/);
    await assert.rejects(announce(101, 'autre', 30), /VALIDATION_ERROR/);

    // News subscribers of the club, except the announcer; once per content.
    assert.equal(await announce(101, 'actu', 30), 2);
    assert.equal(await announce(102, 'actu', 30), 0);
    assert.equal(await announce(102, 'event', 40), 3);
    const rows = await jobs();
    assert.deepEqual(rows.filter((r) => r.kind === 'actu').map((r) => r.user_id), [id(103), id(104)]);
    assert.deepEqual(rows[0], { user_id: id(103), kind: 'actu', title: 'Nouvelle actu',
      body: 'Assemblée générale', url: `/actus/${id(30)}` });
    const event = rows.find((r) => r.kind === 'event');
    assert.equal(event.title, 'Nouvel événement');
    assert.equal(event.body, 'Tournoi de Noël · 20/12 à 14h30', 'Paris time');
    assert.equal(event.url, `/evenements/${id(40)}`);

    // Claim: tag and lifetime, then leases.
    await db.exec('SET ROLE service_role');
    const claimed = (await db.query('SELECT * FROM content_push_claim(100)')).rows;
    assert.equal(claimed.length, 5);
    assert.equal(claimed.find((r) => r.url.startsWith('/actus/')).tag, `actu-${id(30)}`);
    assert.equal(claimed[0].ttl, 86400);
    assert.equal((await db.query('SELECT * FROM content_push_claim(100)')).rows.length, 0);
    await db.exec('RESET ROLE');
  } finally {
    await db.close();
  }
});
