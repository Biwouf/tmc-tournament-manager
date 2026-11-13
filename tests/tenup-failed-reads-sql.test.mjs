// Lectures Ten'Up en échec (2026111320_tenup_failed_reads) : hors quota et hors plafond d'essai,
// mais bornées par leur propre compteur.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { PGlite } from '@electric-sql/pglite';
import { coursesFixtureSQL, id } from './helpers/courses-fixture.mjs';
const migration = name => readFile(new URL(`../supabase/migrations/${name}.sql`, import.meta.url), 'utf8');

test('failed Ten’Up reads are not counted; failures have their own bounded counter', async () => {
  const db = new PGlite();
  try {
    await db.exec(coursesFixtureSQL);
    await db.exec(`CREATE ROLE service_role; ALTER TABLE clubs ADD COLUMN plan text NOT NULL DEFAULT 'internal';
      CREATE TABLE live_matches(id uuid PRIMARY KEY);
      CREATE FUNCTION set_updated_at() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN NEW.updated_at=now(); RETURN NEW; END $$;`);
    await db.exec(await migration('20260606_team_matches'));
    const audit = await migration('20260905_audit_content_permissions');
    await db.exec(audit.match(/CREATE OR REPLACE FUNCTION public.can_manage_club_content[\s\S]*?\$\$;/)[0]);
    for (const table of ['team_saisons', 'team_competitions']) await db.exec(`ALTER TABLE ${table} ADD COLUMN club_id uuid NOT NULL DEFAULT '${id(1)}';`);
    await db.exec(`INSERT INTO team_saisons(id,label,club_id) VALUES('${id(10)}','2026/2027','${id(1)}'),('${id(20)}','2026/2027','${id(2)}');`);
    await db.exec(await migration('2026100101_admin_competitions'));
    await db.exec(await migration('2026110820_tenup_trial_cap'));
    await db.exec(await migration('2026110920_tenup_club_import'));
    await db.exec(await migration('2026111320_tenup_failed_reads'));
    await db.exec(await migration('2026111320_tenup_failed_reads')); // idempotente

    async function as(role, user, sql, args = []) {
      await db.exec(`BEGIN; SET LOCAL ROLE ${role}; SELECT set_config('request.jwt.claim.sub','${user ? id(user) : ''}',true);`);
      try { const result = await db.query(sql, args); await db.exec('COMMIT'); return result.rows; }
      catch (err) { await db.exec('ROLLBACK'); throw err; }
    }
    const POOL = 'https://tenup.fft.fr/championnat/82678463?division=144146&phase=233672&poule=513524';
    const CLUB_URL = 'https://tenup.fft.fr/club/60820056/competitions/rencontres';
    const read = (user = 101, clubId = id(1), season = id(10)) => as('authenticated', user, 'SELECT team_tenup_competition_begin($1,$2,$3) AS ok', [clubId, season, POOL]);
    const club = (user = 101, clubId = id(1)) => as('authenticated', user, 'SELECT team_tenup_club_begin($1,$2) AS ok', [clubId, CLUB_URL]);
    // Ce que fait l'Edge `tenup-sync` (clé service) quand le worker échoue.
    const fail = async (user = 101, clubId = id(1), clubImport = false) =>
      (await as('service_role', null, 'SELECT team_tenup_read_failed($1,$2,$3) AS ok', [id(user), clubId, clubImport]))[0].ok;
    const counted = async (clubId = id(1)) => (await db.query(`SELECT count(*)::int AS n FROM team_tenup_competition_requests WHERE club_id='${clubId}' AND NOT failed`)).rows[0].n;
    const failures = async (clubId = id(1)) => (await db.query(`SELECT count(*)::int AS n FROM team_tenup_competition_requests WHERE club_id='${clubId}' AND failed`)).rows[0].n;
    const age = () => db.exec(`UPDATE team_tenup_competition_requests SET created_at=created_at-interval '3 minutes'; UPDATE team_tenup_club_imports SET created_at=created_at-interval '3 minutes';`);
    const reset = () => db.exec('DELETE FROM team_tenup_competition_requests; DELETE FROM team_tenup_club_imports;');

    // Réservée au service : ni un admin ni un anonyme ne peut « rendre » ses lectures.
    for (const role of ['authenticated', 'anon']) {
      await assert.rejects(as(role, 101, 'SELECT team_tenup_read_failed($1,$2,false)', [id(101), id(1)]), /permission denied/);
    }

    // Une lecture en échec ne compte plus dans le quota par minute.
    await read(); assert.equal(await fail(), true);
    await read(); assert.equal(await fail(), true);
    await read(); await read();
    assert.equal(await counted(), 2);
    assert.equal(await failures(), 2);
    // Le marquage ne vise que la lecture de ce compte et de ce club, et des 2 dernières minutes.
    assert.equal(await fail(102), false, 'another actor has nothing to mark');
    assert.equal(await fail(101, id(2)), false, 'another club has nothing to mark');
    await age();
    assert.equal(await fail(), false, 'an old read stays counted');
    assert.equal(await counted(), 2);

    // Garde-fou par minute : autant d'échecs que de lectures permises (3), puis refus.
    await reset();
    for (let i = 0; i < 3; i++) { await read(); await fail(); }
    await assert.rejects(read(), /trop de lectures en échec\. Réessayez dans une minute/);
    assert.equal(await counted() + await failures(), 3, 'a refused read leaves nothing');
    await age();
    assert.equal((await read())[0].ok, true);

    // Club en essai : 40 lectures réussies par 24 h, les échecs à part.
    await reset();
    await db.exec(`UPDATE clubs SET plan='trial' WHERE id='${id(1)}';
      INSERT INTO team_tenup_competition_requests(actor_id,club_id,created_at) SELECT '${id(102)}','${id(1)}',now()-interval '2 hours' FROM generate_series(1,39);`);
    await read(); await fail(); // le worker était verrouillé : la lecture est rendue
    await read();
    assert.equal(await counted(), 40);
    await age();
    await assert.rejects(read(), /Limite de l’essai atteinte : 40 lectures Ten’Up par 24 heures/);

    // Échecs provoqués en boucle : bornés à 40 par 24 h et par club, puis plus aucune lecture.
    await reset();
    let attempts = 0;
    for (;;) {
      try { await read(attempts % 2 ? 102 : 101); } catch (err) { assert.match(err.message, /40 lectures Ten’Up en échec par 24 heures/); break; }
      await fail(attempts % 2 ? 102 : 101);
      attempts++;
      await age();
      assert.ok(attempts <= 40, 'failures are capped');
    }
    assert.equal(attempts, 40);
    assert.equal(await counted(), 0);
    await assert.rejects(club(), /en échec/);

    // Page club en échec : la lecture et l'import de club (5 par jour) sont rendus.
    await reset();
    await db.exec(`UPDATE clubs SET plan='internal'`);
    for (let i = 0; i < 7; i++) { await club(); assert.equal(await fail(101, id(1), true), true); await age(); }
    assert.equal((await db.query('SELECT count(*)::int AS n FROM team_tenup_club_imports')).rows[0].n, 0);
    assert.equal(await counted(), 0);

    // internal (le CAC) : pas de plafond journalier, échecs compris.
    await reset();
    await db.exec(`INSERT INTO team_tenup_competition_requests(actor_id,club_id,created_at,failed) SELECT '${id(106)}','${id(2)}',now()-interval '2 hours',true FROM generate_series(1,100);`);
    assert.equal((await read(106, id(2), id(20)))[0].ok, true);
  } finally { await db.close(); }
});
