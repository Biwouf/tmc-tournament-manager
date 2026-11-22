// P0-b du brief « Mon compte » : account_save_profile et les champs ajoutés à course_my_context.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { PGlite } from '@electric-sql/pglite';
import { id, coursesFixtureSQL } from './helpers/courses-fixture.mjs';

const migration = (file) => readFile(new URL('../supabase/migrations/' + file, import.meta.url), 'utf8');

async function fixture() {
  const db = new PGlite();
  await db.exec(coursesFixtureSQL);
  await db.exec("ALTER TABLE auth.users ADD COLUMN email text, ADD COLUMN raw_user_meta_data jsonb DEFAULT '{}';");
  for (const file of ['2026091001_courses.sql', '2026091002_courses_pwa.sql', '2026091101_course_owner_identity.sql', '2026091602_pwa_signup.sql'])
    await db.exec(await migration(file));
  // Tables d'équipes réduites aux colonnes lues par course_my_context.
  await db.exec(`
    CREATE TABLE team_saisons(id uuid PRIMARY KEY, club_id uuid, actif boolean NOT NULL DEFAULT false);
    CREATE TABLE team_competitions(id uuid PRIMARY KEY, club_id uuid, saison_id uuid REFERENCES team_saisons(id), genre text, categorie text);
    CREATE TABLE team_equipes(id uuid PRIMARY KEY, club_id uuid, competition_id uuid REFERENCES team_competitions(id), numero integer);
    CREATE TABLE team_equipe_captains(club_id uuid, equipe_id uuid REFERENCES team_equipes(id), user_id uuid, PRIMARY KEY(equipe_id, user_id));
  `);
  await db.exec(await migration('2026112102_account_hub.sql'));
  async function rpc(user, name, args) {
    await db.exec(`BEGIN; SET LOCAL ROLE ${user ? 'authenticated' : 'anon'}; SELECT set_config('request.jwt.claim.sub','${user ? id(user) : ''}',true);`);
    try {
      const result = await db.query(`SELECT ${name}(${args.map((_, i) => '$' + (i + 1)).join(',')}) result`, args);
      await db.exec('COMMIT');
      return result.rows[0].result;
    } catch (e) { await db.exec('ROLLBACK'); throw e; }
  }
  const context = (user) => rpc(user, 'course_my_context', [id(1)]);
  return { db, rpc, context };
}

test('account_save_profile : un compte en attente complète son profil, sans droit de membre', async () => {
  const f = await fixture();
  try {
    // 106 est admin du club 2 seulement : demande en attente dans le club 1.
    await f.db.query("INSERT INTO club_signup_requests(club_id,user_id,status) VALUES($1,$2,'pending')", [id(1), id(106)]);
    const before = await f.context(106);
    assert.equal(before.is_member, false);
    assert.equal(before.signup_status, 'pending');
    assert.ok(before.signup_requested_at);
    await assert.rejects(f.rpc(106, 'course_save_my_profile', [id(1), 'A', 'B', 'female', 0, id(9990)]), /FORBIDDEN/);

    const saved = await f.rpc(106, 'account_save_profile', ['  Léa ', ' Martin ', 'female', before.profile.revision, '15/4']);
    assert.equal(saved.revision, before.profile.revision + 1);
    const after = await f.context(106);
    assert.deepEqual(
      { prenom: after.profile.prenom, nom: after.profile.nom, sex: after.profile.sex, classement: after.profile.classement },
      { prenom: 'Léa', nom: 'Martin', sex: 'female', classement: '15/4' },
    );
    assert.equal(after.is_member, false);
    assert.equal((await f.db.query('SELECT count(*)::int n FROM club_members WHERE user_id=$1 AND club_id=$2', [id(106), id(1)])).rows[0].n, 0);
  } finally { await f.db.close(); }
});

test('account_save_profile : révision, validation, classement gardé ou effacé, anon refusé', async () => {
  const f = await fixture();
  try {
    const rev = (await f.context(103)).profile.revision;
    await f.rpc(103, 'account_save_profile', ['Léa', 'Martin', 'female', rev, '30/1']);
    await assert.rejects(f.rpc(103, 'account_save_profile', ['Léa', 'Martin', 'female', rev, '30/1']), /VERSION_CONFLICT/);
    // '__keep__' (défaut) garde le classement ; '' l'efface.
    await f.rpc(103, 'account_save_profile', ['Léa', 'Martin', 'male', rev + 1]);
    assert.equal((await f.context(103)).profile.classement, '30/1');
    await f.rpc(103, 'account_save_profile', ['Léa', 'Martin', 'male', rev + 2, '']);
    assert.equal((await f.context(103)).profile.classement, null);
    for (const args of [[' ', 'Martin', 'male', rev + 3], ['Léa', 'Martin', 'other', rev + 3]])
      await assert.rejects(f.rpc(103, 'account_save_profile', args), /VALIDATION_ERROR/);
    await assert.rejects(f.rpc(103, 'account_save_profile', ['Léa', 'Martin', 'male', rev + 3, 'invalide']), /check constraint|violates/);
    await assert.rejects(f.rpc(null, 'account_save_profile', ['Léa', 'Martin', 'male', 0]), /permission denied|FORBIDDEN/);
  } finally { await f.db.close(); }
});

test('course_my_context : équipes de la saison active dont on est capitaine, dans ce club', async () => {
  const f = await fixture();
  try {
    await f.db.exec(`
      INSERT INTO team_saisons VALUES ($1,$4,true), ($2,$4,false), ($3,$5,true);
      INSERT INTO team_competitions VALUES ($6,$4,$1,'hommes','35_ans'), ($7,$4,$2,'femmes','seniors'), ($8,$5,$3,'hommes','seniors');
      INSERT INTO team_equipes VALUES ($9,$4,$6,2), ($10,$4,$7,1), ($11,$5,$8,1);
      INSERT INTO team_equipe_captains VALUES ($4,$9,$12), ($4,$10,$12), ($5,$11,$12);
    `.replace(/\$(\d+)/g, (_, n) => `'${[id(501), id(502), id(503), id(1), id(2), id(601), id(602), id(603), id(701), id(702), id(703), id(103)][n - 1]}'`));
    assert.deepEqual((await f.context(103)).captain_teams, [{ genre: 'hommes', categorie: '35_ans', numero: 2 }]);
    assert.deepEqual((await f.context(104)).captain_teams, []);
    assert.equal((await f.context(103)).signup_requested_at, null);
  } finally { await f.db.close(); }
});
