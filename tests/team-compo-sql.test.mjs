import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { PGlite } from '@electric-sql/pglite';
import { coursesFixtureSQL, id } from './helpers/courses-fixture.mjs';
const migration = async name => readFile(new URL(`../supabase/migrations/${name}.sql`, import.meta.url),'utf8');

test('Team compo: roster, atomic creation of the singles, replay and member ranking updates', async () => {
 const db=new PGlite();
 try {
  await db.exec(coursesFixtureSQL);
  await db.exec(`CREATE TABLE events(id uuid PRIMARY KEY);
   CREATE FUNCTION set_updated_at() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN NEW.updated_at=now(); RETURN NEW; END $$;
   CREATE FUNCTION can_manage_club_content(cid uuid) RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER AS $$ SELECT EXISTS(SELECT 1 FROM club_members WHERE club_id=cid AND user_id=auth.uid() AND role IN ('admin','manager')) $$;
   CREATE TABLE profile_details(user_id uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,sex text,revision integer NOT NULL DEFAULT 0,updated_at timestamptz NOT NULL DEFAULT now(),
    classement text CHECK (classement IN ('NC','40','30/5','30/4','30/3','30/2','30/1','30','15/5','15/4','15/3','15/2','15/1','15','5/6','4/6','3/6','2/6','1/6','0','-2/6','-4/6','-15')));
   ALTER TABLE profile_details ENABLE ROW LEVEL SECURITY;`);
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
  for (const name of ['20260907_live_match_consistency','2026092101_team_scoring_rules','2026092401_team_match_commands','2026092601_team_format_3s1d',
   '2026093001_live_activity','2026093002_team_live_shared_scoring','2026100104_live_encounter_scores','2026100401_no_retry_errcodes','2026101107_team_live_auto_result','2026101105_team_compo','2026101201_team_compo_scan_quota'])
   await db.exec(await migration(name));
  await db.exec(`UPDATE team_competitions SET singles_set3_format='normal' WHERE id='${id(11)}';
   UPDATE profiles SET prenom='Marie',nom='Callot' WHERE id='${id(104)}';
   UPDATE profiles SET prenom='',nom='' WHERE id='${id(105)}';
   INSERT INTO profile_details(user_id,classement) VALUES('${id(104)}','30/4');`);
  async function as(user,sql,args=[]) {
   await db.exec(`BEGIN; SET LOCAL ROLE ${user===null?'anon':'authenticated'}; SELECT set_config('request.jwt.claim.sub','${user===null?'':id(user)}',true);`);
   try { const r=await db.query(sql,args);await db.exec('COMMIT');return r.rows; }
   catch(e){await db.exec('ROLLBACK');throw e;}
  }
  const roster=await as(103,'SELECT team_member_roster($1) AS r',[id(1)]).then(rows=>rows[0].r);
  assert.ok(roster.some(m=>m.id===id(104)&&m.classement==='30/4'),'roster exposes the member ranking');
  assert.ok(!roster.some(m=>m.id===id(105)),'members without a name are not proposed');
  assert.ok(!roster.some(m=>m.id===id(106)),'other clubs stay hidden');
  await assert.rejects(as(106,'SELECT team_member_roster($1)',[id(1)]),/Accès membre/);
  await assert.rejects(as(null,'SELECT team_member_roster($1)',[id(1)]),/permission denied/);

  const compo=(data,user=103,key=randomUUID())=>as(user,'SELECT team_compo_command($1,$2,$3,$4) AS result',[id(1),id(14),data,key]).then(rows=>rows[0].result);
  const lines=async()=>(await db.query("SELECT slot,joueurs_club,joueurs_adverse,set3_format FROM team_match_lines WHERE rencontre_id=$1 ORDER BY slot",[id(14)])).rows;
  const adverse=n=>({prenom:`Adv${n}`,nom:'',classement:'30/5'});
  const simples=[
   {slot:2,joueur_club:{prenom:'Marie',nom:'Callot',classement:'30/3',member_id:id(104)},joueur_adverse:adverse(2),update_classement:true},
   {slot:1,joueur_club:{prenom:'Audrey',nom:'Guy',classement:'30/2'},joueur_adverse:adverse(1)},
   {slot:3,joueur_club:{prenom:'Lucie',nom:'Olive',classement:'30/5'},joueur_adverse:adverse(3)},
  ];
  await assert.rejects(compo({simples:[]}),/Composition invalide/);
  await assert.rejects(compo({simples},106),/Accès membre/);
  await assert.rejects(compo({simples:[...simples.slice(0,2),{...simples[2],slot:4}]}),/place/i);
  assert.equal((await lines()).length,0,'a rejected slot cancels the whole compo');
  await assert.rejects(compo({simples:[simples[1],{...simples[2],joueur_club:{prenom:'',nom:'',classement:'30'}}]}),/Nom et classement/);
  assert.equal((await lines()).length,0);

  const key=randomUUID();
  const result=await compo({simples},103,key);
  assert.equal(result.ids.length,3);assert.equal(result.classements_mis_a_jour,1);
  const created=await lines();
  assert.deepEqual(created.map(l=>[l.slot,l.joueurs_club[0].prenom,l.joueurs_adverse[0].prenom,l.set3_format]),
   [[1,'Audrey','Adv1','normal'],[2,'Marie','Adv2','normal'],[3,'Lucie','Adv3','normal']]);
  assert.equal((await db.query('SELECT classement FROM profile_details WHERE user_id=$1',[id(104)])).rows[0].classement,'30/3');
  assert.deepEqual((await compo({simples},103,key)).ids,result.ids,'a network retry returns the same matches');
  assert.equal((await lines()).length,3);
  await assert.rejects(compo({simples:[simples[1]]}),/unique/,'an existing slot cannot be created twice');
  assert.equal((await db.query('SELECT count(*)::int n FROM team_match_history')).rows[0].n>=3,true,'each single leaves a history');

  const scan=(user=103,club=id(1))=>as(user,'SELECT team_compo_scan_begin($1)',[club]);
  await assert.rejects(scan(106),/Accès membre/);
  await assert.rejects(scan(null),/permission denied/);
  for(let i=0;i<6;i++) await scan();
  await assert.rejects(scan(),/Trop de lectures/,'each member is capped');
  await scan(104);
  await assert.rejects(as(103,'SELECT * FROM team_compo_scans'),/permission denied/,'the quota log is not exposed');
  await db.exec(`INSERT INTO team_compo_scans(club_id,actor_id) SELECT '${id(1)}','${id(101)}' FROM generate_series(1,53)`);
  await assert.rejects(scan(102),/Limite quotidienne/,'the club has a daily cap');
 } finally {await db.close();}
});
