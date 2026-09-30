import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { PGlite } from '@electric-sql/pglite';
import { coursesFixtureSQL, id } from './helpers/courses-fixture.mjs';
const migration = async name => readFile(new URL(`../supabase/migrations/${name}.sql`, import.meta.url),'utf8');

test('Ten’Up import is atomic, tenant scoped, idempotent and preserves existing results', async () => {
 const db=new PGlite();
 try {
  await db.exec(coursesFixtureSQL);
  await db.exec(`CREATE TABLE events(id uuid PRIMARY KEY);
   CREATE FUNCTION set_updated_at() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN NEW.updated_at=now(); RETURN NEW; END $$;
   CREATE FUNCTION can_manage_club_content(cid uuid) RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER AS $$ SELECT EXISTS(SELECT 1 FROM club_members WHERE club_id=cid AND user_id=auth.uid() AND role IN ('admin','manager')) $$;`);
  await db.exec((await migration('20260423_live_matches')).replace('ALTER PUBLICATION supabase_realtime ADD TABLE live_matches;', ''));
  await db.exec(await migration('20260606_team_matches'));
  await db.exec(await migration('20260628_team_rencontres_wo'));
  const tables=['live_matches','team_saisons','team_competitions','team_equipes','team_etapes','team_rencontres','team_match_lines'];
  for (const table of tables) {
   await db.exec(`ALTER TABLE ${table} ADD COLUMN club_id uuid NOT NULL DEFAULT '${id(1)}';
    CREATE POLICY test_tenant ON ${table} AS RESTRICTIVE FOR ALL TO authenticated USING(club_id IN (SELECT club_id FROM club_members WHERE user_id=auth.uid())) WITH CHECK(club_id IN (SELECT club_id FROM club_members WHERE user_id=auth.uid()));
    GRANT SELECT ON ${table} TO anon;`);
   if(table!=='team_match_lines') await db.exec(`CREATE POLICY test_read ON ${table} FOR SELECT TO anon USING(true);`);
  }
  await db.exec(`GRANT SELECT ON club_members TO authenticated;
   GRANT SELECT,INSERT,UPDATE,DELETE ON live_matches TO authenticated;
   ALTER TABLE live_matches ADD COLUMN court text,ADD COLUMN started_at timestamptz,ADD COLUMN retired_player live_match_winner;
   CREATE POLICY test_line_insert ON team_match_lines AS RESTRICTIVE FOR INSERT TO authenticated WITH CHECK(can_manage_club_content(club_id));
   CREATE POLICY test_line_update ON team_match_lines AS RESTRICTIVE FOR UPDATE TO authenticated USING(can_manage_club_content(club_id)) WITH CHECK(can_manage_club_content(club_id));
   CREATE POLICY test_line_delete ON team_match_lines AS RESTRICTIVE FOR DELETE TO authenticated USING(can_manage_club_content(club_id));
   INSERT INTO team_saisons(id,label) VALUES('${id(10)}','2026');
   INSERT INTO team_competitions(id,saison_id,nom,type,genre,categorie,format) VALUES('${id(11)}','${id(10)}','Interclubs','adultes','hommes','seniors','3S1D2');
   INSERT INTO team_equipes(id,competition_id,division,nb_journees_poule) VALUES('${id(12)}','${id(11)}','R1A',2);
   INSERT INTO team_etapes(id,equipe_id,phase,numero_journee) VALUES('${id(13)}','${id(12)}','poule',1);
   INSERT INTO team_rencontres(id,etape_id,club_adverse,date_heure,domicile) VALUES('${id(14)}','${id(13)}','Adversaires','2026-09-23 09:00+02',true);`);
  await db.exec(await migration('20260907_live_match_consistency'));
  await db.exec(await migration('2026092101_team_scoring_rules'));
  await db.exec(await migration('2026092401_team_match_commands'));
  await db.exec(await migration('2026092601_team_format_3s1d'));
  assert.deepEqual((await db.query("SELECT team_format_spec('3S1D') AS spec")).rows[0].spec,[3,1,1]);
  await db.exec(`UPDATE team_competitions SET format='3S1D' WHERE id='${id(11)}';
    UPDATE team_competitions SET format='3S1D2' WHERE id='${id(11)}';`);
  await db.exec(`UPDATE team_competitions SET singles_set3_format='super_tiebreak' WHERE id='${id(11)}'`);
  async function as(user,sql,args=[]) {
   await db.exec(`BEGIN; SET LOCAL ROLE ${user===null?'anon':'authenticated'}; SELECT set_config('request.jwt.claim.sub','${user===null?'':id(user)}',true);`);
   try { const r=await db.query(sql,args);await db.exec('COMMIT');return r.rows; }
   catch(e){await db.exec('ROLLBACK');throw e;}
  }

  await db.exec('CREATE ROLE service_role');
  await db.exec(await migration('2026092901_tenup_sync'));
  await db.exec(`UPDATE team_competitions SET format='3S1D' WHERE id='${id(11)}'`);
  const url='https://tenup.fft.fr/championnat/1/division/2/phase/3/poule/4/rencontre/5';
  const begin=(source=url,user=103,club=id(1))=>as(user,'SELECT team_tenup_begin($1,$2,$3) AS value',[club,id(14),source]).then(r=>r[0].value.id);
  const apply=(pid,side=0,user=103)=>as(user,'SELECT team_tenup_apply($1,$2) AS value',[pid,side]).then(r=>r[0].value);
  const a=[{prenom:'Alice',nom:'Club',classement:'30'}], b=[{prenom:'Bob',nom:'Adverse',classement:'30/1'}];
  const sheet={date:'2026-09-23',teams:['Club 1','Adversaires'],scores:[4,0],lines:[1,2,3].map(slot=>({match_type:'simple',slot,players_a:a,players_b:b,sets:[{a:6,b:2},{a:6,b:3}]}))};
  sheet.lines.push({match_type:'double',slot:1,players_a:[...a,...a],players_b:[...b,...b],sets:[{a:6,b:1},{a:6,b:0}]});
  const attach=(pid,payload=sheet)=>db.query('UPDATE team_tenup_previews SET payload=$1 WHERE id=$2',[payload,pid]);
  const resetRate=()=>db.exec("UPDATE team_tenup_previews SET created_at=now()-interval '2 minutes'");
  await assert.rejects(begin(url,106),/Accès membre/);
  await assert.rejects(begin(url,null),/permission denied/);
  await assert.rejects(begin(url,107,id(3)),/Accès membre/);
  await assert.rejects(begin('https://evil.example/'),/invalide/);
  let pid=await begin();
  await assert.rejects(apply(pid),/indisponible/);
  await assert.rejects(apply(pid,0,104),/introuvable/);
  await assert.rejects(as(103,'UPDATE team_tenup_previews SET payload=$1 WHERE id=$2',[sheet,pid]),/permission denied/);
  await attach(pid,{...sheet,scores:[3,1]});
  await assert.rejects(apply(pid),/total Ten’Up/);
  assert.equal((await db.query('SELECT count(*)::int AS n FROM team_match_lines')).rows[0].n,0,'all inserts rolled back when the total differs');
  await attach(pid,{...sheet,date:'2026-09-22'});
  await assert.rejects(apply(pid),/date Ten’Up/);
  await attach(pid,{...sheet,lines:sheet.lines.slice(0,3)});
  await assert.rejects(apply(pid),/format Ten’Up/);
  const broken=structuredClone(sheet);broken.lines[3].sets=[{a:6,b:5}];
  await attach(pid,broken);
  await assert.rejects(apply(pid),/score Ten’Up/);
  assert.equal((await db.query('SELECT count(*)::int AS n FROM team_match_lines')).rows[0].n,0);
  await attach(pid);
  const result=await apply(pid);
  assert.deepEqual(result,{imported:4,preserved:0,notes:[],confirmed:true});
  assert.deepEqual(await apply(pid),result,'same preview retry is a no-op');
  await assert.rejects(apply(pid,1),/autre équipe/);
  let r=(await db.query('SELECT * FROM team_rencontres')).rows[0];
  assert.equal(r.score_club,4);assert.equal(r.score_adverse,0);assert.ok(r.confirmed_at);assert.ok(r.tenup_synced_at);assert.equal(r.tenup_url,url);
  await assert.rejects(as(101,'UPDATE team_rencontres SET tenup_url=NULL WHERE id=$1',[id(14)]),/source/);
  const history=(await db.query('SELECT count(*)::int AS n FROM team_match_history')).rows[0].n;
  pid=await begin();await attach(pid);
  assert.equal((await apply(pid)).preserved,4);
  assert.equal((await db.query('SELECT count(*)::int AS n FROM team_match_history')).rows[0].n,history,'a new import never rewrites existing results');
  await assert.rejects(begin(url.replace('/5','/6')),/autre lien/);
  pid=await begin();await attach(pid);
  await db.exec(`UPDATE team_rencontres SET club_adverse='Autre' WHERE id='${id(14)}'`);
  await assert.rejects(apply(pid),/changé/);
  await assert.rejects(begin(),/Trop de demandes/);
  await resetRate();
  pid=await begin();await attach(pid);
  await db.exec(`UPDATE clubs SET status='suspended' WHERE id='${id(1)}'`);
  await assert.rejects(apply(pid),/Accès membre/);
  await db.exec(`UPDATE clubs SET status='active' WHERE id='${id(1)}'`);
  await db.query("UPDATE team_tenup_previews SET expires_at=now()-interval '1 minute' WHERE id=$1",[pid]);
  await assert.rejects(apply(pid),/expiré/);
  // Reversed home/away and partial follow-up: free matching composition receives
  // its score; a different composition and linked live are never overwritten.
  await db.exec('DELETE FROM team_match_lines; DELETE FROM team_tenup_previews');
  await db.exec(`UPDATE team_rencontres SET tenup_url=NULL,tenup_side=NULL WHERE id='${id(14)}'`);
  const create=async(slot,players=b)=>(await as(103,'SELECT team_match_command($1,$2,$3,$4,$5) AS value',[id(1),id(14),'create',{match_type:'simple',slot,joueurs_club:players,joueurs_adverse:a},randomUUID()]))[0].value;
  const first=await create(1);
  await create(2,[{prenom:'Different',nom:'Joueur',classement:'NC'}]);
  const third=await create(3);
  await as(103,'SELECT team_match_command($1,$2,$3,$4,$5)',[id(1),id(14),'start_live',{id:third.id,revision:0},randomUUID()]);
  pid=await begin();await attach(pid);
  const partial=await apply(pid,1);
  assert.equal(partial.imported,2);assert.equal(partial.preserved,2);assert.equal(partial.confirmed,false);
  assert.equal((await db.query('SELECT score FROM team_match_lines WHERE id=$1',[first.id])).rows[0].score,'2-6 3-6');
  assert.equal((await db.query('SELECT status FROM live_matches')).rows[0].status,'live');
  r=(await db.query('SELECT * FROM team_rencontres')).rows[0];assert.equal(r.confirmed_at,null);
  // Global scores entered without detailed lines are also protected.
  await db.exec('DELETE FROM team_match_lines');
  await db.exec(`UPDATE team_rencontres SET tenup_url=NULL,tenup_side=NULL,score_club=2,score_adverse=2 WHERE id='${id(14)}'`);
  await resetRate();pid=await begin();await attach(pid);
  await assert.rejects(apply(pid),/score global différent/);
  assert.equal((await db.query('SELECT count(*)::int AS n FROM team_match_lines')).rows[0].n,0);
  await db.exec(`UPDATE team_rencontres SET tenup_url='${url}',tenup_side=1 WHERE id='${id(14)}'`);
  // A duplicate association within one club is refused.
  await db.exec(`INSERT INTO team_etapes(id,equipe_id,phase,numero_journee) VALUES('${id(16)}','${id(12)}','poule',2); INSERT INTO team_rencontres(id,etape_id,club_adverse,date_heure,domicile) VALUES('${id(15)}','${id(16)}','X','2026-09-23',true)`);
  await assert.rejects(as(103,'SELECT team_tenup_begin($1,$2,$3)',[id(1),id(15),url]),/autre rencontre/);
 } finally { await db.close(); }
});
