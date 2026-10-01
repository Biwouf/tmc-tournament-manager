import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { PGlite } from '@electric-sql/pglite';
import { coursesFixtureSQL, id } from './helpers/courses-fixture.mjs';
const migration = name => readFile(new URL(`../supabase/migrations/${name}.sql`,import.meta.url),'utf8');
test('free competition names preserve existing rows; Tenup prefill checks roles, tenant, season and rate', async () => {
 const db=new PGlite();
 try {
  await db.exec(coursesFixtureSQL);
  await db.exec(`CREATE TABLE live_matches(id uuid PRIMARY KEY);
   CREATE FUNCTION set_updated_at() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN NEW.updated_at=now(); RETURN NEW; END $$;`);
  await db.exec(await migration('20260606_team_matches'));
  const audit=await migration('20260905_audit_content_permissions');
  await db.exec(audit.match(/CREATE OR REPLACE FUNCTION public.can_manage_club_content[\s\S]*?\$\$;/)[0]);
  for(const table of ['team_saisons','team_competitions']) {
   await db.exec(`ALTER TABLE ${table} ADD COLUMN club_id uuid NOT NULL DEFAULT '${id(1)}';
    CREATE POLICY test_role ON ${table} AS RESTRICTIVE FOR ALL TO authenticated USING(can_manage_club_content(club_id)) WITH CHECK(can_manage_club_content(club_id));`);
  }
  await db.exec(`INSERT INTO team_saisons(id,label,club_id) VALUES('${id(10)}','2026','${id(1)}'),('${id(20)}','2026','${id(2)}');
   INSERT INTO team_competitions(id,saison_id,nom,type,genre,categorie,format) VALUES('${id(11)}','${id(10)}','GAN 35','adultes','hommes','35_ans','3S1D2');`);
  await db.exec(await migration('2026100101_admin_competitions'));
  assert.equal((await db.query('SELECT nom FROM team_competitions')).rows[0].nom,'GAN 35');
  async function as(user,sql,args=[]) {
   await db.exec(`BEGIN; SET LOCAL ROLE ${user===null?'anon':'authenticated'}; SELECT set_config('request.jwt.claim.sub','${user===null?'':id(user)}',true);`);
   try {const result=await db.query(sql,args);await db.exec('COMMIT');return result.rows;}
   catch(err){await db.exec('ROLLBACK');throw err;}
  }
  const url='https://tenup.fft.fr/championnat/82678463?division=144146&phase=233672&poule=513524';
  const begin=(user=101,club=id(1),season=id(10),source=url)=>as(user,'SELECT team_tenup_competition_begin($1,$2,$3) AS ok',[club,season,source]);
  const insert=(nom,source=null,season=id(10),club=id(1),user=101)=>as(user,`INSERT INTO team_competitions(saison_id,club_id,nom,type,genre,categorie,format,tenup_url) VALUES($1,$2,$3,'adultes','femmes','seniors','3S1D2',$4) RETURNING nom`,[season,club,nom,source]);
  assert.equal((await insert('Challenge Féminin Max Espiaut',url))[0].nom,'Challenge Féminin Max Espiaut');
  for(const name of ['', ' \t\n ', 'a'.repeat(161)]) await assert.rejects(insert(name),/check constraint/);
  await assert.rejects(insert('Championnat doublon',url.split('?')[0]),/unique constraint/);
  await insert('Même championnat autre club',url,id(20),id(2),106);
  await db.exec(`INSERT INTO team_saisons(id,label) VALUES('${id(12)}','2027')`);
  await insert('Même championnat autre saison',url,id(12));
  await assert.rejects(insert('Membre',null,id(10),id(1),103),/row-level security/);
  await assert.rejects(insert('Autre club',null,id(10),id(1),106),/row-level security/);
  assert.equal((await begin())[0].ok,true);
  assert.equal((await begin(102))[0].ok,true,'manager allowed');
  for(const user of [103,106,107]) await assert.rejects(begin(user),/Administration/);
  await assert.rejects(begin(null),/permission denied/);
  await assert.rejects(begin(101,id(1),id(20)),/Saison introuvable/);
  await assert.rejects(begin(101,id(1),id(10),'https://evil.test'),/invalide/);
  await assert.rejects(insert('Mauvais lien','https://evil.test'),/check constraint/);
  await assert.rejects(as(101,'SELECT * FROM team_tenup_competition_requests'),/permission denied/);
  await begin();await begin();await assert.rejects(begin(),/Trop de demandes/);
  await db.exec(`UPDATE clubs SET status='suspended' WHERE id='${id(1)}'`);
  await assert.rejects(begin(),/Administration/);
 } finally {await db.close();}
});
