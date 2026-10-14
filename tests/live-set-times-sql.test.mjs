import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { PGlite } from '@electric-sql/pglite';
const text = path => readFile(new URL('../' + path, import.meta.url), 'utf8');
const id = n => `00000000-0000-0000-0000-${String(n).padStart(12,'0')}`;

test('Live SQL: set end times are stamped by the server while live, cleared on correction, never invented', async () => {
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
      CREATE FUNCTION can_manage_club_content(uuid) RETURNS boolean LANGUAGE sql AS $$ SELECT false $$;
      DROP POLICY live_matches_select ON live_matches; DROP POLICY live_matches_insert ON live_matches;
      DROP POLICY live_matches_update ON live_matches; DROP POLICY live_matches_delete ON live_matches;
      CREATE POLICY all_rows ON live_matches FOR ALL TO authenticated USING (true) WITH CHECK (true);
      GRANT SELECT,INSERT,UPDATE,DELETE ON live_matches TO authenticated;
      INSERT INTO auth.users VALUES ('${id(101)}');
    `);
    await db.exec(await text('supabase/migrations/20260907_live_match_consistency.sql'));
    const migration = await text('supabase/migrations/2026101301_live_set_times.sql');
    await db.exec(migration); await db.exec(migration);
    async function as(sql) {
      await db.exec(`BEGIN; SET LOCAL ROLE authenticated; SELECT set_config('request.jwt.claim.sub','${id(101)}',true);`);
      try { const result = await db.query(sql); await db.exec('COMMIT'); return result.rows[0]; }
      catch (error) { await db.exec('ROLLBACK'); throw error; }
    }
    const m = id(11), upd = set => as(`UPDATE live_matches SET ${set} WHERE id='${m}' RETURNING set1_ended_at,set2_ended_at`);

    let row = await as(`INSERT INTO live_matches(id,match_date,j1_prenom,j1_nom,j2_prenom,j2_nom,set1_j1,set1_j2) VALUES ('${m}','2026-10-13','A','A','B','B',6,2) RETURNING set1_ended_at`);
    assert.equal(row.set1_ended_at, null, 'insert never stamps');
    row = await upd(`status='live',scored_by='${id(101)}',started_at=now()`);
    assert.equal(row.set1_ended_at, null, 'historical score is not stamped at start');

    await upd(`set1_j1=5,set1_j2=4`);
    row = await upd(`set1_j1=6`);
    assert.ok(row.set1_ended_at, 'set 1 stamped when won');
    const first = row.set1_ended_at.getTime();
    row = await upd(`set2_j1=1,set1_ended_at=null`);
    assert.equal(row.set1_ended_at.getTime(), first, 'kept and not writable by the client');

    row = await upd(`set1_j1=5`);
    assert.equal(row.set1_ended_at, null, 'cleared when a correction cancels the set');
    row = await upd(`set1_j1=6`);
    assert.ok(row.set1_ended_at);

    await upd(`set2_j1=6,set2_j2=6,set2_tb_j1=0,set2_tb_j2=0`);
    row = await upd(`set2_tb_j1=6,set2_tb_j2=5`);
    assert.equal(row.set2_ended_at, null, 'tie-break in progress');
    row = await upd(`set2_j1=7,set2_tb_j1=7,status='finished',winner='j1',finished_at=now()`);
    assert.ok(row.set2_ended_at, 'tie-break win stamped in the finishing write');

    await db.exec(`UPDATE live_matches SET set2_j1=6,set2_tb_j1=6 WHERE id='${m}'`);
    row = (await db.query(`UPDATE live_matches SET set2_j1=7,set2_tb_j1=7 WHERE id='${m}' RETURNING set2_ended_at`)).rows[0];
    assert.equal(row.set2_ended_at, null, 'score rewritten outside the live (Ten’Up, import) is not stamped');
  } finally { await db.close(); }
});
