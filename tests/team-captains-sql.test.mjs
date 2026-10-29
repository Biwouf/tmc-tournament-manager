import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { PGlite } from '@electric-sql/pglite';
const text = path => readFile(new URL('../' + path, import.meta.url), 'utf8');
const id = n => `00000000-0000-0000-0000-${String(n).padStart(12,'0')}`;

// Club 1 : admin 101, capitaine 102, membre 103, membre 104 (capitaine d'une autre équipe).
// Club 2 : admin 201.
test('Capitaines : déclaration par l’admin, changement de date réservé à l’admin et aux capitaines', async () => {
  const db = new PGlite();
  const as = async (user, sql, params) => {
    await db.exec(`SET ROLE authenticated; SELECT set_config('request.jwt.claim.sub','${user}',false);`);
    try { return await db.query(sql, params); } finally { await db.exec('RESET ROLE'); }
  };
  try {
    await db.exec(`
      CREATE ROLE authenticated; CREATE ROLE anon;
      CREATE SCHEMA auth;
      CREATE TABLE auth.users (id uuid PRIMARY KEY);
      CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql AS $$ SELECT nullif(current_setting('request.jwt.claim.sub',true),'')::uuid $$;
      GRANT USAGE ON SCHEMA auth TO authenticated, anon;
      CREATE TABLE clubs (id uuid PRIMARY KEY, status text NOT NULL DEFAULT 'active');
      CREATE TABLE club_members (club_id uuid, user_id uuid, role text, PRIMARY KEY (club_id,user_id));
      ALTER TABLE club_members ENABLE ROW LEVEL SECURITY;
      CREATE POLICY own ON club_members FOR SELECT TO authenticated USING (user_id = auth.uid());
      GRANT SELECT ON club_members TO authenticated;
      CREATE TABLE team_equipes (id uuid PRIMARY KEY, club_id uuid NOT NULL);
      CREATE TABLE team_etapes (id uuid PRIMARY KEY, equipe_id uuid NOT NULL, club_id uuid NOT NULL);
      CREATE TABLE team_rencontres (id uuid PRIMARY KEY, etape_id uuid NOT NULL, club_id uuid NOT NULL,
        date_heure timestamptz NOT NULL, confirmed_at timestamptz, confirmed_by uuid);
      GRANT SELECT ON team_rencontres TO authenticated;
      CREATE FUNCTION is_super_admin() RETURNS boolean LANGUAGE sql AS $$ SELECT false $$;
      CREATE FUNCTION auth_club_ids() RETURNS SETOF uuid LANGUAGE sql STABLE SECURITY DEFINER AS $$
        SELECT club_id FROM club_members WHERE user_id = auth.uid() $$;
      CREATE FUNCTION can_manage_club_content(target_club uuid) RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER AS $$
        SELECT EXISTS (SELECT 1 FROM club_members WHERE club_id = target_club AND user_id = auth.uid() AND role IN ('admin','manager')) $$;
      INSERT INTO clubs VALUES ('${id(1)}','active'), ('${id(2)}','active');
      INSERT INTO auth.users SELECT unnest(ARRAY['${id(101)}','${id(102)}','${id(103)}','${id(104)}','${id(201)}']::uuid[]);
      INSERT INTO club_members VALUES ('${id(1)}','${id(101)}','admin'), ('${id(1)}','${id(102)}','member'),
        ('${id(1)}','${id(103)}','member'), ('${id(1)}','${id(104)}','member'), ('${id(2)}','${id(201)}','admin');
      INSERT INTO team_equipes VALUES ('${id(11)}','${id(1)}'), ('${id(12)}','${id(1)}'), ('${id(21)}','${id(2)}');
      INSERT INTO team_etapes VALUES ('${id(31)}','${id(11)}','${id(1)}'), ('${id(32)}','${id(12)}','${id(1)}');
      INSERT INTO team_rencontres VALUES ('${id(41)}','${id(31)}','${id(1)}','2026-11-01 14:00+01', now(), '${id(101)}'),
        ('${id(42)}','${id(32)}','${id(1)}','2026-11-08 14:00+01', NULL, NULL);
    `);
    await db.exec(await text('supabase/migrations/2026102603_team_captains.sql'));

    const declare = (actor, equipe, user, club = id(1)) => as(actor,
      'INSERT INTO team_equipe_captains(club_id,equipe_id,user_id) VALUES ($1,$2,$3)', [club, equipe, user]);

    // Seul un admin déclare ; plusieurs capitaines par équipe.
    await declare(id(101), id(11), id(102));
    await declare(id(101), id(11), id(103));
    await declare(id(101), id(12), id(104));
    await assert.rejects(declare(id(102), id(11), id(104)), /row-level security/);
    // Ni membre d'un autre club, ni équipe d'un autre club.
    await assert.rejects(declare(id(101), id(11), id(201)), /row-level security/);
    await assert.rejects(declare(id(101), id(21), id(102)), /row-level security/);
    await assert.rejects(declare(id(201), id(11), id(201), id(2)), /row-level security/);

    // Lecture limitée au club.
    assert.equal((await as(id(103), 'SELECT * FROM team_equipe_captains')).rows.length, 3);
    assert.equal((await as(id(201), 'SELECT * FROM team_equipe_captains')).rows.length, 0);

    const can = async (user, rencontre) => (await as(user,
      'SELECT team_can_reschedule($1,$2) AS ok', [id(1), rencontre])).rows[0].ok;
    assert.equal(await can(id(101), id(41)), true);
    assert.equal(await can(id(102), id(41)), true);
    assert.equal(await can(id(104), id(41)), false, 'capitaine d’une autre équipe');
    assert.equal(await can(id(104), id(42)), true);
    assert.equal(await can(id(201), id(41)), false);

    // Le capitaine change la date : la rencontre repasse à confirmer.
    await as(id(102), 'SELECT team_rencontre_set_date($1,$2,$3)', [id(1), id(41), '2026-11-02 10:00+01']);
    const r = (await db.query(`SELECT date_heure, confirmed_at, confirmed_by FROM team_rencontres WHERE id='${id(41)}'`)).rows[0];
    assert.equal(new Date(r.date_heure).toISOString(), '2026-11-02T09:00:00.000Z');
    assert.equal(r.confirmed_at, null);
    assert.equal(r.confirmed_by, null);

    await assert.rejects(as(id(104), 'SELECT team_rencontre_set_date($1,$2,$3)', [id(1), id(41), '2026-11-03 10:00+01']),
      /capitaine de l'équipe/);

    // Retiré du club : n'est plus capitaine effectif.
    await db.exec(`DELETE FROM club_members WHERE user_id='${id(103)}'`);
    assert.equal(await can(id(103), id(41)), false);

    // Retrait par l'admin.
    await as(id(101), 'DELETE FROM team_equipe_captains WHERE equipe_id=$1 AND user_id=$2', [id(11), id(102)]);
    assert.equal(await can(id(102), id(41)), false);
  } finally {
    await db.close();
  }
});
