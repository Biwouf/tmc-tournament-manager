import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { PGlite } from '@electric-sql/pglite';

test('Competition rules: explicit configuration, doubles, immutable snapshot and tenant lineage', async () => {
  const db = new PGlite();
  try {
    await db.exec(`
      CREATE TYPE live_set3_format AS ENUM ('normal', 'super_tiebreak');
      CREATE TABLE team_competitions(id int PRIMARY KEY, club_id int);
      CREATE TABLE team_equipes(id int PRIMARY KEY, competition_id int, club_id int);
      CREATE TABLE team_etapes(id int PRIMARY KEY, equipe_id int, club_id int);
      CREATE TABLE team_rencontres(id int PRIMARY KEY, etape_id int, club_id int);
      CREATE TABLE live_matches(id int PRIMARY KEY, club_id int, set3_format live_set3_format);
      CREATE TABLE team_match_lines(id int PRIMARY KEY, rencontre_id int, club_id int,
        match_type text, live_match_id int, score text);
      INSERT INTO team_competitions VALUES (1,1),(2,2);
      INSERT INTO team_equipes VALUES (1,1,1),(2,2,2);
      INSERT INTO team_etapes VALUES (1,1,1),(2,2,2);
      INSERT INTO team_rencontres VALUES (1,1,1),(2,2,2);
      INSERT INTO live_matches VALUES (1,1,'normal');
      INSERT INTO team_match_lines VALUES (1,1,1,'simple',1,'6-4 6-2'),(2,1,1,'simple',NULL,'6-3 6-2');
    `);
    await db.exec(await readFile(new URL('../supabase/migrations/2026092101_team_scoring_rules.sql', import.meta.url), 'utf8'));
    const rule = async id => (await db.query('SELECT set3_format FROM team_match_lines WHERE id=$1', [id])).rows[0].set3_format;
    assert.equal(await rule(1), 'normal', 'known historical live rule is retained');
    assert.equal(await rule(2), null, 'unknown historical rule is not invented');
    assert.equal((await db.query('SELECT singles_set3_format FROM team_competitions WHERE id=1')).rows[0].singles_set3_format, null);
    await assert.rejects(db.exec("INSERT INTO team_match_lines(id,rencontre_id,club_id,match_type) VALUES (3,1,1,'simple')"), /Renseignez/);
    await db.exec("INSERT INTO team_match_lines(id,rencontre_id,club_id,match_type,set3_format) VALUES (3,1,1,'double','normal')");
    assert.equal(await rule(3), 'super_tiebreak', 'double rule overrides caller input');
    await db.exec("UPDATE team_competitions SET singles_set3_format='normal' WHERE id=1; INSERT INTO team_match_lines(id,rencontre_id,club_id,match_type,set3_format) VALUES (4,1,1,'simple','super_tiebreak')");
    assert.equal(await rule(4), 'normal', 'simple rule comes from competition');
    await db.exec("UPDATE team_competitions SET singles_set3_format='super_tiebreak' WHERE id=1; INSERT INTO team_match_lines(id,rencontre_id,club_id,match_type) VALUES (5,1,1,'simple')");
    assert.equal(await rule(4), 'normal', 'competition changes do not rewrite existing matches');
    assert.equal(await rule(5), 'super_tiebreak');
    await assert.rejects(db.exec("UPDATE team_match_lines SET set3_format='super_tiebreak' WHERE id=4"), /conservée/);
    await assert.rejects(db.exec("UPDATE team_match_lines SET match_type='double' WHERE id=4"), /recréez/);
    await assert.rejects(db.exec("UPDATE team_match_lines SET rencontre_id=2 WHERE id=4"), /recréez/);
    await assert.rejects(db.exec("INSERT INTO team_match_lines(id,rencontre_id,club_id,match_type) VALUES (6,2,1,'double')"), /introuvable/);
    await assert.rejects(db.exec("UPDATE team_match_lines SET club_id=2 WHERE id=4"), /club du match/);
    await db.exec("UPDATE team_match_lines SET score='6-2 6-3' WHERE id=4");
    assert.equal(await rule(4), 'normal', 'ordinary score edits preserve the rule');
  } finally { await db.close(); }
});
