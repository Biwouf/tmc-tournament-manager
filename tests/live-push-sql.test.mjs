import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
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
  await db.exec(`CREATE TABLE events(id uuid PRIMARY KEY);
    CREATE FUNCTION set_updated_at() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN NEW.updated_at=now(); RETURN NEW; END $$;
    CREATE FUNCTION can_manage_club_content(cid uuid) RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER AS $$ SELECT EXISTS(SELECT 1 FROM club_members WHERE club_id=cid AND user_id=auth.uid() AND role IN ('admin','manager')) $$;`);
  await db.exec((await migration('20260423_live_matches')).replace('ALTER PUBLICATION supabase_realtime ADD TABLE live_matches;', ''));
  await db.exec(`ALTER TABLE live_matches ADD COLUMN club_id uuid NOT NULL DEFAULT '${id(1)}', ADD COLUMN court text,ADD COLUMN started_at timestamptz,ADD COLUMN retired_player live_match_winner;
    DROP POLICY live_matches_select ON live_matches;
    CREATE POLICY tenant_isolation ON live_matches FOR ALL TO authenticated USING(club_id IN (SELECT club_id FROM club_members WHERE user_id=auth.uid())) WITH CHECK(club_id IN (SELECT club_id FROM club_members WHERE user_id=auth.uid()));
    GRANT SELECT ON club_members TO authenticated;
    GRANT SELECT,INSERT,UPDATE,DELETE ON live_matches TO authenticated;`);
  for (const name of ['20260907_live_match_consistency', '2026093001_live_activity', '2026101102_live_photos',
    '2026101104_live_reactions_throttle', '2026101501_live_post_reactions', '2026102001_live_post_after_finish',
    '2026101301_live_set_times', '2026102401_live_web_push', '2026102402_live_push_start_text']) await db.exec(await migration(name));
  await db.exec(`INSERT INTO live_matches(id,club_id,match_date,j1_prenom,j1_nom,j2_prenom,j2_nom,status,court)
    VALUES('${id(20)}','${id(1)}','2026-10-24','Alex','Dupont','Sam','Martin','pending','2'),
    ('${id(21)}','${id(2)}','2026-10-24','Autre','Club','Autre','Club','pending',null);`);
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
  const subscribe = (user, prefs = [null, true], club = id(1)) => as(user,
    'SELECT * FROM push_subscribe($1,$2,$3,$4,$5,$6)',
    [club, `https://fcm.googleapis.com/fcm/send/u${user}`, 'p'.repeat(40), 'a'.repeat(20), ...prefs]);
  const jobs = async (where = 'true') => (await db.query(`SELECT s.user_id,d.dedupe_key,d.title,d.body,d.url,d.post_count
    FROM live_push_deliveries d JOIN course_push_subscriptions s ON s.id=d.subscription_id
    WHERE ${where} ORDER BY d.created_at,s.user_id`)).rows;
  const score = (user, set) => as(user, `UPDATE live_matches SET ${set} WHERE id='${id(20)}' RETURNING status`);
  return { db, as, subscribe, jobs, score };
}

test('live push: preferences, start announcement, follows, sets, finish and feed', async () => {
  const { db, as, subscribe, jobs, score } = await setup();
  try {
    // Preferences: a new device opts in only to what it asked; an existing course device keeps courses.
    assert.deepEqual((await subscribe(101))[0], { notify_courses: false, notify_live: true });
    await as(102, 'SELECT course_push_subscribe($1,$2,$3,$4)',
      [id(1), `https://fcm.googleapis.com/fcm/send/u102`, 'p'.repeat(40), 'a'.repeat(20)]);
    assert.deepEqual((await subscribe(102, [null, null]))[0], { notify_courses: true, notify_live: false });
    await subscribe(103);
    await subscribe(104, [true, false]);
    await assert.rejects(subscribe(106), /NOT_MEMBER/);
    await assert.rejects(as(103, 'SELECT * FROM live_match_follows'), /permission denied/);
    await assert.rejects(as(103, 'SELECT * FROM live_push_deliveries'), /permission denied/);
    await assert.rejects(as(null, 'SELECT live_follow($1,$2,true)', [id(1), id(20)]), /permission denied/);

    // Follows: members only, own club only.
    assert.equal((await as(104, 'SELECT live_follow($1,$2,true) v', [id(1), id(20)]))[0].v, true);
    await as(102, 'SELECT live_follow($1,$2,true)', [id(1), id(20)]);
    await as(102, 'SELECT live_follow($1,$2,true)', [id(1), id(20)]);
    await assert.rejects(as(104, 'SELECT live_follow($1,$2,true)', [id(1), id(21)]), /ne peut plus/);
    await assert.rejects(as(106, 'SELECT live_follow($1,$2,true)', [id(1), id(20)]), /NOT_MEMBER/);
    assert.deepEqual((await as(104, 'SELECT live_my_follows($1) m', [id(1)])).map((r) => r.m), [id(20)]);

    // Start: announced once, to Live subscribers of the club except the starter.
    assert.equal((await as(103, 'SELECT live_push_announce_start($1,$2) n', [id(1), id(20)]))[0].n, 0, 'pending match');
    await score(103, `status='live',scored_by='${id(103)}',started_at=now()`);
    await assert.rejects(as(106, 'SELECT live_push_announce_start($1,$2)', [id(1), id(20)]), /membres de ce club/);
    assert.equal((await as(103, 'SELECT live_push_announce_start($1,$2) n', [id(1), id(20)]))[0].n, 1);
    assert.equal((await as(103, 'SELECT live_push_announce_start($1,$2) n', [id(1), id(20)]))[0].n, 0);
    let rows = await jobs(`d.dedupe_key='start'`);
    assert.deepEqual(rows.map((r) => r.user_id), [id(101)]);
    assert.equal(rows[0].title, 'Match en direct');
    assert.equal(rows[0].body, 'Alex Dupont - Sam Martin - Le match commence !', 'full names, no court');
    assert.equal(rows[0].url, `/matches/${id(20)}`);

    // Ordinary points notify nobody; a won set notifies followers once, even after a correction.
    await score(103, 'set1_j1=5,set1_j2=4');
    assert.equal((await jobs(`d.dedupe_key<>'start'`)).length, 0);
    await score(103, 'set1_j1=6,set1_j2=4');
    rows = await jobs(`d.dedupe_key='set1'`);
    assert.deepEqual(rows.map((r) => r.user_id).sort(), [id(102), id(104)]);
    assert.equal(rows[0].title, 'Fin du 1er set');
    assert.equal(rows[0].body, 'Dupont 6-4 Martin');
    await score(103, 'set1_j1=5,set1_j2=4');
    await score(103, 'set1_j1=6,set1_j2=4');
    assert.equal((await jobs(`d.dedupe_key='set1'`)).length, 2);

    // Feed: author excluded, bursts grouped while the alert is still waiting.
    await as(104, 'SELECT live_activity_command($1,$2,$3,$4)', [id(20), id(1), 'message', { id: randomUUID(), body: 'Beau jeu !' }]);
    rows = await jobs(`d.dedupe_key LIKE 'post:%'`);
    assert.deepEqual(rows.map((r) => r.user_id), [id(102)]);
    assert.equal(rows[0].body, 'Prénom Nom : Beau jeu !');
    await as(103, 'SELECT live_activity_command($1,$2,$3,$4)', [id(20), id(1), 'message', { id: randomUUID(), body: 'Allez !' }]);
    rows = await jobs(`d.dedupe_key LIKE 'post:%'`);
    assert.equal(rows.length, 2, 'one grouped alert for 102, a new one for 104');
    assert.equal(rows.find((r) => r.user_id === id(102)).body, '2 nouvelles publications dans le fil');

    // Unfollow stops alerts. Finishing in two sets sends only the finish alert, once.
    await as(104, 'SELECT live_follow($1,$2,false)', [id(1), id(20)]);
    await score(103, `set2_j1=7,set2_j2=5,status='finished',winner='j1',finished_at=now()`);
    assert.equal((await jobs(`d.dedupe_key='set2'`)).length, 0);
    rows = await jobs(`d.dedupe_key='finish'`);
    assert.deepEqual(rows.map((r) => r.user_id), [id(102)]);
    assert.equal(rows[0].body, 'Victoire de Dupont face à Martin : 6-4 7-5');
    await score(103, `status='live',winner=NULL,finished_at=NULL`);
    await score(103, `status='finished',winner='j1',finished_at=now()`);
    assert.equal((await jobs(`d.dedupe_key='finish'`)).length, 1);
    await assert.rejects(as(102, 'SELECT live_follow($1,$2,true)', [id(1), id(20)]), /ne peut plus/);

    // Courses honour the device preference.
    await subscribe(101, [false, true]);
    assert.equal((await db.query(`SELECT count(*)::int n FROM course_push_subscriptions WHERE notify_courses`)).rows[0].n, 2);

    // Claim: priority fields, tags, then leases.
    await db.exec('SET ROLE service_role');
    const claimed = (await db.query('SELECT * FROM live_push_claim(100)')).rows;
    await db.exec('RESET ROLE');
    assert.equal(claimed.length, (await jobs()).length);
    const post = claimed.find((r) => r.url && r.tag.startsWith('live-post-'));
    assert.equal(post.tag, `live-post-${id(20)}`);
    assert.equal(post.ttl, 600);
    assert.equal((await db.query('SELECT * FROM live_push_claim(100)')).rows.length, 0);

    // Removed member: follows and subscriptions disappear.
    await db.exec(`DELETE FROM club_members WHERE club_id='${id(1)}' AND user_id='${id(102)}'`);
    assert.equal((await db.query(`SELECT count(*)::int n FROM live_match_follows WHERE user_id='${id(102)}'`)).rows[0].n, 0);
  } finally {
    await db.close();
  }
});

test('live push: a failing wake-up call never breaks a score write', async () => {
  const { db, as, subscribe, jobs, score } = await setup();
  try {
    await db.exec(`CREATE SCHEMA net; CREATE SCHEMA vault;
      CREATE TABLE vault.decrypted_secrets(name text, decrypted_secret text);
      INSERT INTO vault.decrypted_secrets VALUES('course_push_project_url','https://example.supabase.co'),
        ('course_push_service_role_key','jwt'),('course_push_cron_secret','s');
      CREATE TABLE net.calls(url text, headers jsonb);
      CREATE FUNCTION net.http_post(url text, headers jsonb, body jsonb, timeout_milliseconds integer)
        RETURNS bigint LANGUAGE plpgsql AS $$ BEGIN
          IF EXISTS(SELECT 1 FROM net.calls c WHERE c.url='fail') THEN RAISE EXCEPTION 'boom'; END IF;
          INSERT INTO net.calls VALUES($1, $2); RETURN 1; END $$;`);
    await subscribe(101);
    await as(101, 'SELECT live_follow($1,$2,true)', [id(1), id(20)]);
    await score(103, `status='live',scored_by='${id(103)}',started_at=now()`);
    await score(103, 'set1_j1=6,set1_j2=0');
    const calls = (await db.query('SELECT * FROM net.calls')).rows;
    assert.equal(calls.length, 1);
    assert.equal(calls[0].url, 'https://example.supabase.co/functions/v1/course-push-dispatch');
    assert.equal(calls[0].headers['x-course-push-secret'], 's');
    await db.exec(`INSERT INTO net.calls VALUES('fail', null)`);
    assert.equal((await score(103, 'set2_j1=6,set2_j2=0'))[0].status, 'live');
    assert.equal((await jobs(`d.dedupe_key='set2'`)).length, 1);
  } finally {
    await db.close();
  }
});
