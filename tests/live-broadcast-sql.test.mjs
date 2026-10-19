import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { PGlite } from '@electric-sql/pglite';
const text = path => readFile(new URL('../' + path, import.meta.url), 'utf8');
const id = n => `00000000-0000-0000-0000-${String(n).padStart(12,'0')}`;

test('Live SQL: writes publish Broadcast messages on public topics, only for active clubs', async () => {
  const db = new PGlite();
  try {
    await db.exec(`
      CREATE ROLE authenticated; CREATE ROLE anon;
      CREATE SCHEMA realtime;
      CREATE TABLE realtime.sent (n serial, payload jsonb, event text, topic text, private boolean);
      CREATE FUNCTION realtime.send(payload jsonb, event text, topic text, private boolean DEFAULT true) RETURNS void
      LANGUAGE sql AS $$ INSERT INTO realtime.sent(payload,event,topic,private) VALUES (payload,event,topic,private) $$;
      CREATE TABLE clubs (id uuid PRIMARY KEY, status text NOT NULL);
      CREATE TABLE live_matches (id uuid PRIMARY KEY, club_id uuid NOT NULL, team_rencontre_id uuid, status text NOT NULL DEFAULT 'pending', revision int NOT NULL DEFAULT 0, set1_j1 int);
      CREATE TABLE live_posts (id uuid PRIMARY KEY, sequence bigint GENERATED ALWAYS AS IDENTITY, match_id uuid NOT NULL REFERENCES live_matches(id), body text);
      CREATE TABLE team_rencontres (id uuid PRIMARY KEY, club_id uuid, score text);
      CREATE TABLE team_match_lines (id uuid PRIMARY KEY, club_id uuid, rencontre_id uuid NOT NULL REFERENCES team_rencontres(id), gagnant text);
      CREATE PUBLICATION supabase_realtime FOR TABLE live_matches, live_posts, team_rencontres;
      INSERT INTO clubs VALUES ('${id(1)}','active'), ('${id(2)}','suspended');
    `);
    const migration = await text('supabase/migrations/2026101820_live_broadcast.sql');
    await db.exec(migration); await db.exec(migration);
    const sent = async () => (await db.query('SELECT payload,event,topic,private FROM realtime.sent ORDER BY n')).rows;
    const reset = () => db.exec('TRUNCATE realtime.sent');

    const m = id(11), r = id(21);
    await db.exec(`INSERT INTO team_rencontres VALUES ('${r}','${id(1)}',null)`);
    await reset();
    await db.exec(`INSERT INTO live_matches(id,club_id,team_rencontre_id) VALUES ('${m}','${id(1)}','${r}')`);
    await db.exec(`UPDATE live_matches SET set1_j1=3, revision=1 WHERE id='${m}'`);
    let rows = await sent();
    assert.deepEqual(rows.map(x => [x.event, x.topic, x.private]), [
      ['score', `live:match:${m}`, false], ['live', `live:club:${id(1)}`, false],
      ['score', `live:match:${m}`, false], ['live', `live:club:${id(1)}`, false],
    ]);
    assert.equal(rows[2].payload.row.set1_j1, 3, 'score carries the row after write');
    assert.equal(rows[2].payload.row.revision, 1);
    assert.deepEqual(rows[3].payload, { id: m, op: 'UPDATE', status: 'pending', team_rencontre_id: r });

    await reset();
    await db.exec(`INSERT INTO live_posts(id,match_id,body) VALUES ('${id(31)}','${m}','Allez')`);
    await db.exec(`UPDATE live_posts SET body='Allez !' WHERE id='${id(31)}'`);
    rows = await sent();
    assert.deepEqual(rows.map(x => [x.event, x.topic, x.payload.op, x.payload.id]), [
      ['post', `live:match:${m}`, 'INSERT', id(31)], ['post', `live:match:${m}`, 'UPDATE', id(31)],
    ]);
    assert.equal(typeof rows[0].payload.sequence, 'number');

    await reset();
    await db.exec(`INSERT INTO team_match_lines VALUES ('${id(41)}','${id(1)}','${r}',null)`);
    await db.exec(`UPDATE team_rencontres SET score='3-1' WHERE id='${r}'`);
    await db.exec(`DELETE FROM team_match_lines WHERE id='${id(41)}'`);
    rows = await sent();
    assert.deepEqual(rows.map(x => [x.event, x.topic, x.payload.rencontre_id]), [
      ['team', `live:club:${id(1)}`, r], ['team', `live:club:${id(1)}`, r], ['team', `live:club:${id(1)}`, r],
    ]);

    await reset();
    await db.exec(`DELETE FROM live_posts; DELETE FROM live_matches WHERE id='${m}'`);
    rows = await sent();
    assert.deepEqual(rows.map(x => [x.event, x.payload.op]), [['live', 'DELETE']], 'delete only signals the list');

    await reset();
    const s = id(12);
    await db.exec(`INSERT INTO live_matches(id,club_id) VALUES ('${s}','${id(2)}');
      INSERT INTO live_posts(id,match_id,body) VALUES ('${id(32)}','${s}','x');
      INSERT INTO team_rencontres VALUES ('${id(22)}','${id(2)}',null);`);
    assert.deepEqual(await sent(), [], 'nothing published for a suspended club');

    const published = (await db.query(`SELECT tablename FROM pg_publication_tables WHERE pubname='supabase_realtime' ORDER BY 1`)).rows;
    assert.deepEqual(published.map(x => x.tablename), ['team_rencontres'], 'live tables leave postgres_changes');
  } finally { await db.close(); }
});
