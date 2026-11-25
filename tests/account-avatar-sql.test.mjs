// P1-a du brief « Mon compte » : colonnes, bucket privé `avatars`, verrou mineurs, RPC (2026112530).
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { PGlite } from '@electric-sql/pglite';
import { id, coursesFixtureSQL } from './helpers/courses-fixture.mjs';

const migration = (file) => readFile(new URL('../supabase/migrations/' + file, import.meta.url), 'utf8');
const YEAR = Number(new Intl.DateTimeFormat('fr-FR', { timeZone: 'Europe/Paris', year: 'numeric' }).format(new Date()));
const ADULT = YEAR - 30, MINOR = YEAR - 16;
const V1 = id(9001), V2 = id(9002);
const file = (user, version, size) => `${id(user)}/${version}-${size}`;

// Fixture : 101 admin, 102 à 105 dans le club 1 ; 106 admin du club 2 ; 107 admin du club 3 (suspendu) ; 108 super-admin.
async function fixture() {
  const db = new PGlite();
  await db.exec(coursesFixtureSQL);
  await db.exec("ALTER TABLE auth.users ADD COLUMN email text, ADD COLUMN raw_user_meta_data jsonb DEFAULT '{}';");
  for (const name of ['2026091001_courses.sql', '2026091002_courses_pwa.sql', '2026091101_course_owner_identity.sql', '2026091602_pwa_signup.sql', '2026092001_signup_profile_fix.sql'])
    await db.exec(await migration(name));
  await db.exec(`
    CREATE TABLE team_saisons(id uuid PRIMARY KEY, actif boolean);
    CREATE TABLE team_competitions(id uuid PRIMARY KEY, saison_id uuid, genre text, categorie text);
    CREATE TABLE team_equipes(id uuid PRIMARY KEY, competition_id uuid, numero integer);
    CREATE TABLE team_equipe_captains(club_id uuid, equipe_id uuid, user_id uuid);
    -- Droits par défaut d'un projet Supabase : la RLS et les REVOKE sont la seule barrière.
    ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON FUNCTIONS TO anon, authenticated;
    ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON TABLES TO anon, authenticated;
    GRANT SELECT, INSERT, UPDATE, DELETE ON storage.objects TO anon;
    GRANT ALL ON profile_details TO anon, authenticated;
    UPDATE auth.users SET email = 'u' || right(id::text, 3) || '@example.test';
  `);
  await db.exec(await migration('2026112102_account_hub.sql'));
  await db.exec(await migration('2026112530_avatars.sql'));

  async function as(user, sql, args = []) {
    await db.exec(`BEGIN; SET LOCAL ROLE ${user ? 'authenticated' : 'anon'}; SELECT set_config('request.jwt.claim.sub','${user ? id(user) : ''}',true);`);
    try {
      const result = await db.query(sql, args);
      await db.exec('COMMIT');
      return result.rows;
    } catch (e) { await db.exec('ROLLBACK'); throw e; }
  }
  const rpc = async (user, name, args = []) =>
    (await as(user, `SELECT ${name}(${args.map((_, i) => '$' + (i + 1)).join(',')}) result`, args))[0].result;
  const put = (user, name, bucket = 'avatars') => as(user, 'INSERT INTO storage.objects(bucket_id,name) VALUES($1,$2)', [bucket, name]);
  const read = async (user) => (await as(user, "SELECT name FROM storage.objects WHERE bucket_id='avatars' ORDER BY name")).map((r) => r.name);
  /** Photo complète de `user` : année, deux fichiers, chemin. */
  async function photo(user, version = V1, year = ADULT) {
    await rpc(user, 'profile_set_birth_year', [year]);
    for (const size of [128, 512]) await put(user, file(user, version, size));
    return rpc(user, 'profile_set_avatar', [version]);
  }
  return { db, as, rpc, put, read, photo };
}
const run = (name, body) => test(name, async () => {
  const f = await fixture();
  try { await body(f); } finally { await f.db.close(); }
});
const RLS = /row-level security/;

run('bucket privé, types et taille limités ; aucune policy de modification', async ({ db }) => {
  const [bucket] = (await db.query("SELECT public, file_size_limit, allowed_mime_types FROM storage.buckets WHERE id='avatars'")).rows;
  assert.deepEqual({ ...bucket, file_size_limit: Number(bucket.file_size_limit) }, { public: false, file_size_limit: 307200, allowed_mime_types: ['image/webp', 'image/jpeg'] });
  const policies = (await db.query("SELECT cmd, roles::text FROM pg_policies WHERE schemaname='storage' AND policyname LIKE 'avatars%' ORDER BY cmd")).rows;
  assert.deepEqual(policies, [{ cmd: 'DELETE', roles: '{authenticated}' }, { cmd: 'INSERT', roles: '{authenticated}' }, { cmd: 'SELECT', roles: '{authenticated}' }]);
});

run('lecture : co-membre, soi et super-admin ; jamais anon, ni sans club actif commun', async (f) => {
  await f.photo(103);
  const both = [file(103, V1, 128), file(103, V1, 512)];
  for (const user of [103, 104, 101, 108]) assert.deepEqual(await f.read(user), both, String(user));
  for (const user of [106, 107, null]) assert.deepEqual(await f.read(user), [], String(user));
  // Club commun suspendu : rien.
  await f.db.query('INSERT INTO club_members(club_id,user_id,role) VALUES($1,$2,$3)', [id(3), id(103), 'member']);
  assert.deepEqual(await f.read(107), []);
  // Un membre qui quitte le club ne lit plus ; un deuxième club commun suffit.
  await f.db.query('DELETE FROM club_members WHERE club_id=$1 AND user_id=$2', [id(1), id(104)]);
  assert.deepEqual(await f.read(104), []);
  await f.db.query('INSERT INTO club_members(club_id,user_id,role) VALUES($1,$2,$3)', [id(2), id(103), 'member']);
  assert.deepEqual(await f.read(106), both);
});

run('seule la photo en cours est lisible des autres ; retirée, elle ne l’est plus du tout', async (f) => {
  await f.photo(103);
  for (const size of [128, 512]) await f.put(103, file(103, V2, size));
  assert.deepEqual(await f.read(104), [file(103, V1, 128), file(103, V1, 512)]);
  assert.equal(await f.rpc(103, 'profile_set_avatar', [V2]), `${id(103)}/${V1}`);
  assert.deepEqual(await f.read(104), [file(103, V2, 128), file(103, V2, 512)]);
  assert.equal((await f.read(103)).length, 4);
  assert.equal(await f.rpc(103, 'profile_clear_avatar'), `${id(103)}/${V2}`);
  assert.deepEqual(await f.read(104), []);
  assert.deepEqual(await f.read(108), []);
  assert.equal((await f.read(103)).length, 4);
  // Annuler : l'ancienne version se repose tant que ses fichiers existent.
  assert.equal(await f.rpc(103, 'profile_set_avatar', [V2]), null);
  assert.deepEqual(await f.read(104), [file(103, V2, 128), file(103, V2, 512)]);
  assert.equal(await f.rpc(103, 'profile_set_avatar', [V2]), null);
});

run('envoi : son dossier seulement, noms imposés, jamais de modification', async (f) => {
  await f.rpc(103, 'profile_set_birth_year', [ADULT]);
  await f.put(103, file(103, V1, 512));
  for (const name of [file(104, V1, 512), file(103, V1, 256), `${file(103, V1, 512)}.jpg`, `${id(103)}/libre`, `${id(103)}/x/${V1}-512`, 'pas-un-uuid/x', 'racine', ''])
    await assert.rejects(f.put(103, name), RLS, name);
  await assert.rejects(f.put(103, file(103, V1, 512), 'autre'), RLS);
  await assert.rejects(f.put(null, file(103, V1, 512)), RLS);
  assert.deepEqual(await f.as(103, "UPDATE storage.objects SET name=$1 RETURNING name", [file(103, V2, 512)]), []);
  // Supprimer : les siens seulement.
  assert.deepEqual(await f.as(104, 'DELETE FROM storage.objects RETURNING name'), []);
  assert.deepEqual(await f.as(null, 'DELETE FROM storage.objects RETURNING name'), []);
  assert.equal((await f.as(103, 'DELETE FROM storage.objects RETURNING name')).length, 1);
});

run('un nom de fichier invalide déjà en base ne fait pas échouer la lecture', async (f) => {
  await f.photo(103);
  await f.db.query("INSERT INTO storage.objects(bucket_id,name) VALUES('avatars','pas-un-uuid/x-512'),('avatars','racine'),('avatars','')");
  assert.equal((await f.read(104)).length, 2);
  assert.equal((await f.read(108)).length, 2);
});

run('mineurs : envoi refusé, y compris sans année renseignée ni ligne de profil', async (f) => {
  await assert.rejects(f.put(103, file(103, V1, 512)), RLS);
  await f.rpc(103, 'account_save_profile', ['Léa', 'Martin', 'female', 0]);
  await assert.rejects(f.put(103, file(103, V1, 512)), RLS);
  await f.rpc(103, 'profile_set_birth_year', [MINOR]);
  await assert.rejects(f.put(103, file(103, V1, 512)), RLS);
  await assert.rejects(f.rpc(103, 'profile_set_avatar', [V1]), /AVATAR_LOCKED/);
  // Même avec les fichiers (posés hors de l'interface), le chemin ne se pose pas.
  for (const size of [128, 512]) await f.db.query("INSERT INTO storage.objects(bucket_id,name) VALUES('avatars',$1)", [file(103, V1, size)]);
  await assert.rejects(f.rpc(103, 'profile_set_avatar', [V1]), /AVATAR_LOCKED/);
});

run('mineur : règle prudente, majeur à partir de 19 ans dans l’année', async (f) => {
  for (const [user, years, ok] of [[103, 18, false], [104, 19, true]]) {
    await f.rpc(user, 'profile_set_birth_year', [YEAR - years]);
    await (ok ? f.put(user, file(user, V1, 512)) : assert.rejects(f.put(user, file(user, V1, 512)), RLS));
  }
});

run('année corrigée par l’admin : la photo n’est plus lue que de soi et des super-admins', async (f) => {
  await f.photo(103);
  await f.rpc(101, 'club_member_set_birth_year', [id(1), id(103), MINOR]);
  for (const user of [101, 102, 104, 106, null]) assert.deepEqual(await f.read(user), [], String(user));
  for (const user of [103, 108]) assert.equal((await f.read(user)).length, 2, String(user));
  // La personne peut toujours retirer sa photo et supprimer ses fichiers.
  assert.equal(await f.rpc(103, 'profile_clear_avatar'), `${id(103)}/${V1}`);
  assert.equal((await f.as(103, "DELETE FROM storage.objects WHERE bucket_id='avatars' RETURNING name")).length, 2);
});

run('année : une seule saisie, rejouable à l’identique, bornée', async (f) => {
  for (const year of [1899, YEAR + 1, null]) await assert.rejects(f.rpc(103, 'profile_set_birth_year', [year]), /VALIDATION_ERROR/);
  assert.equal(await f.rpc(103, 'profile_set_birth_year', [MINOR]), MINOR);
  assert.equal(await f.rpc(103, 'profile_set_birth_year', [MINOR]), MINOR);
  await assert.rejects(f.rpc(103, 'profile_set_birth_year', [ADULT]), /BIRTH_YEAR_LOCKED/);
  // Ni écriture directe de la table, malgré les droits par défaut (aucune policy d'écriture).
  assert.deepEqual(await f.as(103, 'UPDATE profile_details SET birth_year=$1 RETURNING 1', [ADULT]), []);
  await assert.rejects(f.as(104, 'INSERT INTO profile_details(user_id,birth_year) VALUES($1,$2)', [id(104), ADULT]), RLS);
  assert.deepEqual(await f.as(103, 'DELETE FROM profile_details RETURNING 1'), []);
  // Enregistrer le profil ne touche pas à l'année, et l'année ne touche pas à la révision.
  await f.rpc(103, 'account_save_profile', ['Léa', 'Martin', 'female', 0]);
  assert.equal((await f.as(103, 'SELECT birth_year FROM profile_details'))[0].birth_year, MINOR);
});

run('année corrigée : admin d’un club actif de la personne, jamais la sienne, journalisée', async (f) => {
  const set = (user, club, target, year = ADULT) => f.rpc(user, 'club_member_set_birth_year', [id(club), id(target), year]);
  for (const [user, club, target] of [[102, 1, 103], [103, 1, 104], [106, 2, 103], [106, 1, 103], [107, 3, 107], [101, 1, 101], [106, 2, 106], [108, 1, 108], [null, 1, 103]])
    await assert.rejects(set(user, club, target), /FORBIDDEN|permission denied/, `${user} → ${target}`);
  for (const year of [1899, YEAR + 1, null]) await assert.rejects(set(101, 1, 103, year), /VALIDATION_ERROR/);
  await set(101, 1, 103, MINOR);
  await set(101, 1, 103, MINOR);
  await set(108, 1, 103, ADULT);
  const events = (await f.db.query('SELECT club_id, user_id, actor_id, action, details FROM profile_admin_events ORDER BY created_at')).rows;
  assert.deepEqual(events, [
    { club_id: id(1), user_id: id(103), actor_id: id(101), action: 'birth_year', details: { from: null, to: MINOR } },
    { club_id: id(1), user_id: id(103), actor_id: id(108), action: 'birth_year', details: { from: MINOR, to: ADULT } },
  ]);
  for (const user of [101, 103, null]) await assert.rejects(f.as(user, 'SELECT * FROM profile_admin_events'), /permission denied/);
});

run('profile_set_avatar : les deux tailles, dans son dossier ; motif de retrait effacé', async (f) => {
  await f.rpc(103, 'profile_set_birth_year', [ADULT]);
  await assert.rejects(f.rpc(103, 'profile_set_avatar', [V1]), /AVATAR_MISSING/);
  await f.put(103, file(103, V1, 512));
  await assert.rejects(f.rpc(103, 'profile_set_avatar', [V1]), /AVATAR_MISSING/);
  await f.put(103, file(103, V1, 128));
  await f.db.query("UPDATE profile_details SET avatar_removed_reason='floue' WHERE user_id=$1", [id(103)]);
  assert.equal(await f.rpc(103, 'profile_set_avatar', [V1]), null);
  const [row] = await f.as(103, 'SELECT avatar_path, avatar_updated_at, avatar_removed_reason FROM profile_details');
  assert.equal(row.avatar_path, `${id(103)}/${V1}`);
  assert.ok(row.avatar_updated_at);
  assert.equal(row.avatar_removed_reason, null);
  await assert.rejects(f.rpc(103, 'profile_set_avatar', [null]), /VALIDATION_ERROR/);
  // Version d'un autre, ou chemin d'un autre posé en base : refusés.
  await f.rpc(104, 'profile_set_birth_year', [ADULT]);
  await assert.rejects(f.rpc(104, 'profile_set_avatar', [V1]), /AVATAR_MISSING/);
  await assert.rejects(f.db.query('UPDATE profile_details SET avatar_path=$1 WHERE user_id=$2', [`${id(103)}/${V2}`, id(104)]), /avatar_path_check/);
});

run('droits : rien pour anon, aucun test d’âge ou de visibilité d’un autre', async (f) => {
  await f.rpc(103, 'profile_set_birth_year', [MINOR]);
  const can = async (role, signature) => (await f.db.query('SELECT has_function_privilege($1,$2,$3) x', [role, signature, 'execute'])).rows[0].x;
  for (const signature of ['is_minor(uuid)', 'avatar_readable(uuid)'])
    for (const role of ['anon', 'authenticated']) assert.equal(await can(role, signature), false, `${role} ${signature}`);
  for (const signature of ['avatar_object_readable(text)', 'avatar_object_writable(text)', 'profile_set_avatar(uuid)', 'profile_clear_avatar()', 'profile_set_birth_year(smallint)', 'club_member_set_birth_year(uuid,uuid,smallint)', 'course_my_context(uuid)']) {
    assert.equal(await can('authenticated', signature), true, signature);
    assert.equal(await can('anon', signature), false, signature);
  }
  const definers = (await f.db.query("SELECT proname FROM pg_proc WHERE proname ~ '^(is_minor|avatar_|profile_set_|profile_clear_|club_member_set_)' AND (NOT prosecdef OR NOT proconfig::text LIKE '%search_path=public, pg_temp%')")).rows;
  assert.deepEqual(definers, []);
  for (const user of [104, 101, 108, null]) assert.deepEqual(await f.as(user, 'SELECT birth_year, avatar_path FROM profile_details'), [], String(user));
});

run('course_my_context : photo, année et e-mail de soi seulement', async (f) => {
  await f.photo(103);
  const { profile } = await f.rpc(103, 'course_my_context', [id(1)]);
  assert.deepEqual({ path: profile.avatar_path, year: profile.birth_year, email: profile.email, revision: profile.revision },
    { path: `${id(103)}/${V1}`, year: ADULT, email: 'u103@example.test', revision: 0 });
  const other = (await f.rpc(104, 'course_my_context', [id(1)])).profile;
  assert.deepEqual([other.avatar_path, other.birth_year, other.email], [null, null, 'u104@example.test']);
});
