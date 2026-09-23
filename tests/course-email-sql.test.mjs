import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { PGlite } from '@electric-sql/pglite';
import { id, coursesFixtureSQL } from './helpers/courses-fixture.mjs';

async function as(db, user, sql, params = []) {
  await db.exec(`BEGIN; SET LOCAL ROLE authenticated;
    SELECT set_config('request.jwt.claim.sub','${id(user)}',true);`);
  try { const result = await db.query(sql, params); await db.exec('COMMIT'); return result; }
  catch (error) { await db.exec('ROLLBACK'); throw error; }
}

test('email recipients, idempotent commands, transaction rollback, permissions and retry leases', async () => {
 const db = new PGlite();
 try {
  await db.exec(coursesFixtureSQL + 'CREATE ROLE service_role; GRANT USAGE ON SCHEMA public TO service_role;');
  for (const name of ['2026091001_courses.sql','2026091002_courses_pwa.sql',
    '2026091101_course_owner_identity.sql','2026092301_course_email.sql',
    '2026092302_course_email_requester.sql']) {
    await db.exec(await readFile(new URL(`../supabase/migrations/${name}`, import.meta.url),'utf8'));
  }
  await db.exec(`INSERT INTO course_types(id,club_id,name) VALUES('${id(20)}','${id(1)}','Tennis');
    INSERT INTO courses(id,club_id,type_id,name,starts_at,duration_minutes,capacity_female,capacity_male,owner_id)
    VALUES('${id(30)}','${id(1)}','${id(20)}','Cours du mardi',now()+interval '1 day',60,4,4,'${id(102)}');
    INSERT INTO profile_details(user_id,sex) VALUES('${id(103)}','female'),('${id(104)}','male');`);
  await db.exec(`UPDATE profiles SET prenom='Camille',nom='Dupont' WHERE id='${id(103)}';
    UPDATE club_members SET role='admin' WHERE club_id='${id(1)}' AND user_id='${id(105)}';`);
  const request = (user, key) => as(db,user,'SELECT course_member_command($1,$2,$3,$4,$5) result',
    [id(1),id(30),'request',null,id(key)]);
  const decide = (registration,status,key) => as(db,102,'SELECT course_manage_command($1,$2,$3,$4)',
    [id(1),'set_status',{id:registration,revision:0,status,denial_reason:status==='denied'?'Complet':null},id(key)]);
  const jobs = async () => (await db.query('SELECT * FROM course_email_deliveries ORDER BY created_at,id')).rows;
  const first = (await request(103,500)).rows[0].result;
  await request(103,500);
  assert.equal((await jobs()).length,1);
  assert.equal((await jobs())[0].user_id,id(102));
  assert.match((await jobs())[0].body,/Camille Dupont a demandé une place/);
  assert.ok((await jobs()).every(j=>![id(101),id(105)].includes(j.user_id)));
  // Even without an owner, never fall back to notifying the club admins.
  await db.exec(`BEGIN; UPDATE courses SET owner_id=NULL WHERE id='${id(30)}';
    INSERT INTO course_registration_events(registration_id,club_id,to_status,source,quota_sex)
    VALUES('${first.id}','${id(1)}','pending','test','female');`);
  assert.equal((await jobs()).length,1);
  await db.exec('ROLLBACK');
  await decide(first.id,'approved',501);
  assert.equal((await jobs()).length,2);
  assert.equal((await jobs())[1].user_id,id(103));
  assert.match((await jobs())[1].title,/Place accordée/);
  const second = (await request(104,502)).rows[0].result;
  await decide(second.id,'denied',503);
  assert.equal((await jobs()).length,4);
  assert.equal((await jobs())[3].user_id,id(104));
  assert.match((await jobs())[3].title,/refusée/);
  assert.doesNotMatch((await jobs())[3].body,/Complet/);
  await assert.rejects(as(db,103,'SELECT * FROM course_email_deliveries'),/permission denied/);
  await assert.rejects(as(db,103,'SELECT * FROM course_email_claim()'),/permission denied/);
  await assert.rejects(as(db,106,'SELECT * FROM course_email_deliveries'),/permission denied/);
  // A rolled-back event cannot leave an email in the queue.
  await db.exec(`BEGIN; INSERT INTO course_registration_events(registration_id,club_id,to_status,source,quota_sex)
    VALUES('${first.id}','${id(1)}','pending','test','female'); ROLLBACK;`);
  assert.equal((await jobs()).length,4);
  await db.exec('BEGIN; SET LOCAL ROLE service_role;');
  const claimed = (await db.query('SELECT * FROM course_email_claim()')).rows;
  await db.exec('COMMIT');
  assert.equal(claimed.length,4);
  assert.ok(claimed.every(j=>j.claim_token && j.attempts===1));
  assert.equal((await db.query('SELECT * FROM course_email_claim()')).rows.length,0);
  // Crash recovery issues a fresh token, so the old worker cannot acknowledge it.
  await db.exec("UPDATE course_email_deliveries SET lease_until=now()-interval '1 second'");
  const reclaimed = (await db.query('SELECT * FROM course_email_claim()')).rows;
  assert.equal(reclaimed.length,4);
  assert.ok(reclaimed.every(j=>j.attempts===2));
  assert.notEqual(reclaimed.find(j=>j.id===claimed[0].id).claim_token,claimed[0].claim_token);
  const stale = await db.query("UPDATE course_email_deliveries SET status='sent' WHERE id=$1 AND claim_token=$2 RETURNING id",
    [claimed[0].id,claimed[0].claim_token]);
  assert.equal(stale.rows.length,0);
  await db.exec("UPDATE course_email_deliveries SET attempts=5,lease_until=now()-interval '1 second'");
  assert.equal((await db.query('SELECT * FROM course_email_claim()')).rows.length,0);
  assert.ok((await jobs()).every(j=>j.status==='failed'));
  // Removed recipients and suspended clubs are excluded, even for queued messages.
  await db.exec(`UPDATE course_email_deliveries SET status='pending',attempts=0;
    DELETE FROM club_members WHERE club_id='${id(1)}' AND user_id='${id(104)}';`);
  assert.equal((await db.query('SELECT * FROM course_email_claim()')).rows.length,3);
  await db.exec(`UPDATE course_email_deliveries SET status='pending'; UPDATE clubs SET status='suspended' WHERE id='${id(1)}';`);
  assert.equal((await db.query('SELECT * FROM course_email_claim()')).rows.length,0);
 } finally { await db.close(); }
});
