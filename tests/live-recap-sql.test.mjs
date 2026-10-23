import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { PGlite } from '@electric-sql/pglite';
import { coursesFixtureSQL, id } from './helpers/courses-fixture.mjs';
const migration = async (name) =>
  readFile(new URL(`../supabase/migrations/${name}.sql`, import.meta.url), 'utf8');

test('Live recap: score history while live only, unique viewers above 10, public counts of the finished live', async () => {
  const db = new PGlite();
  try {
    await db.exec(coursesFixtureSQL);
    await db.exec(`CREATE TABLE events(id uuid PRIMARY KEY);
   CREATE FUNCTION set_updated_at() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN NEW.updated_at=now(); RETURN NEW; END $$;
   CREATE FUNCTION can_manage_club_content(cid uuid) RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER AS $$ SELECT false $$;`);
    await db.exec(
      (await migration('20260423_live_matches')).replace('ALTER PUBLICATION supabase_realtime ADD TABLE live_matches;', ''),
    );
    await db.exec(`ALTER TABLE live_matches ADD COLUMN club_id uuid NOT NULL DEFAULT '${id(1)}', ADD COLUMN court text,ADD COLUMN started_at timestamptz,ADD COLUMN retired_player live_match_winner;
   DROP POLICY live_matches_select ON live_matches;
   CREATE POLICY tenant_isolation ON live_matches FOR ALL TO authenticated USING(club_id IN (SELECT club_id FROM club_members WHERE user_id=auth.uid())) WITH CHECK(club_id IN (SELECT club_id FROM club_members WHERE user_id=auth.uid()));
   CREATE POLICY public_read ON live_matches FOR SELECT TO anon USING(EXISTS(SELECT 1 FROM clubs WHERE clubs.id=club_id AND status='active'));
   GRANT SELECT ON club_members TO authenticated; GRANT SELECT ON live_matches TO anon;
   GRANT SELECT,INSERT,UPDATE,DELETE ON live_matches TO authenticated;`);
    for (const name of [
      '20260907_live_match_consistency',
      '2026093001_live_activity',
      '2026101102_live_photos',
      '2026101104_live_reactions_throttle',
      '2026101301_live_set_times',
      '2026101501_live_post_reactions',
      '2026102001_live_post_after_finish',
    ])
      await db.exec(await migration(name));
    const recapMigration = await migration('2026102203_live_recap');
    await db.exec(recapMigration);
    await db.exec(recapMigration);
    const replayMigration = await migration('2026102301_live_recap_replay');
    await db.exec(replayMigration);
    await db.exec(replayMigration);
    async function as(user, sql, args = []) {
      await db.exec(
        `BEGIN; SET LOCAL ROLE ${user === null ? 'anon' : 'authenticated'}; SELECT set_config('request.jwt.claim.sub','${user === null ? '' : id(user)}',true);`,
      );
      try {
        const { rows } = await db.query(sql, args);
        await db.exec('COMMIT');
        return rows;
      } catch (e) {
        await db.exec('ROLLBACK');
        throw e;
      }
    }
    const m = id(20), small = id(23);
    const update = (set, match = m) => as(103, `UPDATE live_matches SET ${set} WHERE id='${match}'`);
    const events = async (match = m) =>
      (await db.query(`SELECT score FROM live_score_events WHERE match_id=$1 ORDER BY id`, [match])).rows.map((r) => r.score);
    const view = (viewer, user = null, match = m) =>
      as(user, 'SELECT live_match_view($1,$2)', [match, viewer]);
    const recap = (user = null, match = m, club = id(1)) =>
      as(user, 'SELECT live_match_recap($1,$2) AS r', [match, club]).then((rows) => rows[0].r);
    const command = (action, data, user = 103) =>
      as(user, 'SELECT live_activity_command($1,$2,$3,$4) AS r', [m, id(1), action, data]).then((rows) => rows[0].r);

    await as(103, `INSERT INTO live_matches(id,club_id,match_date,j1_prenom,j1_nom,j2_prenom,j2_nom,set1_j1,set1_j2)
      VALUES('${m}','${id(1)}','2026-10-22','Alex','A','Sam','B',1,0),('${small}','${id(1)}','2026-10-22','C','C','D','D',null,null)`);
    await view(randomUUID());
    assert.equal((await db.query('SELECT count(*)::int n FROM live_match_viewers')).rows[0].n, 0, 'not counted before the live');
    await update(`status='live',scored_by='${id(103)}',started_at=now()`);
    assert.deepEqual((await events()).map((s) => [s.set1_j1, s.set1_j2]), [[1, 0]], 'start writes the baseline snapshot');
    assert.equal(await recap(), null, 'no recap while live');

    await update(`set1_j1=2`);
    await update(`set1_j2=1`);
    await update(`set1_j2=0`); // correction
    await update(`court='3'`);
    await update(`set1_j1=6,set1_j2=6,set1_tb_j1=0,set1_tb_j2=0`);
    await update(`set1_tb_j1=3`);
    await update(`set1_tb_j2=2`);
    assert.equal((await events()).length, 5, 'court and tie-break points are not recorded, corrections are');
    await update(`set1_j1=7,set1_tb_j1=7,set2_j1=0,set2_j2=0`);
    const last = (await events()).at(-1);
    assert.deepEqual([last.set1_j1, last.set1_tb_j1, last.set1_tb_j2, last.set2_j1], [7, 7, 2, 0]);

    const devices = Array.from({ length: 11 }, () => randomUUID());
    for (const device of devices) await view(device);
    await view(devices[0], 104);
    await view(null);
    await view(devices[0], null, id(99)); // match inconnu : sans effet ni erreur
    assert.equal((await db.query(`SELECT count(*)::int n FROM live_match_viewers WHERE match_id='${m}'`)).rows[0].n, 11, 'one row per device');
    await assert.rejects(as(null, 'SELECT * FROM live_match_viewers'), /permission denied/);
    await assert.rejects(as(104, 'SELECT * FROM live_score_events'), /permission denied/);

    const kept = randomUUID(), removed = randomUUID();
    await command('message', { id: kept, body: 'Quel revers !' });
    await command('message', { id: removed, body: 'Oups' });
    await command('poll', { id: randomUUID(), body: 'Qui gagne ?', options: ['Alex', 'Sam'] });
    await command('react', { id: kept, emoji: '🔥' }, 104);
    await command('react', { id: kept, emoji: '🔥' }, 105);
    await command('react', { id: removed, emoji: '👏' }, 104);
    await command('delete', { id: removed });

    await update(`set2_j1=6,status='finished',winner='j1',finished_at=now()`);
    const count = (await events()).length;
    await view(randomUUID());
    await update(`set2_j2=1`).catch(() => {});
    await db.exec(`UPDATE live_matches SET set2_j2=2 WHERE id='${m}'`);
    assert.equal((await events()).length, count, 'nothing recorded once finished, nor outside the live');

    await command('react', { id: kept, emoji: '👏' }, 101);
    const result = await recap();
    assert.deepEqual(
      { messages: result.messages, photos: result.photos, polls: result.polls, reactions: result.reactions, viewers: result.viewers },
      { messages: 1, photos: 0, polls: 1, reactions: 3, viewers: 11 },
      'deleted posts and their reactions excluded, viewers shown above 10',
    );
    assert.deepEqual(result.top_reactions, [{ emoji: '🔥', count: 2 }, { emoji: '👏', count: 1 }]);
    assert.equal(result.score.length, count);
    assert.ok(result.score.every((s) => typeof s.at === 'string'), 'each snapshot has its time');
    assert.deepEqual(
      result.moments.map((p) => [p.id, p.kind, p.reactions, p.emoji, p.author_name]),
      [[kept, 'message', 3, '🔥', 'Prénom Nom']],
      'most reacted posts, deleted ones and polls excluded',
    );
    assert.deepEqual(result.photos_top, []);
    assert.deepEqual(await recap(104), result, 'same recap for a signed-in member');

    await update(`status='live',scored_by='${id(103)}',started_at=now()`, small);
    for (let i = 0; i < 10; i++) await view(randomUUID(), null, small);
    await update(`status='finished',winner='j2',retired_player='j1',finished_at=now()`, small);
    const tiny = await recap(null, small);
    assert.equal(tiny.viewers, null, '10 viewers stay hidden');
    assert.deepEqual([tiny.messages, tiny.reactions, tiny.top_reactions, tiny.moments], [0, 0, [], []]);
    assert.deepEqual(tiny.score.map(({ at, ...s }) => s), [{ set1_j1: null, set1_j2: null, set2_j1: null, set2_j2: null, set3_j1: null, set3_j2: null, set3_format: null, set1_tb_j1: null, set1_tb_j2: null, set2_tb_j1: null, set2_tb_j2: null, set3_tb_j1: null, set3_tb_j2: null }]);

    await assert.rejects(recap(null, m, id(2)), /introuvable/, 'club mismatch');
    await db.exec(`UPDATE clubs SET status='suspended' WHERE id='${id(1)}'`);
    await assert.rejects(recap(), /introuvable/, 'inactive club');
  } finally {
    await db.close();
  }
});
