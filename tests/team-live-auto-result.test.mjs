import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { PGlite } from '@electric-sql/pglite';
import { coursesFixtureSQL, id } from './helpers/courses-fixture.mjs';
const migration = async name => readFile(new URL(`../supabase/migrations/${name}.sql`, import.meta.url),'utf8');

test('Team live: a finished live validates its match result and the encounter total follows', async () => {
 const db=new PGlite();
 try {
  await db.exec(coursesFixtureSQL);
  await db.exec(`CREATE TABLE events(id uuid PRIMARY KEY);
   CREATE FUNCTION set_updated_at() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN NEW.updated_at=now(); RETURN NEW; END $$;
   CREATE FUNCTION can_manage_club_content(cid uuid) RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER AS $$ SELECT EXISTS(SELECT 1 FROM club_members WHERE club_id=cid AND user_id=auth.uid() AND role IN ('admin','manager')) $$;`);
  await db.exec((await migration('20260423_live_matches')).replace('ALTER PUBLICATION supabase_realtime ADD TABLE live_matches;', ''));
  await db.exec(await migration('20260606_team_matches'));
  await db.exec(await migration('20260628_team_rencontres_wo'));
  for (const table of ['live_matches','team_saisons','team_competitions','team_equipes','team_etapes','team_rencontres','team_match_lines']) {
   await db.exec(`ALTER TABLE ${table} ADD COLUMN club_id uuid NOT NULL DEFAULT '${id(1)}';
    CREATE POLICY test_tenant ON ${table} AS RESTRICTIVE FOR ALL TO authenticated USING(club_id IN (SELECT club_id FROM club_members WHERE user_id=auth.uid())) WITH CHECK(club_id IN (SELECT club_id FROM club_members WHERE user_id=auth.uid()));`);
  }
  await db.exec(`GRANT SELECT ON club_members TO authenticated;
   GRANT SELECT,INSERT,UPDATE,DELETE ON live_matches TO authenticated;
   ALTER TABLE live_matches ADD COLUMN court text,ADD COLUMN started_at timestamptz,ADD COLUMN retired_player live_match_winner;
   INSERT INTO team_saisons(id,label) VALUES('${id(10)}','2026');
   INSERT INTO team_competitions(id,saison_id,nom,type,genre,categorie,format) VALUES('${id(11)}','${id(10)}','Interclubs','adultes','hommes','seniors','3S1D2');
   INSERT INTO team_equipes(id,competition_id,division,nb_journees_poule) VALUES('${id(12)}','${id(11)}','R1A',2);
   INSERT INTO team_etapes(id,equipe_id,phase,numero_journee) VALUES('${id(13)}','${id(12)}','poule',1);
   INSERT INTO team_rencontres(id,etape_id,club_adverse,date_heure,domicile) VALUES('${id(14)}','${id(13)}','Adversaires','2026-09-23 09:00+02',true);`);
  for (const name of ['20260907_live_match_consistency','2026092101_team_scoring_rules','2026092401_team_match_commands','2026092601_team_format_3s1d','2026093002_team_live_shared_scoring','2026100401_no_retry_errcodes'])
   await db.exec(await migration(name));
  await db.exec(`UPDATE team_competitions SET singles_set3_format='super_tiebreak' WHERE id='${id(11)}'`);
  async function as(user,sql,args=[]) {
   await db.exec(`BEGIN; SET LOCAL ROLE authenticated; SELECT set_config('request.jwt.claim.sub','${id(user)}',true);`);
   try { const r=await db.query(sql,args);await db.exec('COMMIT');return r.rows; }
   catch(e){await db.exec('ROLLBACK');throw e;}
  }
  const command=(op,data,user=103)=>as(user,'SELECT team_match_command($1,$2,$3,$4,$5) AS result',[id(1),id(14),op,data,randomUUID()]).then(rows=>rows[0].result);
  const line=async lid=>(await db.query('SELECT * FROM team_match_lines WHERE id=$1',[lid])).rows[0];
  const live=async mid=>(await db.query('SELECT * FROM live_matches WHERE id=$1',[mid])).rows[0];
  const total=async()=>{const r=(await db.query('SELECT score_club,score_adverse FROM team_rencontres WHERE id=$1',[id(14)])).rows[0];return [r.score_club,r.score_adverse];};
  const players={joueurs_club:[{prenom:'Camille',nom:'Club',classement:'NC'}],joueurs_adverse:[{prenom:'Alex',nom:'Adverse',classement:'30'}]};
  const score=(mid,set)=>as(103,`UPDATE live_matches SET ${set} WHERE id=$1`,[mid]);

  // Avant la migration : un live terminé attend une validation manuelle.
  const s1=await command('create',{match_type:'simple',slot:1,...players});
  const m1=(await command('start_live',{id:s1.id,revision:0})).live_match_id;
  await score(m1,"set1_j1=6,set1_j2=4,set2_j1=6,set2_j2=3,status='finished',winner='j1',finished_at=now()");
  assert.equal((await line(s1.id)).gagnant,null);
  assert.deepEqual(await total(),[0,0]);

  await db.exec(await migration('2026101107_team_live_auto_result'));
  let l=await line(s1.id);
  assert.equal(l.gagnant,'club','the backfill validates lives already finished');
  assert.equal(l.score,'6-4 6-3');assert.equal(l.result_kind,'normal');assert.ok(l.confirmed_at);
  assert.deepEqual(l.sets,[{club:6,adverse:4},{club:6,adverse:3}]);
  assert.equal((await live(m1)).team_result_confirmed,true);
  assert.deepEqual(await total(),[1,0]);

  // Fin de live : résultat validé sans action, super tie-break compris.
  const s2=await command('create',{match_type:'simple',slot:2,...players});
  const m2=(await command('start_live',{id:s2.id,revision:0})).live_match_id;
  await score(m2,'set1_j1=6,set1_j2=7,set1_tb_j1=5,set1_tb_j2=7');
  assert.equal((await line(s2.id)).gagnant,null,'a running live is not a result');
  await score(m2,"set2_j1=6,set2_j2=2,set3_j1=8,set3_j2=10,status='finished',winner='j2',finished_at=now()");
  l=await line(s2.id);
  assert.equal(l.gagnant,'adverse');assert.equal(l.score,'6-7 6-2 8-10');
  assert.deepEqual(l.sets[0],{club:6,adverse:7,tb_club:5,tb_adverse:7});
  assert.deepEqual(await total(),[1,1]);

  // Correction d'un live terminé : le résultat suit. Reprise : il est invalidé.
  await score(m2,'set2_j1=6,set2_j2=1');
  assert.equal((await line(s2.id)).score,'6-7 6-1 8-10');
  await score(m2,"status='live',winner=NULL,finished_at=NULL");
  l=await line(s2.id);
  assert.equal(l.gagnant,null);assert.equal(l.confirmed_at,null);
  assert.equal((await live(m2)).team_result_confirmed,false);
  assert.deepEqual(await total(),[1,0]);

  // Abandon en live.
  await score(m2,"set3_j1=3,set3_j2=2,retired_player='j2',status='finished',winner='j1',finished_at=now()");
  l=await line(s2.id);
  assert.equal(l.result_kind,'retired');assert.equal(l.gagnant,'club');assert.equal(l.score,'6-7 6-1 3-2 AB.');
  assert.deepEqual(await total(),[2,0]);

  // Saisie directe sans live : le total de la rencontre suit aussi.
  const s3=await command('create',{match_type:'simple',slot:3,...players});
  await command('result',{id:s3.id,revision:0,kind:'normal',sets:[{club:2,adverse:6},{club:3,adverse:6}]});
  assert.deepEqual(await total(),[2,1]);

  // Saisie directe sur un live en cours : la commande garde la main sur le résultat.
  const d1=await command('create',{match_type:'double',slot:1,joueurs_club:[...players.joueurs_club,...players.joueurs_club],joueurs_adverse:[...players.joueurs_adverse,...players.joueurs_adverse]});
  const md=(await command('start_live',{id:d1.id,revision:0})).live_match_id;
  l=await line(d1.id);
  await command('result',{id:d1.id,revision:l.revision,live_revision:(await live(md)).revision,kind:'normal',sets:[{club:6,adverse:1},{club:6,adverse:2}]});
  l=await line(d1.id);
  assert.equal(l.score,'6-1 6-2');assert.equal(l.gagnant,'club');
  assert.equal((await live(md)).team_result_confirmed,true);
  assert.deepEqual(await total(),[4,1],'the double counts two points');

  // La confirmation reste disponible, toutes les places ayant un résultat.
  const revision=(await db.query('SELECT revision FROM team_rencontres WHERE id=$1',[id(14)])).rows[0].revision;
  await command('confirm',{revision});
  assert.ok((await db.query('SELECT confirmed_at FROM team_rencontres WHERE id=$1',[id(14)])).rows[0].confirmed_at);

  // Un membre ne peut toujours pas forcer la validation lui-même.
  await assert.rejects(score(m1,'team_result_confirmed=false'),/géré automatiquement/);
 } finally {await db.close();}
});
