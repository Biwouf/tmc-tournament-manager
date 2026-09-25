import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { PGlite } from '@electric-sql/pglite';
import { coursesFixtureSQL, id } from './helpers/courses-fixture.mjs';
const migration = async name => readFile(new URL(`../supabase/migrations/${name}.sql`, import.meta.url),'utf8');

test('Team commands: rules flow to Live, results, slots, WO, concurrency, membership and confirmation', async () => {
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
  await db.exec(`UPDATE team_competitions SET singles_set3_format='super_tiebreak' WHERE id='${id(11)}'`);
  async function as(user,sql,args=[]) {
   await db.exec(`BEGIN; SET LOCAL ROLE ${user===null?'anon':'authenticated'}; SELECT set_config('request.jwt.claim.sub','${user===null?'':id(user)}',true);`);
   try { const r=await db.query(sql,args);await db.exec('COMMIT');return r.rows; }
   catch(e){await db.exec('ROLLBACK');throw e;}
  }
  await db.exec(await migration('202609250001_team_member_search_fix'));
  await db.exec(`UPDATE profiles SET prenom='David',nom='Paoletti' WHERE id='${id(103)}'`);
  const search=async (query,user=103,club=id(1))=>(await as(user,'SELECT team_member_search($1,$2) AS results',[club,query]))[0].results;
  assert.deepEqual(await search('dav'),[{id:id(103),prenom:'David',nom:'Paoletti'}]);
  assert.deepEqual(await search('Paoletti'),await search('DAVID'));
  assert.deepEqual(await search('d'),[]);
  assert.deepEqual(await search('Absent'),[]);
  await assert.rejects(search('David',106),/Accès membre/);
  await assert.rejects(search('David',null),/permission denied/);
  assert.deepEqual(await search('David',106,id(2)),[],'no results from another club');
  const command=(op,data,user=103,key=randomUUID(),club=id(1))=>as(user,'SELECT team_match_command($1,$2,$3,$4,$5) AS result',[club,id(14),op,data,key]).then(rows=>rows[0].result);
  const line=async lid=>(await db.query('SELECT * FROM team_match_lines WHERE id=$1',[lid])).rows[0];
  const live=async mid=>(await db.query('SELECT * FROM live_matches WHERE id=$1',[mid])).rows[0];
  const revision=async()=>(await db.query('SELECT revision FROM team_rencontres WHERE id=$1',[id(14)])).rows[0].revision;
  const joueurs=[{prenom:'Camille',nom:'Club',classement:'NC',member_id:id(103)}];
  const createData={match_type:'simple',slot:1,joueurs_club:joueurs,joueurs_adverse:[{prenom:'Alex',nom:'Adverse',classement:'30'}]};
  await assert.rejects(command('create',createData,106),/Accès membre/);
  await assert.rejects(command('create',createData,107,randomUUID(),id(3)),/Accès membre/);
  await assert.rejects(command('create',createData,null),/permission denied/);
  await assert.rejects(as(103,`INSERT INTO team_match_lines(rencontre_id,club_id,match_type) VALUES('${id(14)}','${id(1)}','double')`),/row-level security/);
  const request=randomUUID();const first=await command('create',createData,103,request);
  assert.deepEqual(await command('create',createData,103,request),first,'network retries do not duplicate matches');
  await assert.rejects(command('create',{...createData,slot:2},103,request),/déjà utilisé/);
  await assert.rejects(command('create',createData),/unique/);
  await assert.rejects(command('create',{...createData,slot:4}),/place/);
  assert.equal((await line(first.id)).set3_format,'super_tiebreak');
  assert.equal((await as(null,'SELECT count(*)::int AS n FROM team_match_lines'))[0].n,1,'spectators see match lines');
  assert.equal((await as(103,'SELECT count(*)::int AS n FROM team_match_lines'))[0].n,1,'members can read the public detail while writes use the command');
  assert.equal((await as(106,'SELECT count(*)::int AS n FROM team_match_lines'))[0].n,0,'authenticated users remain within their clubs');
  const started=await command('start_live',{id:first.id,revision:0});
  let m=await live(started.live_match_id);
  assert.equal(m.set3_format,'super_tiebreak');assert.equal(m.status,'live');assert.equal(m.scored_by,id(103));
  assert.equal(m.team_rencontre_id,id(14));
  await assert.rejects(as(103,"UPDATE live_matches SET set3_format='normal' WHERE id=$1",[m.id]),/format est fixé/);
  const secondStart=await command('start_live',{id:first.id,revision:(await line(first.id)).revision,live_revision:m.revision},104);
  assert.equal(secondStart.live_match_id,m.id);assert.equal((await live(m.id)).scored_by,id(103),'opening does not steal ownership');
  const sets=[{club:6,adverse:4},{club:3,adverse:6},{club:10,adverse:8}];
  const scoreData={id:first.id,revision:(await line(first.id)).revision,live_revision:m.revision,kind:'normal',sets};
  await assert.rejects(command('result',scoreData,104),/reprise/);
  await assert.rejects(command('result',{...scoreData,sets:[{club:6,adverse:6},{club:6,adverse:2}]}),/incomplet/);
  await command('result',scoreData);
  let l=await line(first.id);m=await live(m.id);
  assert.equal(l.gagnant,'club');assert.equal(l.score,'6-4 3-6 10-8');assert.ok(l.confirmed_at);
  assert.equal(m.set3_j1,10);assert.equal(m.winner,'j1');assert.equal(m.team_result_confirmed,true);
  await assert.rejects(command('result',scoreData),/changé/);
  await assert.rejects(command('confirm',{revision:await revision()}),/Tous les matchs/);
  for(const slot of [2,3]) {
   const created=await command('create',{...createData,slot});
   await command('result',{id:created.id,revision:0,kind:'wo',winner:'adverse',sets:[]});
  }
  const doubles=await command('create',{...createData,slot:1,match_type:'double',joueurs_club:[...joueurs,...joueurs],joueurs_adverse:[...createData.joueurs_adverse,...createData.joueurs_adverse]});
  assert.equal((await line(doubles.id)).set3_format,'super_tiebreak');
  await command('result',{id:doubles.id,revision:0,kind:'normal',sets:[{club:6,adverse:1},{club:6,adverse:0}]});
  await assert.rejects(command('confirm',{revision:0}),/changé/);
  await command('confirm',{revision:await revision()},104);
  let encounter=(await db.query('SELECT * FROM team_rencontres WHERE id=$1',[id(14)])).rows[0];
  assert.equal(encounter.score_club,3);assert.equal(encounter.score_adverse,2);assert.ok(encounter.confirmed_at);
  await as(104,'UPDATE live_matches SET scored_by=$1 WHERE id=$2',[id(104),m.id]);
  assert.ok((await db.query('SELECT confirmed_at FROM team_rencontres WHERE id=$1',[id(14)])).rows[0].confirmed_at,'takeover alone does not invalidate score');
  await as(104,"UPDATE live_matches SET status='live',winner=NULL,finished_at=NULL WHERE id=$1",[m.id]);
  encounter=(await db.query('SELECT * FROM team_rencontres WHERE id=$1',[id(14)])).rows[0];
  assert.equal(encounter.confirmed_at,null);assert.equal((await line(first.id)).gagnant,null);
  assert.equal((await live(m.id)).team_result_confirmed,false);
  await assert.rejects(as(103,'UPDATE live_matches SET set1_j1=5 WHERE id=$1',[m.id]),/autre utilisateur/);
  await assert.rejects(as(104,'DELETE FROM live_matches WHERE id=$1',[m.id]),/lié à une rencontre/);
  l=await line(first.id);m=await live(m.id);
  await assert.rejects(command('result',{id:l.id,revision:l.revision,live_revision:m.revision-1,kind:'retired',winner:'adverse',sets:[]},104),/live a changé/);
  await assert.rejects(command('result',{id:l.id,revision:l.revision,live_revision:m.revision,kind:'retired',winner:'adverse',sets:[{club:7,adverse:7}]},104),/impossible/);
  await command('result',{id:l.id,revision:l.revision,live_revision:m.revision,kind:'retired',winner:'adverse',sets:[{club:6,adverse:6,tb_club:3,tb_adverse:2}]},104);
  assert.equal((await line(l.id)).result_kind,'retired');
  assert.equal((await live(m.id)).retired_player,'j1');
  assert.ok((await db.query('SELECT count(*)::int n FROM team_match_history')).rows[0].n>0,'all line changes leave a history');
  // A corrected direct 7-6 score can be loaded into a live without inventing tie-break points.
  l=await line(doubles.id);
  await command('result',{id:l.id,revision:l.revision,kind:'normal',sets:[{club:7,adverse:6},{club:6,adverse:4}]});
  l=await line(doubles.id);
  const doubleLive=await command('start_live',{id:l.id,revision:l.revision});
  const doubleState=await live(doubleLive.live_match_id);
  assert.equal(doubleState.set1_j1,7);assert.equal(doubleState.set1_tb_j1,null);assert.equal(doubleState.set3_format,'super_tiebreak');
  await db.exec("UPDATE clubs SET status='suspended' WHERE id='"+id(1)+"'");
  await assert.rejects(command('confirm',{revision:await revision()}),/Accès membre/);
  await db.exec("UPDATE clubs SET status='active' WHERE id='"+id(1)+"'");
  await as(101,'DELETE FROM team_rencontres WHERE id=$1',[id(14)]);
  assert.equal((await live(m.id)).team_match_line_id,null,'deleting an encounter cleans up its historical live links');
 } finally {await db.close();}
});
