import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { PGlite } from '@electric-sql/pglite';
import { id, coursesFixtureSQL } from './helpers/courses-fixture.mjs';

async function fixture() {
 const db = new PGlite();
 await db.exec(coursesFixtureSQL + `CREATE ROLE service_role; GRANT USAGE ON SCHEMA public TO service_role;
 ALTER TABLE auth.users ADD COLUMN email text, ADD COLUMN raw_user_meta_data jsonb DEFAULT '{}';`);
 for (const file of ['2026091001_courses.sql','2026091002_courses_pwa.sql','2026091101_course_owner_identity.sql',
  '2026091602_pwa_signup.sql','2026092001_signup_profile_fix.sql','202609250002_signup_email.sql']) {
  await db.exec(await readFile(new URL('../supabase/migrations/'+file,import.meta.url),'utf8'));
 }
 await db.exec(`UPDATE club_members SET role='admin' WHERE user_id='${id(105)}';`);
 const rpc = async (user, name, args) => {
  await db.exec(`BEGIN; SET LOCAL ROLE authenticated; SELECT set_config('request.jwt.claim.sub','${id(user)}',true);`);
  try { const result=await db.query(`SELECT ${name}(${args.map((_,i)=>'$'+(i+1)).join(',')})`,args); await db.exec('COMMIT'); return result; }
  catch(e) { await db.exec('ROLLBACK'); throw e; }
 };
 return {db, rpc,
  signup:()=>rpc(106,'course_signup_my_profile',[id(1),'Alice','Dupont','female',null,id(900)]),
  decide:(status)=>rpc(101,'club_signup_decide',[id(1),id(106),status]),
  jobs:async()=> (await db.query('SELECT * FROM signup_email_deliveries ORDER BY created_at,id')).rows};
}

test('signup emails: every club admin, isolated recipients, atomic queue and idempotent decisions',async()=>{
 const f=await fixture(); try {
  await f.db.query('UPDATE profiles SET prenom=$1,nom=$2 WHERE id=$3',['Alice','Dupont',id(106)]);
  await f.signup(); await f.signup();
  let jobs=await f.jobs();
  assert.deepEqual(jobs.map(j=>j.user_id).sort(),[id(101),id(105)]);
  assert.ok(jobs.every(j=>j.body.includes('Alice Dupont') && j.club_id===id(1)));
  await assert.rejects(f.rpc(102,'club_signup_decide',[id(1),id(106),'approved']),/FORBIDDEN/);
  assert.equal((await f.jobs()).length,2);
  await f.db.exec(`BEGIN; UPDATE club_signup_requests SET status='denied' WHERE user_id='${id(106)}'; ROLLBACK;`);
  assert.equal((await f.jobs()).length,2);
  await f.decide('approved'); await f.decide('approved');
  jobs=await f.jobs();
  assert.equal(jobs.length,3);
  const approval=jobs.find(j=>j.kind==='approved');
  assert.equal(approval.user_id,id(106)); assert.match(approval.body,/maintenant actif/);
  await f.db.exec(`DELETE FROM club_members WHERE club_id='${id(1)}' AND user_id='${id(106)}';`);
  assert.equal((await f.jobs()).length,3); // Revocation stays silent.
  assert.equal((await f.db.query('SELECT * FROM signup_email_claim()')).rows.length,0); // Stale decisions are not sent.
  for (const role of ['anon','authenticated']) {
   await f.db.exec('SET ROLE '+role);
   await assert.rejects(f.db.query('SELECT * FROM signup_email_deliveries'),/permission denied/);
   await assert.rejects(f.db.query('SELECT * FROM signup_email_claim()'),/permission denied/);
   await f.db.exec('RESET ROLE');
  }
 } finally {await f.db.close();}
});

test('signup emails: refused applicant needs no club membership; retries, leases and expiry',async()=>{
 const f=await fixture(); try {
  await f.signup(); await f.decide('denied'); await f.decide('denied');
  assert.equal((await f.jobs()).length,3);
  assert.equal((await f.db.query('SELECT * FROM club_members WHERE club_id=$1 AND user_id=$2',[id(1),id(106)])).rows.length,0);
  await f.db.exec('BEGIN; SET LOCAL ROLE service_role;');
  const first=(await f.db.query('SELECT * FROM signup_email_claim()')).rows;
  await f.db.exec('COMMIT');
  assert.equal(first.length,1); assert.equal(first[0].user_id,id(106));
  assert.match(first[0].title,/refusée/); assert.equal(first[0].attempts,1);
  assert.equal((await f.db.query('SELECT * FROM signup_email_claim()')).rows.length,0);
  await f.db.exec("UPDATE signup_email_deliveries SET lease_until=now()-interval '1 second' WHERE status='sending'");
  const second=(await f.db.query('SELECT * FROM signup_email_claim()')).rows[0];
  assert.equal(second.attempts,2); assert.notEqual(second.claim_token,first[0].claim_token);
  assert.equal((await f.db.query("UPDATE signup_email_deliveries SET status='sent' WHERE id=$1 AND claim_token=$2 RETURNING id",[first[0].id,first[0].claim_token])).rows.length,0);
  await f.db.exec("UPDATE signup_email_deliveries SET attempts=5,lease_until=now()-interval '1 second' WHERE status='sending'");
  assert.equal((await f.db.query('SELECT * FROM signup_email_claim()')).rows.length,0);
  assert.ok((await f.jobs()).every(j=>j.status==='failed'));
  await f.db.exec("UPDATE signup_email_deliveries SET status='pending',attempts=0,created_at=now()-interval '25 hours'");
  assert.equal((await f.db.query('SELECT * FROM signup_email_claim()')).rows.length,0);
 } finally {await f.db.close();}
});

test('signup emails: Auth signup, removed admin, inactive club, and invitations',async()=>{
 const f=await fixture(); try {
  await f.db.query('INSERT INTO auth.users(id,raw_user_meta_data) VALUES($1,$2)',[id(201),{club_signup:{club_id:id(1),prenom:'Camille',nom:'Martin',sex:'female'}}]);
  assert.equal((await f.jobs()).length,2);
  assert.ok((await f.jobs()).every(j=>j.body.includes('Camille Martin')));
  await f.db.query('INSERT INTO auth.users(id) VALUES($1)',[id(202)]);
  assert.equal((await f.jobs()).length,2);
  await f.db.exec(`UPDATE club_members SET role='member' WHERE user_id='${id(105)}';`);
  const claimed=(await f.db.query('SELECT * FROM signup_email_claim()')).rows;
  assert.equal(claimed.length,1); assert.equal(claimed[0].user_id,id(101));
  await f.db.exec(`UPDATE signup_email_deliveries SET status='pending'; UPDATE clubs SET status='suspended' WHERE id='${id(1)}';`);
  assert.equal((await f.db.query('SELECT * FROM signup_email_claim()')).rows.length,0);
 } finally {await f.db.close();}
});
