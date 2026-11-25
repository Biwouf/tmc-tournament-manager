import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { PGlite } from '@electric-sql/pglite';
const text = path => readFile(new URL('../' + path, import.meta.url), 'utf8');
const id = n => `00000000-0000-0000-0000-${String(n).padStart(12, '0')}`;

// Vraies définitions de `course_is_admin` et d'`admin_inbox` ; tables réduites aux colonnes lues.
// Club 1 : admin 101, gestionnaire 102, membre 103. Club 2 : admin 201. Super-admin 301.
// Club 3 suspendu : admin 101.
async function setup() {
  const db = new PGlite();
  await db.exec(`
    CREATE ROLE authenticated; CREATE ROLE anon;
    CREATE SCHEMA auth;
    CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql AS $$ SELECT nullif(current_setting('request.jwt.claim.sub',true),'')::uuid $$;
    GRANT USAGE ON SCHEMA auth TO authenticated, anon;
    CREATE TABLE clubs (id uuid PRIMARY KEY, status text NOT NULL);
    CREATE TABLE club_members (club_id uuid, user_id uuid, role text);
    CREATE FUNCTION is_super_admin() RETURNS boolean LANGUAGE sql AS $$ SELECT auth.uid() = '${id(301)}'::uuid $$;
    CREATE TABLE team_saisons (id uuid, club_id uuid, actif boolean NOT NULL DEFAULT false, created_at timestamptz DEFAULT now());
    CREATE TABLE team_competitions (id uuid, club_id uuid, saison_id uuid, nom text, genre text, categorie text, terminee boolean NOT NULL DEFAULT false);
    CREATE TABLE team_equipes (id uuid, competition_id uuid, numero int);
    CREATE TABLE team_etapes (id uuid, equipe_id uuid);
    CREATE TABLE team_rencontres (id uuid, etape_id uuid, club_adverse text, date_heure timestamptz, score_club int, score_adverse int, wo boolean NOT NULL DEFAULT false);
    CREATE TABLE club_signup_requests (club_id uuid, user_id uuid, status text, created_at timestamptz);
    CREATE TABLE courses (id uuid, club_id uuid, name text, starts_at timestamptz, cancelled_at timestamptz);
    CREATE TABLE course_registrations (club_id uuid, course_id uuid, status text, requested_at timestamptz DEFAULT now());
    CREATE TYPE live_match_status AS ENUM ('pending','live','finished');
    CREATE TABLE live_matches (club_id uuid, status live_match_status, started_at timestamptz);
    INSERT INTO clubs VALUES ('${id(1)}','active'), ('${id(2)}','active'), ('${id(3)}','suspended');
    INSERT INTO club_members VALUES ('${id(1)}','${id(101)}','admin'), ('${id(1)}','${id(102)}','manager'),
      ('${id(1)}','${id(103)}','member'), ('${id(2)}','${id(201)}','admin'), ('${id(3)}','${id(101)}','admin');
  `);
  const courses = await text('supabase/migrations/2026091001_courses.sql');
  await db.exec(courses.match(/CREATE FUNCTION public\.course_is_admin[\s\S]*?\$\$;/)[0]
    + courses.match(/REVOKE ALL ON FUNCTION public\.course_is_admin[\s\S]*?;/)[0]);
  await db.exec(await text('supabase/migrations/2026112501_admin_inbox.sql'));
  const inbox = async (user, club = 1) => {
    await db.exec(user ? `SET ROLE authenticated; SELECT set_config('request.jwt.claim.sub','${id(user)}',false);`
      : `SET ROLE anon; SELECT set_config('request.jwt.claim.sub','',false);`);
    try { return (await db.query('SELECT admin_inbox($1) AS r', [id(club)])).rows[0].r; } finally { await db.exec('RESET ROLE'); }
  };
  return { db, inbox };
}

test('admin_inbox : seul un admin du club actif (ou le super-admin) lit, les autres reçoivent 42501', async () => {
  const { db, inbox } = await setup();
  try {
    const empty = await inbox(101);
    assert.deepEqual(empty, {
      signup_pending: 0, signup_oldest_at: null,
      scores_to_enter: 0, scores_oldest_at: null, scores_preview: [],
      course_pending: 0, course_oldest_at: null, course_next: null,
      live_count: 0, stale_lives: 0, stale_lives_oldest_at: null,
    });
    assert.deepEqual(await inbox(301), empty);
    const refused = error => { assert.equal(error.code, '42501'); return true; };
    for (const [user, club] of [[102, 1], [103, 1], [201, 1], [101, 2], [101, 3], [301, 3], [101, 99]]) {
      await assert.rejects(inbox(user, club), refused, `${user} → club ${club}`);
    }
    await assert.rejects(inbox(null), refused); // anon : aucun EXECUTE
  } finally { await db.close(); }
});

test('admin_inbox : comptes, détails et isolation entre clubs', async () => {
  const { db, inbox } = await setup();
  try {
    await db.exec(`
      -- Saison active plus ancienne que l'autre : c'est elle qui compte.
      INSERT INTO team_saisons VALUES ('${id(11)}','${id(1)}',true, now()-interval '1 year'), ('${id(12)}','${id(1)}',false, now()), ('${id(13)}','${id(2)}',true, now());
      INSERT INTO team_competitions VALUES
        ('${id(21)}','${id(1)}','${id(11)}','Interclubs','hommes','seniors',false),
        ('${id(22)}','${id(1)}','${id(11)}','CODEP','femmes','seniors',true),
        ('${id(23)}','${id(1)}','${id(12)}','GAN 35','hommes','35_ans',false),
        ('${id(24)}','${id(2)}','${id(13)}','Interclubs','hommes','seniors',false);
      INSERT INTO team_equipes VALUES ('${id(31)}','${id(21)}',2), ('${id(32)}','${id(22)}',1), ('${id(33)}','${id(23)}',1), ('${id(34)}','${id(24)}',1);
      INSERT INTO team_etapes SELECT ('00000000-0000-0000-0000-0000000004' || lpad(n::text,2,'0'))::uuid,
        CASE WHEN n < 10 THEN '${id(31)}'::uuid WHEN n = 10 THEN '${id(32)}'::uuid WHEN n = 11 THEN '${id(33)}'::uuid ELSE '${id(34)}'::uuid END
        FROM generate_series(1,12) n;
      INSERT INTO team_rencontres VALUES
        ('${id(501)}','${id(401)}','Moissac',    now()-interval '3 days', NULL, NULL, false),
        ('${id(502)}','${id(402)}','Montauban',  now()-interval '9 days', 3, NULL, false),
        ('${id(503)}','${id(403)}','Beaumont',   now()-interval '1 day', NULL, NULL, false),
        ('${id(504)}','${id(404)}','Saisi',      now()-interval '2 days', 3, 1, false),
        ('${id(505)}','${id(405)}','Forfait',    now()-interval '2 days', NULL, NULL, true),
        ('${id(506)}','${id(406)}','À venir',    now()+interval '2 days', NULL, NULL, false),
        ('${id(510)}','${id(410)}','Terminée',   now()-interval '2 days', NULL, NULL, false),
        ('${id(511)}','${id(411)}','Autre saison', now()-interval '2 days', NULL, NULL, false),
        ('${id(512)}','${id(412)}','Autre club', now()-interval '2 days', NULL, NULL, false);
      INSERT INTO club_signup_requests VALUES
        ('${id(1)}','${id(601)}','pending', now()-interval '2 days'), ('${id(1)}','${id(602)}','pending', now()-interval '5 days'),
        ('${id(1)}','${id(603)}','denied', now()-interval '30 days'), ('${id(1)}','${id(604)}','approved', now()-interval '30 days'),
        ('${id(1)}','${id(605)}','revoked', now()-interval '30 days'), ('${id(2)}','${id(606)}','pending', now()-interval '30 days');
      INSERT INTO courses VALUES
        ('${id(701)}','${id(1)}','Tard', now()+interval '5 days', NULL), ('${id(702)}','${id(1)}','Bientôt', now()+interval '1 day', NULL),
        ('${id(703)}','${id(1)}','Passé', now()-interval '1 day', NULL), ('${id(704)}','${id(1)}','Annulé', now()+interval '1 hour', now()),
        ('${id(705)}','${id(1)}','Sans demande', now()+interval '1 hour', NULL), ('${id(706)}','${id(2)}','Autre club', now()+interval '1 hour', NULL);
      INSERT INTO course_registrations VALUES
        ('${id(1)}','${id(701)}','pending', now()-interval '4 days'), ('${id(1)}','${id(702)}','pending', now()-interval '1 day'), ('${id(1)}','${id(702)}','pending', now()),
        ('${id(1)}','${id(702)}','approved', now()-interval '9 days'), ('${id(1)}','${id(703)}','pending', now()-interval '9 days'),
        ('${id(1)}','${id(704)}','pending', now()-interval '9 days'), ('${id(1)}','${id(705)}','denied', now()), ('${id(2)}','${id(706)}','pending', now());
      INSERT INTO live_matches VALUES
        ('${id(1)}','live', now()-interval '1 hour'), ('${id(1)}','live', now()-interval '7 days'), ('${id(1)}','live', now()-interval '5 days 23 hours'),
        ('${id(1)}','live', NULL), ('${id(1)}','finished', now()-interval '30 days'), ('${id(1)}','pending', NULL), ('${id(2)}','live', now()-interval '30 days');
    `);
    const r = await inbox(101);
    assert.equal(r.signup_pending, 2);
    assert.equal(r.scores_to_enter, 3);
    assert.deepEqual(r.scores_preview.map(p => p.club_adverse), ['Montauban', 'Moissac']);
    assert.equal(r.scores_preview[0].numero, 2);
    assert.equal(r.scores_preview[0].nom, 'Interclubs');
    assert.equal(r.course_pending, 3);
    assert.equal(r.course_next.id, id(702));
    assert.equal(r.course_next.name, 'Bientôt');
    assert.equal(r.live_count, 4);
    assert.equal(r.stale_lives, 1);
    const days = at => Math.round((Date.now() - new Date(at)) / 86_400_000);
    assert.deepEqual([r.signup_oldest_at, r.scores_oldest_at, r.course_oldest_at, r.stale_lives_oldest_at].map(days), [5, 9, 4, 7]);

    const other = await inbox(201, 2);
    assert.deepEqual([other.signup_pending, other.scores_to_enter, other.course_pending, other.live_count, other.stale_lives], [1, 1, 1, 1, 1]);

    // Une demande acceptée fait baisser le compte ; sans saison active, la plus récente sert.
    await db.exec(`UPDATE club_signup_requests SET status='approved' WHERE user_id='${id(602)}'; UPDATE team_saisons SET actif=false WHERE club_id='${id(1)}';`);
    const after = await inbox(101);
    assert.equal(after.signup_pending, 1);
    assert.equal(after.scores_to_enter, 1);
    assert.equal(after.scores_preview[0].club_adverse, 'Autre saison');
  } finally { await db.close(); }
});
