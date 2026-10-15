import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { PGlite } from '@electric-sql/pglite';
import { id, coursesFixtureSQL } from './helpers/courses-fixture.mjs';

const migrations = await Promise.all([
  '2026091001_courses.sql',
  '2026091002_courses_pwa.sql',
  '2026091101_course_owner_identity.sql',
  '2026092301_course_email.sql',
  '2026092302_course_email_requester.sql',
  '2026092303_course_email_denial_reason.sql',
  '2026092402_course_web_push.sql',
].map((name) => readFile(new URL(`../supabase/migrations/${name}`, import.meta.url), 'utf8')));

async function as(db, user, sql, params = []) {
  await db.exec(`BEGIN; SET LOCAL ROLE authenticated;
    SELECT set_config('request.jwt.claim.sub','${id(user)}',true);`);
  try {
    const result = await db.query(sql, params);
    await db.exec('COMMIT');
    return result;
  } catch (error) {
    await db.exec('ROLLBACK');
    throw error;
  }
}

test('course push: only opted-in owner and requesting member receive their events', async () => {
  const db = new PGlite();
  try {
    await db.exec(coursesFixtureSQL + 'CREATE ROLE service_role; GRANT USAGE ON SCHEMA public TO service_role;');
    for (const migration of migrations) await db.exec(migration);
    await db.exec(`INSERT INTO course_types(id,club_id,name)
      VALUES('${id(20)}','${id(1)}','Tennis');
      INSERT INTO courses(id,club_id,type_id,name,starts_at,duration_minutes,
        capacity_female,capacity_male,owner_id)
      VALUES('${id(30)}','${id(1)}','${id(20)}','Cours du mardi',now()+interval '1 day',60,4,4,'${id(102)}');
      INSERT INTO profile_details(user_id,sex) VALUES
        ('${id(103)}','female'),('${id(104)}','male');`);
    const subscribe = (user, suffix) => as(db, user,
      'SELECT course_push_subscribe($1,$2,$3,$4)',
      [id(1), `https://fcm.googleapis.com/fcm/send/${suffix}`, 'p'.repeat(40), 'a'.repeat(20)]);
    await subscribe(102, 'manager');
    await subscribe(103, 'member');
    await subscribe(104, 'other');
    await assert.rejects(subscribe(106, 'outside-club'), /NOT_MEMBER/);
    await assert.rejects(as(db, 103, 'SELECT * FROM course_push_subscriptions'), /permission denied/);
    await assert.rejects(as(db, 103, 'SELECT * FROM course_push_deliveries'), /permission denied/);

    const request = () => as(db, 103,
      'SELECT course_member_command($1,$2,$3,$4,$5) result',
      [id(1), id(30), 'request', null, id(500)]);
    const result = (await request()).rows[0].result;
    assert.deepEqual((await request()).rows[0].result, result);
    let jobs = (await db.query(`SELECT s.user_id,d.title,d.url FROM course_push_deliveries d
      JOIN course_push_subscriptions s ON s.id=d.subscription_id`)).rows;
    assert.equal(jobs.length, 1);
    assert.equal(jobs[0].user_id, id(102));
    assert.match(jobs[0].url, /view=manage/);

    await as(db, 102, 'SELECT course_manage_command($1,$2,$3,$4)',
      [id(1), 'set_status', { id: result.id, revision: 0, status: 'approved' }, id(501)]);
    jobs = (await db.query(`SELECT s.user_id,d.title,d.url FROM course_push_deliveries d
      JOIN course_push_subscriptions s ON s.id=d.subscription_id ORDER BY d.created_at,d.id`)).rows;
    assert.equal(jobs.length, 2);
    assert.equal(jobs[1].user_id, id(103));
    assert.match(jobs[1].title, /approuvée/);
    assert.match(jobs[1].url, /view=mine/);

    const refused = (await as(db, 104,
      'SELECT course_member_command($1,$2,$3,$4,$5) result',
      [id(1), id(30), 'request', null, id(502)])).rows[0].result;
    await as(db, 102, 'SELECT course_manage_command($1,$2,$3,$4)',
      [id(1), 'set_status', {
        id: refused.id, revision: 0, status: 'denied', denial_reason: 'Complet',
      }, id(503)]);
    const denial = (await db.query(`SELECT d.title,d.body,s.user_id
      FROM course_push_deliveries d JOIN course_push_subscriptions s ON s.id=d.subscription_id
      WHERE s.user_id=$1 ORDER BY d.created_at DESC LIMIT 1`, [id(104)])).rows[0];
    assert.equal(denial.user_id, id(104));
    assert.match(denial.title, /refusée/);
    assert.doesNotMatch(denial.body, /Complet/);

    assert.equal((await db.query('SELECT count(*)::int n FROM course_email_deliveries')).rows[0].n, 4);
    // A rollback leaves neither an email nor a push queued.
    await db.exec('BEGIN');
    await db.query(`INSERT INTO course_registration_events(registration_id,club_id,from_status,to_status,source,quota_sex)
      VALUES($1,$2,'pending','approved','test','female')`, [result.id,id(1)]);
    await db.exec('ROLLBACK');
    assert.equal((await db.query('SELECT count(*)::int n FROM course_push_deliveries')).rows[0].n, 4);
    await assert.rejects(as(db,103,'SELECT * FROM course_push_claim()'),/permission denied/);

    // Moving a browser endpoint to another account must discard its old queued alerts.
    await subscribe(103, 'manager');
    assert.equal((await db.query('SELECT count(*)::int n FROM course_push_deliveries')).rows[0].n, 2);

    await db.exec('BEGIN; SET LOCAL ROLE service_role;');
    const claimed = await db.query('SELECT * FROM course_push_claim(30)');
    await db.exec('COMMIT');
    assert.equal(claimed.rows.length, 2);
    assert.ok(claimed.rows.every((job) => job.claim_token && job.attempts === 1));
    assert.equal((await db.query('SELECT * FROM course_push_claim(10)')).rows.length,0);
    await db.exec("UPDATE course_push_deliveries SET lease_until=now()-interval '1 second'");
    const retried=(await db.query('SELECT * FROM course_push_claim(10)')).rows;
    assert.equal(retried.length,2);
    assert.ok(retried.every(job=>job.attempts===2 &&
      claimed.rows.find(old=>old.id===job.id).claim_token!==job.claim_token));
    await db.exec("UPDATE course_push_deliveries SET attempts=5,lease_until=now()-interval '1 second'");
    assert.equal((await db.query('SELECT * FROM course_push_claim(10)')).rows.length,0);
    assert.equal((await db.query("SELECT count(*)::int n FROM course_push_deliveries WHERE status='failed'")).rows[0].n,2);
    await db.exec("UPDATE course_push_deliveries SET status='pending',attempts=0,created_at=now()-interval '25 hours'");
    assert.equal((await db.query('SELECT * FROM course_push_claim(10)')).rows.length,0);
    assert.equal((await db.query("SELECT count(*)::int n FROM course_push_deliveries WHERE status='failed'")).rows[0].n,2);
    await db.exec("UPDATE course_push_deliveries SET status='pending',created_at=now(); UPDATE clubs SET status='suspended'");
    assert.equal((await db.query('SELECT * FROM course_push_claim(10)')).rows.length,0);
    await db.query('DELETE FROM club_members WHERE club_id=$1 AND user_id=$2',[id(1),id(103)]);
    assert.equal((await db.query('SELECT count(*)::int n FROM course_push_subscriptions WHERE user_id=$1',[id(103)])).rows[0].n,0);
  } finally {
    await db.close();
  }
});
