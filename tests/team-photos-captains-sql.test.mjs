import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { PGlite } from '@electric-sql/pglite';
const text = path => readFile(new URL('../' + path, import.meta.url), 'utf8');
const id = n => `00000000-0000-0000-0000-${String(n).padStart(12,'0')}`;
const BASE = 'https://x.supabase.co/storage/v1/object/public/team-match-photos/';

// Club 1 : admin 101, capitaines 102 et 103 de l'équipe 11, membre 104. Rencontre 41.
test('Photos de rencontre : ajout par admin/capitaine, retrait de ses seules photos', async () => {
  const db = new PGlite();
  const as = async (user, sql, params) => {
    await db.exec(`SET ROLE authenticated; SELECT set_config('request.jwt.claim.sub','${user}',false);`);
    try { return await db.query(sql, params); } finally { await db.exec('RESET ROLE'); }
  };
  const path = (user, n) => `${id(1)}/${id(41)}/${user}-${n}.jpg`;
  try {
    await db.exec(`
      CREATE ROLE authenticated; CREATE ROLE anon;
      CREATE SCHEMA auth;
      CREATE TABLE auth.users (id uuid PRIMARY KEY);
      CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql AS $$ SELECT nullif(current_setting('request.jwt.claim.sub',true),'')::uuid $$;
      GRANT USAGE ON SCHEMA auth TO authenticated, anon;
      CREATE SCHEMA storage;
      CREATE TABLE storage.objects (bucket_id text, name text, owner_id text DEFAULT auth.uid()::text, PRIMARY KEY (bucket_id, name));
      ALTER TABLE storage.objects ENABLE ROW LEVEL SECURITY;
      GRANT USAGE ON SCHEMA storage TO authenticated;
      GRANT SELECT, INSERT, DELETE ON storage.objects TO authenticated;
      CREATE POLICY read ON storage.objects FOR SELECT USING (true);
      CREATE TABLE clubs (id uuid PRIMARY KEY, status text NOT NULL DEFAULT 'active');
      CREATE TABLE club_members (club_id uuid, user_id uuid, role text, PRIMARY KEY (club_id,user_id));
      CREATE TABLE team_equipes (id uuid PRIMARY KEY, club_id uuid NOT NULL);
      CREATE TABLE team_etapes (id uuid PRIMARY KEY, equipe_id uuid NOT NULL, club_id uuid NOT NULL);
      CREATE TABLE team_rencontres (id uuid PRIMARY KEY, etape_id uuid NOT NULL, club_id uuid NOT NULL,
        date_heure timestamptz NOT NULL, confirmed_at timestamptz, confirmed_by uuid, photo_urls text[] NOT NULL DEFAULT '{}');
      CREATE FUNCTION is_super_admin() RETURNS boolean LANGUAGE sql AS $$ SELECT false $$;
      CREATE FUNCTION auth_club_ids() RETURNS SETOF uuid LANGUAGE sql STABLE SECURITY DEFINER AS $$
        SELECT club_id FROM club_members WHERE user_id = auth.uid() $$;
      CREATE FUNCTION can_manage_club_content(target_club uuid) RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER AS $$
        SELECT EXISTS (SELECT 1 FROM club_members WHERE club_id = target_club AND user_id = auth.uid() AND role = 'admin') $$;
      INSERT INTO clubs VALUES ('${id(1)}');
      INSERT INTO auth.users SELECT unnest(ARRAY['${id(101)}','${id(102)}','${id(103)}','${id(104)}']::uuid[]);
      INSERT INTO club_members VALUES ('${id(1)}','${id(101)}','admin'), ('${id(1)}','${id(102)}','member'),
        ('${id(1)}','${id(103)}','member'), ('${id(1)}','${id(104)}','member');
      INSERT INTO team_equipes VALUES ('${id(11)}','${id(1)}');
      INSERT INTO team_etapes VALUES ('${id(31)}','${id(11)}','${id(1)}');
      INSERT INTO team_rencontres (id, etape_id, club_id, date_heure) VALUES ('${id(41)}','${id(31)}','${id(1)}', now());
    `);
    await db.exec(await text('supabase/migrations/2026102603_team_captains.sql'));
    await db.exec(await text('supabase/migrations/2026102605_team_photos_captains.sql'));
    await db.exec(`INSERT INTO team_equipe_captains VALUES ('${id(1)}','${id(11)}','${id(102)}'), ('${id(1)}','${id(11)}','${id(103)}')`);

    const upload = (user, name) => as(user, `INSERT INTO storage.objects (bucket_id, name) VALUES ('team-match-photos', $1)`, [name]);
    const addPhotos = (user, urls) => as(user, 'SELECT team_rencontre_add_photos($1,$2,$3) AS urls', [id(1), id(41), urls]);
    const removePhoto = (user, url) => as(user, 'SELECT team_rencontre_remove_photo($1,$2,$3) AS urls', [id(1), id(41), url]);
    const photos = async () => (await db.query(`SELECT photo_urls FROM team_rencontres WHERE id='${id(41)}'`)).rows[0].photo_urls;

    // Upload Storage : capitaine sur son propre chemin uniquement ; simple membre refusé.
    await upload(id(102), path(id(102), 1));
    await upload(id(103), path(id(103), 1));
    await assert.rejects(upload(id(102), path(id(103), 2)), /row-level security/, 'chemin d’un autre');
    await assert.rejects(upload(id(104), path(id(104), 1)), /row-level security/, 'membre non capitaine');

    // Rattachement à la rencontre.
    await addPhotos(id(102), [BASE + path(id(102), 1)]);
    await addPhotos(id(103), [BASE + path(id(103), 1)]);
    await addPhotos(id(102), [BASE + path(id(102), 1)]); // rejeu : pas de doublon
    assert.deepEqual(await photos(), [BASE + path(id(102), 1), BASE + path(id(103), 1)]);
    await assert.rejects(addPhotos(id(102), [BASE + path(id(103), 1)]), /Photo inconnue/, 'photo d’un autre');
    await assert.rejects(addPhotos(id(102), [BASE + path(id(102), 9)]), /Photo inconnue/, 'fichier absent');
    await assert.rejects(addPhotos(id(104), []), /capitaine/);

    // Retrait : ses propres photos seulement ; l'admin peut tout retirer.
    await assert.rejects(removePhoto(id(102), BASE + path(id(103), 1)), /vos propres photos/);
    await removePhoto(id(102), BASE + path(id(102), 1));
    assert.deepEqual(await photos(), [BASE + path(id(103), 1)]);
    await removePhoto(id(101), BASE + path(id(103), 1));
    assert.deepEqual(await photos(), []);

    // Suppression du fichier : propriétaire uniquement.
    await as(id(102), `DELETE FROM storage.objects WHERE name = $1`, [path(id(103), 1)]);
    assert.equal((await db.query(`SELECT count(*)::int AS n FROM storage.objects`)).rows[0].n, 2);
    await as(id(102), `DELETE FROM storage.objects WHERE name = $1`, [path(id(102), 1)]);
    assert.equal((await db.query(`SELECT count(*)::int AS n FROM storage.objects`)).rows[0].n, 1);
  } finally {
    await db.close();
  }
});
