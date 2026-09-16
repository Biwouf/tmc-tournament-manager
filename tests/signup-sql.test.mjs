import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { PGlite } from '@electric-sql/pglite';
import { id, coursesFixtureSQL } from './helpers/courses-fixture.mjs';
async function fixture() {
 const db = new PGlite();
 await db.exec(coursesFixtureSQL);
 await db.exec("ALTER TABLE auth.users ADD COLUMN email text, ADD COLUMN raw_user_meta_data jsonb DEFAULT '{}';");
 for (const file of ['2026091001_courses.sql','2026091002_courses_pwa.sql','2026091101_course_owner_identity.sql','2026091602_pwa_signup.sql']) await db.exec(await readFile(new URL('../supabase/migrations/'+file,import.meta.url),'utf8'));
 let serial=9000;
 async function rpc(user,name,args) {
  await db.exec(`BEGIN; SET LOCAL ROLE ${user ? 'authenticated' : 'anon'}; SELECT set_config('request.jwt.claim.sub','${user ? id(user) : ''}',true);`);
  try { const result=await db.query(`SELECT ${name}(${args.map((_,i)=>'$'+(i+1)).join(',')}) result`,args);await db.exec('COMMIT');return result.rows[0].result; }
  catch(e) {await db.exec('ROLLBACK');throw e;}
 }
 const signup=(user=106, club=1, rank='3/6', key=id(serial++))=>rpc(user,'course_signup_my_profile',[id(club),'  Alice ',' Dupont ','female',rank,key]);
 const decide=(user=101,target=106,status='approved',club=1)=>rpc(user,'club_signup_decide',[id(club),id(target),status]);
 const context=(user=106)=>rpc(user,'course_my_context',[id(1)]);
 return {db,rpc,signup,decide,context};
}
test('signup: pending has no rights; only club admin accepts as member; retry and revocation never restore access',async()=>{
 const f=await fixture();try {
  const key=id(9999);
  assert.equal((await f.signup(106,1,'3/6',key)).status,'pending');
  assert.equal((await f.context()).is_member,false);
  assert.equal((await f.context()).signup_status,'pending');
  assert.equal((await f.signup(106,1,'3/6',key)).status,'pending');
  await assert.rejects(f.signup(106,1,'4/6',key),/VALIDATION_ERROR/);
  await assert.rejects(f.rpc(106,'course_save_my_profile',[id(1),'A','B','female',0,id(9990)]),/FORBIDDEN/);
  for(const user of [null,102,103,106]) {
   await assert.rejects(f.decide(user),/FORBIDDEN|permission denied/);
   await assert.rejects(f.rpc(user,'club_signup_admin_list',[id(1)]),/FORBIDDEN|permission denied/);
  }
  assert.equal((await f.rpc(101,'club_signup_admin_list',[id(1)])).length,1);
  await f.decide(); await f.decide();
  assert.equal((await f.context()).is_member,true);
  assert.equal((await f.db.query('SELECT role FROM club_members WHERE club_id=$1 AND user_id=$2',[id(1),id(106)])).rows[0].role,'member');
  await f.db.query('DELETE FROM club_members WHERE club_id=$1 AND user_id=$2',[id(1),id(106)]);
  assert.equal((await f.context()).is_member,false);
  assert.equal((await f.signup(106,1,'3/6',key)).status,'revoked');
  assert.equal((await f.signup()).status,'revoked');
  await assert.rejects(f.decide(),/INVALID_TRANSITION/);
  assert.equal((await f.context()).is_member,false);
 } finally {await f.db.close();}
});
test('signup: atomic Auth profile, metadata cannot elevate privileges, invalid/suspended rollback, invitations unchanged',async()=>{
 const f=await fixture();try {
  const data={club_signup:{club_id:id(1),prenom:' Alice ',nom:' Dupont ',sex:'female',classement:'-15',role:'admin'},is_super_admin:true};
  await f.db.query('INSERT INTO auth.users(id,email,raw_user_meta_data) VALUES($1,$2,$3)',[id(201),'alice@example.test',data]);
  const ctx=await f.context(201);
  assert.equal(ctx.is_member,false);assert.equal(ctx.profile.prenom,'Alice');assert.equal(ctx.profile.classement,'-15');
  assert.equal((await f.db.query('SELECT is_super_admin FROM profiles WHERE id=$1',[id(201)])).rows[0].is_super_admin,false);
  for(const patch of [{club_id:id(3)},{classement:'invalid'},{prenom:' '},{sex:'other'}]) {
   await assert.rejects(f.db.query('INSERT INTO auth.users(id,raw_user_meta_data) VALUES($1,$2)',[id(202),{club_signup:{...data.club_signup,...patch}}]),/CLUB_UNAVAILABLE|VALIDATION_ERROR/);
   assert.equal((await f.db.query('SELECT * FROM auth.users WHERE id=$1',[id(202)])).rows.length,0);
  }
  await f.db.query('INSERT INTO auth.users(id) VALUES($1)',[id(203)]);
  assert.equal((await f.db.query('SELECT * FROM club_signup_requests WHERE user_id=$1',[id(203)])).rows.length,0);
  await assert.rejects(f.signup(106,3),/CLUB_UNAVAILABLE/);
  await assert.rejects(f.signup(106,1,'INVALID'),/VALIDATION_ERROR/);
  await assert.rejects(f.signup(null),/permission denied/);
  for(const name of ['signup_profile_internal','signup_auth_created','signup_member_removed']) assert.equal((await f.db.query("SELECT bool_or(has_function_privilege('authenticated',oid,'EXECUTE')) allowed FROM pg_proc WHERE proname=$1",[name])).rows[0].allowed,false);
  await f.db.exec('SET ROLE authenticated');
  await assert.rejects(f.db.query('SELECT * FROM club_signup_requests'),/permission denied/);
  await f.db.exec('RESET ROLE');
 }finally{await f.db.close();}
});
test('signup: refusal, tenant isolation and ranking edit compatibility',async()=>{
 const f=await fixture();try {
  await f.signup(); await f.decide(101,106,'denied');
  assert.equal((await f.signup()).status,'denied');
  await assert.rejects(f.decide(),/INVALID_TRANSITION/);
  assert.equal((await f.rpc(106,'club_signup_admin_list',[id(2)])).length,0);
  await f.rpc(103,'course_save_my_profile',[id(1),'Marie','Test','female',0,id(9900),'3/6']);
  let profile=(await f.context(103)).profile;assert.equal(profile.classement,'3/6');
  await f.rpc(103,'course_save_my_profile',[id(1),'Marie','Test','female',1,id(9901)]);
  assert.equal((await f.context(103)).profile.classement,'3/6');
  await assert.rejects(f.rpc(103,'course_save_my_profile',[id(1),'Marie','Test','female',2,id(9902),'invalid']),/check constraint/);
  assert.equal((await f.context(103)).profile.revision,2);
  await f.rpc(103,'course_save_my_profile',[id(1),'Marie','Test','female',2,id(9903),null]);
  assert.equal((await f.context(103)).profile.classement,null);
 }finally{await f.db.close();}
});
