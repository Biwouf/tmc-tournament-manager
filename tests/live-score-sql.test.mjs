import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { PGlite } from '@electric-sql/pglite';
const text = path => readFile(new URL('../' + path, import.meta.url), 'utf8');
const id = n => `00000000-0000-0000-0000-${String(n).padStart(12,'0')}`;

test('Live SQL: ownership, takeover, version conflicts, finish, release and tenant isolation', async () => {
  const db = new PGlite();
  try {
    await db.exec(`
      CREATE ROLE authenticated; CREATE ROLE anon;
      CREATE SCHEMA auth;
      CREATE TABLE auth.users (id uuid PRIMARY KEY);
      CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql AS $$ SELECT nullif(current_setting('request.jwt.claim.sub',true),'')::uuid $$;
      GRANT USAGE ON SCHEMA auth TO authenticated, anon;
      CREATE TABLE events (id uuid PRIMARY KEY);
      CREATE FUNCTION set_updated_at() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN NEW.updated_at=now(); RETURN NEW; END $$;
    `);
    await db.exec((await text('supabase/migrations/20260423_live_matches.sql')).replace('ALTER PUBLICATION supabase_realtime ADD TABLE live_matches;', ''));
    await db.exec(`
      ALTER TABLE live_matches ADD COLUMN club_id uuid NOT NULL DEFAULT '${id(1)}';
      ALTER TABLE live_matches ADD COLUMN court text;
      ALTER TABLE live_matches ADD COLUMN started_at timestamptz;
      ALTER TABLE live_matches ADD COLUMN retired_player live_match_winner;
      CREATE FUNCTION can_manage_club_content(uuid) RETURNS boolean LANGUAGE sql AS $$ SELECT auth.uid()='${id(103)}'::uuid $$;
      DROP POLICY live_matches_select ON live_matches; DROP POLICY live_matches_insert ON live_matches;
      DROP POLICY live_matches_update ON live_matches; DROP POLICY live_matches_delete ON live_matches;
      CREATE POLICY tenant_isolation ON live_matches FOR ALL TO authenticated
        USING (club_id = CASE WHEN auth.uid()='${id(201)}' THEN '${id(2)}'::uuid ELSE '${id(1)}'::uuid END)
        WITH CHECK (club_id = CASE WHEN auth.uid()='${id(201)}' THEN '${id(2)}'::uuid ELSE '${id(1)}'::uuid END);
      GRANT SELECT,INSERT,UPDATE,DELETE ON live_matches TO authenticated;
      GRANT SELECT,DELETE ON events TO authenticated;
      INSERT INTO events VALUES ('${id(55)}');
      INSERT INTO auth.users VALUES ('${id(101)}'),('${id(102)}'),('${id(103)}'),('${id(201)}');
    `);
    const migration = await text('supabase/migrations/20260907_live_match_consistency.sql');
    await db.exec(migration); await db.exec(migration);
    async function as(user, sql) {
      await db.exec(`BEGIN; SET LOCAL ROLE authenticated; SELECT set_config('request.jwt.claim.sub','${id(user)}',true);`);
      try { const result=await db.query(sql); await db.exec('COMMIT'); return result.rows; }
      catch(error) { await db.exec('ROLLBACK'); throw error; }
    }
    const match=id(11);
    await as(101,`INSERT INTO live_matches(id,match_date,j1_prenom,j1_nom,j2_prenom,j2_nom) VALUES ('${match}','2026-09-06','A','A','B','B')`);
    await assert.rejects(as(102,`UPDATE live_matches SET set1_j1=4 WHERE id='${match}'`),/autre utilisateur/);
    const start=await as(101,`UPDATE live_matches SET status='live',scored_by='${id(101)}' WHERE id='${match}' AND revision=0 RETURNING *`);
    assert.equal(start[0].revision,1);
    assert.equal((await as(102,`UPDATE live_matches SET status='live',scored_by='${id(102)}' WHERE id='${match}' AND revision=0 RETURNING id`)).length,0,'two starters cannot both win');
    await as(101,`UPDATE live_matches SET set1_j1=1 WHERE id='${match}' AND revision=1`);
    assert.equal((await as(101,`UPDATE live_matches SET set1_j1=2 WHERE id='${match}' AND revision=1 RETURNING id`)).length,0,'another window cannot overwrite a newer score');
    await assert.rejects(as(102,`UPDATE live_matches SET scored_by='${id(102)}',set1_j1=5 WHERE id='${match}'`),/autre utilisateur/);
    await as(102,`UPDATE live_matches SET scored_by='${id(102)}' WHERE id='${match}' AND revision=2`);
    await assert.rejects(as(101,`UPDATE live_matches SET set1_j1=3 WHERE id='${match}'`),/autre utilisateur/,'old client without CAS still cannot write after takeover');
    assert.equal((await as(201,`UPDATE live_matches SET scored_by='${id(201)}' WHERE id='${match}' RETURNING id`)).length,0);
    await assert.rejects(as(102,`UPDATE live_matches SET club_id='${id(2)}' WHERE id='${match}'`),/ne peuvent pas/);
    await as(102,`UPDATE live_matches SET status='finished',winner='j1',retired_player='j2',finished_at=now() WHERE id='${match}' AND revision=3`);
    await assert.rejects(as(101,`UPDATE live_matches SET status='live',winner=NULL WHERE id='${match}'`),/autre utilisateur/);
    await as(102,`UPDATE live_matches SET status='live',winner=NULL,retired_player=NULL,finished_at=NULL WHERE id='${match}' AND revision=4`);
    await assert.rejects(as(101,`DELETE FROM live_matches WHERE id='${match}'`),/Seul le gestionnaire/);
    await as(102,`UPDATE live_matches SET status='pending',scored_by=NULL WHERE id='${match}' AND revision=5`);
    await as(101,`UPDATE live_matches SET status='live',scored_by='${id(101)}' WHERE id='${match}' AND revision=6`);
    const rows=await as(101,`SELECT * FROM live_matches WHERE id='${match}'`);
    assert.equal(rows[0].set1_j1,1,'release and restart preserve the score');
    assert.equal(rows[0].revision,7);
    assert.equal((await as(103,`DELETE FROM live_matches WHERE id='${match}' AND revision=6 RETURNING id`)).length,0);
    // Suppression d'un événement par un responsable différent du gestionnaire du Live.
    await db.exec(`UPDATE live_matches SET event_id='${id(55)}' WHERE id='${match}'`);
    await as(103,`DELETE FROM events WHERE id='${id(55)}'`);
    const afterCascade=await as(101,`SELECT * FROM live_matches WHERE id='${match}'`);
    assert.equal(afterCascade[0].event_id,null);
    assert.equal(afterCascade[0].set1_j1,1);
    assert.equal((await as(103,`DELETE FROM live_matches WHERE id='${match}' AND revision=${afterCascade[0].revision} RETURNING id`)).length,1);
  } finally { await db.close(); }
});

test('Live public: anonymous visitors read all statuses of active clubs but cannot write', async () => {
  const db=new PGlite();
  try {
    await db.exec(`
      CREATE ROLE anon; CREATE ROLE authenticated;
      CREATE TABLE clubs(id integer PRIMARY KEY,status text);
      GRANT SELECT ON clubs TO anon,authenticated;
      INSERT INTO clubs VALUES (1,'active'),(2,'suspended');
      CREATE TABLE live_matches(id integer PRIMARY KEY,club_id integer REFERENCES clubs(id),status text,score integer);
      ALTER TABLE live_matches ENABLE ROW LEVEL SECURITY;
      GRANT SELECT ON live_matches TO anon;
      GRANT SELECT,INSERT,UPDATE,DELETE ON live_matches TO authenticated;
      CREATE POLICY tenant_isolation ON live_matches FOR ALL TO authenticated USING(club_id=1) WITH CHECK(club_id=1);
      CREATE POLICY active_club_access ON live_matches AS RESTRICTIVE FOR ALL TO anon,authenticated
        USING(EXISTS(SELECT 1 FROM clubs c WHERE c.id=club_id AND c.status='active'))
        WITH CHECK(EXISTS(SELECT 1 FROM clubs c WHERE c.id=club_id AND c.status='active'));
      INSERT INTO live_matches VALUES (1,1,'pending',0),(2,1,'live',3),(3,1,'finished',6),(4,2,'live',2);
    `);
    async function as(role,sql){
      await db.exec(`BEGIN; SET LOCAL ROLE ${role};`);
      try{return (await db.query(sql)).rows;}finally{await db.exec('ROLLBACK');}
    }
    assert.equal((await as('anon','SELECT * FROM live_matches')).length,0,'reproduces silent empty list without public policy');
    const migration=await text('supabase/migrations/20260908_live_matches_public_read.sql');
    await db.exec(migration);await db.exec(migration);
    assert.deepEqual((await as('anon','SELECT status FROM live_matches ORDER BY id')).map(x=>x.status),['pending','live','finished']);
    for(const sql of ["INSERT INTO live_matches VALUES(5,1,'live',9)",'UPDATE live_matches SET score=9 WHERE id=2','DELETE FROM live_matches WHERE id=2']) {
      await assert.rejects(as('anon',sql),/permission denied/);
    }
    assert.equal((await as('authenticated','UPDATE live_matches SET score=4 WHERE id=2 RETURNING score'))[0].score,4);
  }finally{await db.close();}
});
