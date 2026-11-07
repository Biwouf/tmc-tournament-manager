// SaaS S6 — plafond de lectures Ten'Up d'un club en essai (2026110701_tenup_trial_cap).
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { PGlite } from '@electric-sql/pglite';
import { coursesFixtureSQL, id } from './helpers/courses-fixture.mjs';
const migration = name => readFile(new URL(`../supabase/migrations/${name}.sql`, import.meta.url), 'utf8');

test('trial clubs share a 20 reads / 24 h Ten’Up cap; internal and saison clubs are untouched', async () => {
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
    // Lignes d'avant la migration : sans club.
    await db.exec(`INSERT INTO team_tenup_competition_requests(actor_id,created_at) SELECT '${id(101)}',now()-interval '2 hours' FROM generate_series(1,25)`);
    await db.exec(await migration('2026110701_tenup_trial_cap'));
    await db.exec(await migration('2026110701_tenup_trial_cap')); // idempotente

    async function as(user, sql, args = []) {
      await db.exec(`BEGIN; SET LOCAL ROLE authenticated; SELECT set_config('request.jwt.claim.sub','${id(user)}',true);`);
      try { const result = await db.query(sql, args); await db.exec('COMMIT'); return result.rows; }
      catch (err) { await db.exec('ROLLBACK'); throw err; }
    }
    const url = 'https://tenup.fft.fr/championnat/82678463?division=144146&phase=233672&poule=513524';
    const begin = (user, club, season) => as(user, 'SELECT team_tenup_competition_begin($1,$2,$3) AS ok', [club, season, url]);
    // Vieillit les lectures : le quota par minute ne gêne plus, seul le plafond journalier compte.
    const age = (interval) => db.exec(`UPDATE team_tenup_competition_requests SET created_at=now()-interval '${interval}' WHERE created_at>now()-interval '1 minute'`);
    const count = async (club) => (await db.query(`SELECT count(*)::int AS n FROM team_tenup_competition_requests WHERE club_id='${club}'`)).rows[0].n;

    // Club 1 en essai : 20 lectures, partagées par l'admin et le gestionnaire.
    await db.exec(`UPDATE clubs SET plan='trial' WHERE id='${id(1)}'`);
    for (let i = 0; i < 10; i++) { await begin(101, id(1), id(10)); await age('2 minutes'); }
    for (let i = 0; i < 10; i++) { await begin(102, id(1), id(10)); await age('2 minutes'); }
    assert.equal(await count(id(1)), 20);
    await assert.rejects(begin(101, id(1), id(10)), /Limite de l’essai atteinte : 20 lectures Ten’Up par 24 heures/);
    await assert.rejects(begin(102, id(1), id(10)), /Limite de l’essai atteinte/);
    assert.equal(await count(id(1)), 20, 'a refused read is not counted');
    // Le quota par minute passe avant le plafond, inchangé.
    await db.exec(`DELETE FROM team_tenup_competition_requests WHERE club_id='${id(1)}'`);
    await begin(101, id(1), id(10)); await begin(101, id(1), id(10)); await begin(101, id(1), id(10));
    await assert.rejects(begin(101, id(1), id(10)), /Réessayez dans une minute/);
    // Fenêtre glissante : des lectures de plus de 24 h ne comptent plus.
    await db.exec(`DELETE FROM team_tenup_competition_requests WHERE club_id='${id(1)}';
      INSERT INTO team_tenup_competition_requests(actor_id,club_id,created_at) SELECT '${id(102)}','${id(1)}',now()-interval '25 hours' FROM generate_series(1,30);
      INSERT INTO team_tenup_competition_requests(actor_id,club_id,created_at) SELECT '${id(102)}','${id(1)}',now()-interval '23 hours' FROM generate_series(1,19);`);
    assert.equal((await begin(101, id(1), id(10)))[0].ok, true);
    await age('2 minutes');
    await assert.rejects(begin(101, id(1), id(10)), /Limite de l’essai/);

    // Club 2 internal (le CAC) : aucun plafond, même au-delà de 20 lectures.
    for (let i = 0; i < 25; i++) { await begin(106, id(2), id(20)); await age('2 minutes'); }
    assert.equal(await count(id(2)), 25);
    // Un club passé en saison n'est plus plafonné.
    await db.exec(`UPDATE clubs SET plan='saison' WHERE id='${id(1)}'`);
    assert.equal((await begin(101, id(1), id(10)))[0].ok, true);

    // Contrôles existants inchangés.
    await assert.rejects(begin(103, id(1), id(10)), /Administration/);
    await assert.rejects(begin(101, id(1), id(20)), /Saison introuvable/);
    await assert.rejects(as(101, 'SELECT * FROM team_tenup_competition_requests'), /permission denied/);
  } finally { await db.close(); }
});
