// SaaS S6b — lecture de la page club, fenêtre d'import à 15 lectures/minute, plafond d'essai à 40.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { PGlite } from '@electric-sql/pglite';
import { coursesFixtureSQL, id } from './helpers/courses-fixture.mjs';
const migration = name => readFile(new URL(`../supabase/migrations/${name}.sql`, import.meta.url), 'utf8');

test('club import: one counted read opens a 10-minute window at 15 reads/minute; trial cap 40; internal untouched', async () => {
  const db = new PGlite();
  try {
    await db.exec(coursesFixtureSQL);
    await db.exec(`ALTER TABLE clubs ADD COLUMN plan text NOT NULL DEFAULT 'internal';
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
    await db.exec(await migration('2026110920_tenup_club_import')); // idempotente

    async function as(user, sql, args = []) {
      await db.exec(`BEGIN; SET LOCAL ROLE authenticated; SELECT set_config('request.jwt.claim.sub','${id(user)}',true);`);
      try { const result = await db.query(sql, args); await db.exec('COMMIT'); return result.rows; }
      catch (err) { await db.exec('ROLLBACK'); throw err; }
    }
    const CLUB_URL = 'https://tenup.fft.fr/club/60820056/competitions/rencontres';
    const POOL = 'https://tenup.fft.fr/championnat/82678463?division=144146&phase=233672&poule=513524';
    const club = (user = 101, clubId = id(1), url = CLUB_URL) => as(user, 'SELECT team_tenup_club_begin($1,$2) AS ok', [clubId, url]);
    const read = (user = 101, clubId = id(1), season = id(10)) => as(user, 'SELECT team_tenup_competition_begin($1,$2,$3) AS ok', [clubId, season, POOL]);
    const count = async (clubId) => (await db.query(`SELECT count(*)::int AS n FROM team_tenup_competition_requests WHERE club_id='${clubId}'`)).rows[0].n;
    const reset = () => db.exec('DELETE FROM team_tenup_competition_requests; DELETE FROM team_tenup_club_imports;');

    // Accès et lien.
    for (const user of [103, 106]) await assert.rejects(club(user), /Administration/);
    for (const url of ['https://tenup.fft.fr/club/60820056', 'https://evil.test/club/1/competitions/rencontres', `${CLUB_URL}?x=1`]) await assert.rejects(club(101, id(1), url), /Lien du club/);
    await assert.rejects(as(101, 'SELECT team_tenup_read_begin($1)', [id(1)]), /permission denied/, 'internal helper');
    await assert.rejects(as(101, 'SELECT * FROM team_tenup_club_imports'), /permission denied/);

    // Sans import : 3 lectures par minute, comme avant.
    await read(); await read(); await read();
    await assert.rejects(read(), /Réessayez dans une minute/);
    await reset();
    // Avec import : la page club compte, puis 14 lectures de plus dans la minute.
    assert.equal((await club())[0].ok, true);
    for (let i = 0; i < 14; i++) await read();
    assert.equal(await count(id(1)), 15);
    await assert.rejects(read(), /Réessayez dans une minute/);
    // La fenêtre est propre au compte et au club : le gestionnaire reste à 3 / minute.
    await read(102); await read(102); await read(102);
    await assert.rejects(read(102), /Réessayez dans une minute/);
    // Fenêtre expirée au bout de 10 minutes.
    await reset();
    await club();
    await db.exec(`UPDATE team_tenup_club_imports SET created_at = now() - interval '11 minutes'`);
    await read(); await read();
    await assert.rejects(read(), /Réessayez dans une minute/);

    // Plafond d'essai à 40, partagé par le club, la page club comprise.
    await reset();
    await db.exec(`UPDATE clubs SET plan='trial' WHERE id='${id(1)}';
      INSERT INTO team_tenup_competition_requests(actor_id,club_id,created_at) SELECT '${id(102)}','${id(1)}',now()-interval '2 hours' FROM generate_series(1,39);`);
    await club();
    assert.equal(await count(id(1)), 40);
    await assert.rejects(read(), /Limite de l’essai atteinte : 40 lectures/);
    await assert.rejects(club(), /Limite de l’essai/);
    assert.equal(await count(id(1)), 40, 'refused reads are not counted');

    // Cinq imports de club par jour et par compte.
    await reset();
    await db.exec(`UPDATE clubs SET plan='internal'`);
    for (let i = 0; i < 5; i++) { await club(); await db.exec(`UPDATE team_tenup_competition_requests SET created_at = now() - interval '2 minutes'`); }
    await assert.rejects(club(), /Trop d’imports de club/);
    assert.equal((await db.query('SELECT count(*)::int AS n FROM team_tenup_club_imports')).rows[0].n, 5, 'refused import leaves nothing');

    // CAC (internal) : aucun plafond journalier.
    await reset();
    await db.exec(`INSERT INTO team_tenup_competition_requests(actor_id,club_id,created_at) SELECT '${id(106)}','${id(2)}',now()-interval '2 hours' FROM generate_series(1,100);`);
    assert.equal((await club(106, id(2)))[0].ok, true);
    assert.equal((await read(106, id(2), id(20)))[0].ok, true);
  } finally { await db.close(); }
});
