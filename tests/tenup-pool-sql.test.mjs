import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { JSDOM } from 'jsdom';
import { extractTenupPoolRound } from '../services/tenup-worker/parse-pool.mjs';
import { PGlite } from '@electric-sql/pglite';
import { coursesFixtureSQL, id } from './helpers/courses-fixture.mjs';
const migration = async (name) =>
  readFile(
    new URL(`../supabase/migrations/${name}.sql`, import.meta.url),
    'utf8'
  );

test('team creation imports a trusted snapshot atomically and permits both club teams in one division', async () => {
  const db = new PGlite();
  try {
    await db.exec(coursesFixtureSQL);
    await db.exec(`CREATE TABLE events(id uuid PRIMARY KEY);
   CREATE FUNCTION set_updated_at() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN NEW.updated_at=now(); RETURN NEW; END $$;
   CREATE FUNCTION can_manage_club_content(cid uuid) RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER AS $$ SELECT EXISTS(SELECT 1 FROM club_members WHERE club_id=cid AND user_id=auth.uid() AND role IN ('admin','manager')) $$;`);
    await db.exec(
      (await migration('20260423_live_matches')).replace(
        'ALTER PUBLICATION supabase_realtime ADD TABLE live_matches;',
        ''
      )
    );
    await db.exec(await migration('20260606_team_matches'));
    await db.exec(await migration('20260628_team_rencontres_wo'));
    const tables = [
      'live_matches',
      'team_saisons',
      'team_competitions',
      'team_equipes',
      'team_etapes',
      'team_rencontres',
      'team_match_lines',
    ];
    for (const table of tables) {
      await db.exec(`ALTER TABLE ${table} ADD COLUMN club_id uuid NOT NULL DEFAULT '${id(1)}';
    CREATE POLICY test_tenant ON ${table} AS RESTRICTIVE FOR ALL TO authenticated USING(club_id IN (SELECT club_id FROM club_members WHERE user_id=auth.uid())) WITH CHECK(club_id IN (SELECT club_id FROM club_members WHERE user_id=auth.uid()));
    GRANT SELECT ON ${table} TO anon;`);
      if (table !== 'team_match_lines')
        await db.exec(
          `CREATE POLICY test_read ON ${table} FOR SELECT TO anon USING(true);`
        );
    }
    await db.exec(`GRANT SELECT ON club_members TO authenticated;
   GRANT SELECT,INSERT,UPDATE,DELETE ON live_matches TO authenticated;
   ALTER TABLE live_matches ADD COLUMN court text,ADD COLUMN started_at timestamptz,ADD COLUMN retired_player live_match_winner;
   CREATE POLICY test_line_insert ON team_match_lines AS RESTRICTIVE FOR INSERT TO authenticated WITH CHECK(can_manage_club_content(club_id));
   CREATE POLICY test_line_update ON team_match_lines AS RESTRICTIVE FOR UPDATE TO authenticated USING(can_manage_club_content(club_id)) WITH CHECK(can_manage_club_content(club_id));
   CREATE POLICY test_line_delete ON team_match_lines AS RESTRICTIVE FOR DELETE TO authenticated USING(can_manage_club_content(club_id));
   INSERT INTO team_saisons(id,label) VALUES('${id(10)}','2026');
   INSERT INTO team_competitions(id,saison_id,nom,type,genre,categorie,format) VALUES('${id(11)}','${id(10)}','Interclubs','adultes','hommes','seniors','3S1D2');
   INSERT INTO team_equipes(id,competition_id,division,nb_journees_poule) VALUES('${id(12)}','${id(11)}','R1A',2);
   INSERT INTO team_etapes(id,equipe_id,phase,numero_journee) VALUES('${id(13)}','${id(12)}','poule',1);
   INSERT INTO team_rencontres(id,etape_id,club_adverse,date_heure,domicile) VALUES('${id(14)}','${id(13)}','Adversaires','2026-09-23 09:00+02',true);`);
    await db.exec(await migration('20260907_live_match_consistency'));
    await db.exec(await migration('2026092101_team_scoring_rules'));
    await db.exec(await migration('2026092401_team_match_commands'));
    await db.exec(await migration('2026092601_team_format_3s1d'));
    assert.deepEqual(
      (await db.query("SELECT team_format_spec('3S1D') AS spec")).rows[0].spec,
      [3, 1, 1]
    );
    await db.exec(`UPDATE team_competitions SET format='3S1D' WHERE id='${id(11)}';
    UPDATE team_competitions SET format='3S1D2' WHERE id='${id(11)}';`);
    await db.exec(
      `UPDATE team_competitions SET singles_set3_format='super_tiebreak' WHERE id='${id(11)}'`
    );
    async function as(user, sql, args = []) {
      await db.exec(
        `BEGIN; SET LOCAL ROLE ${user === null ? 'anon' : 'authenticated'}; SELECT set_config('request.jwt.claim.sub','${user === null ? '' : id(user)}',true);`
      );
      try {
        const r = await db.query(sql, args);
        await db.exec('COMMIT');
        return r.rows;
      } catch (e) {
        await db.exec('ROLLBACK');
        throw e;
      }
    }

    await db.exec('CREATE ROLE service_role');
    await db.exec(await migration('2026092901_tenup_sync'));
    await db.exec(await migration('2026100101_admin_competitions'));
    await db.exec(await migration('2026100102_tenup_team_calendar'));
    await db.exec(await migration('2026100103_team_numbers_not_unique'));
    const url =
      'https://tenup.fft.fr/championnat/82678463?division=144146&phase=233672&poule=513524';
    const doc = new JSDOM(
      await readFile(
        new URL('./fixtures/tenup-pool.html', import.meta.url),
        'utf8'
      )
    ).window.document;
    const { round, ...info } = extractTenupPoolRound(doc);
    const pool = { ...info, rounds: [round] };
    const begin = (user = 101, club = id(1), comp = id(11)) =>
      as(user, 'SELECT team_tenup_pool_begin($1,$2,$3) AS id', [
        club,
        comp,
        url,
      ]).then((r) => r[0].id);
    const attach = (pid, payload = pool) =>
      db.query('UPDATE team_tenup_pool_previews SET payload=$1 WHERE id=$2', [
        payload,
        pid,
      ]);
    const create = (pid, team = '2474059', num = 2, user = 101) =>
      as(user, 'SELECT team_equipe_create($1,$2,$3,$4,$5,$6,$7) AS id', [
        id(1),
        id(11),
        num,
        'Client false division',
        30,
        pid,
        team,
      ]).then((r) => r[0].id);
    await assert.rejects(begin(103), /Administration/);
    await assert.rejects(begin(106), /Administration/);
    await assert.rejects(begin(null), /permission denied/);
    await assert.rejects(begin(101, id(2)), /Administration/);
    const pid = await begin();
    await assert.rejects(create(pid), /incomplet/);
    await attach(pid);
    await assert.rejects(create(pid, '999'), /Sélectionnez/);
    await assert.rejects(create(pid, '2474059', 2, 102), /introuvable/);
    await assert.rejects(
      as(101, 'UPDATE team_tenup_pool_previews SET payload=$1 WHERE id=$2', [
        pool,
        pid,
      ]),
      /permission denied/
    );
    const eid = await create(pid);
    assert.equal(await create(pid), eid, 'retry returns the same team');
    const team = (
      await db.query('SELECT * FROM team_equipes WHERE id=$1', [eid])
    ).rows[0];
    assert.equal(team.division, 'GROUPE B');
    assert.equal(team.nb_journees_poule, 1);
    assert.equal(team.tenup_team_name, 'CASTELSARRASIN TENNIS CLUB 1');
    const r = (
      await db.query(
        'SELECT r.* FROM team_rencontres r JOIN team_etapes e ON e.id=r.etape_id WHERE e.equipe_id=$1',
        [eid]
      )
    ).rows[0];
    assert.equal(r.club_adverse, 'AUCAMVILLE TENNIS CLUB 1');
    assert.equal(r.domicile, true);
    assert.equal(r.tenup_side, 0);
    assert.equal(r.score_club, null);
    assert.equal(r.tenup_synced_at, null);
    assert.equal(
      new Date(r.date_heure).toISOString(),
      '2026-10-03T22:00:00.000Z'
    );
    const pid2 = await begin();
    await attach(pid2);
    await assert.rejects(create(pid2), /déjà ajoutée/);
    const eid2 = await create(pid2, '2476260', 2);
    assert.equal((await db.query('SELECT count(*)::int AS n FROM team_equipes WHERE competition_id=$1 AND numero=2', [id(11)])).rows[0].n, 2, 'distinct TenUp teams may share a number');
    assert.notEqual(eid, eid2);
    const rr = (
      await db.query(
        'SELECT r.* FROM team_rencontres r JOIN team_etapes e ON e.id=r.etape_id WHERE e.equipe_id=$1',
        [eid2]
      )
    ).rows[0];
    assert.equal(rr.tenup_url, r.tenup_url);
    assert.equal(rr.tenup_side, 1);
    assert.equal(rr.domicile, false);
    for (const encounter of [r, rr])
      assert.ok(
        (
          await as(103, 'SELECT team_tenup_begin($1,$2,$3) AS value', [
            id(1),
            encounter.id,
            encounter.tenup_url,
          ])
        )[0].value.id,
        'both sides can subsequently synchronize their results'
      );
    await db.exec(
      "UPDATE team_tenup_competition_requests SET created_at=now()-interval '2 minutes'"
    );
    const pid3 = await begin();
    const broken = structuredClone(pool);
    broken.rounds[0].matches[0].date = 'impossible';
    await attach(pid3, broken);
    const count = async () =>
      Number(
        (await db.query('SELECT count(*) AS n FROM team_equipes')).rows[0].n
      );
    const before = await count();
    await assert.rejects(create(pid3, '2483253', 4), /date/);
    assert.equal(
      await count(),
      before,
      'late encounter failure rolls back the team and rounds'
    );
    await db.query(
      "UPDATE team_tenup_pool_previews SET created_at=now()-interval '1 hour' WHERE id=$1",
      [pid3]
    );
    await assert.rejects(create(pid3, '2483253', 4), /expiré/);
    const manual = (division, days, num = 4, user = 101) =>
      as(user, 'SELECT team_equipe_create($1,$2,$3,$4,$5) AS id', [
        id(1),
        id(11),
        num,
        division,
        days,
      ]);
    const mid = (await manual('Groupe libre', 3))[0].id;
    assert.equal(
      (
        await db.query(
          'SELECT count(*)::int AS n FROM team_etapes WHERE equipe_id=$1',
          [mid]
        )
      ).rows[0].n,
      3
    );
    const duplicateNumberId = (await manual('Groupe libre', 3))[0].id;
    assert.notEqual(duplicateNumberId, mid, 'manual teams may share both number and division');
    await assert.rejects(manual(' ', 3, 5), /Division/);
    await assert.rejects(manual('Groupe A', 0, 5), /Division/);
    await assert.rejects(manual('Groupe A', 3, 5, 103), /Administration/);
  } finally {
    await db.close();
  }
});
