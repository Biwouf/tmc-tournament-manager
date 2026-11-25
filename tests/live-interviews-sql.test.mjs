import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { PGlite } from '@electric-sql/pglite';
import { coursesFixtureSQL, id } from './helpers/courses-fixture.mjs';

const migration = (name) =>
  readFile(new URL(`../supabase/migrations/${name}.sql`, import.meta.url), 'utf8');
const C1 = id(1);

async function setup() {
  const db = new PGlite();
  await db.exec(coursesFixtureSQL + 'CREATE ROLE service_role; GRANT USAGE ON SCHEMA public TO service_role;');
  for (const name of ['2026091001_courses', '2026091002_courses_pwa', '2026091101_course_owner_identity',
    '2026092301_course_email', '2026092302_course_email_requester', '2026092303_course_email_denial_reason',
    '2026092402_course_web_push']) await db.exec(await migration(name));
  await db.exec(`CREATE TABLE events(id uuid PRIMARY KEY,club_id uuid NOT NULL,titre text NOT NULL,date_debut timestamptz NOT NULL);
    CREATE TABLE actus(id uuid PRIMARY KEY,club_id uuid NOT NULL,titre text NOT NULL,published boolean NOT NULL DEFAULT false);
    CREATE FUNCTION set_updated_at() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN NEW.updated_at=now(); RETURN NEW; END $$;
    CREATE FUNCTION can_manage_club_content(cid uuid) RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER AS $$ SELECT EXISTS(SELECT 1 FROM club_members WHERE club_id=cid AND user_id=auth.uid() AND role IN ('admin','manager')) $$;
    CREATE TABLE team_competitions(id uuid PRIMARY KEY,nom text);
    CREATE TABLE team_equipes(id uuid PRIMARY KEY,competition_id uuid,numero int);
    CREATE TABLE team_etapes(id uuid PRIMARY KEY,equipe_id uuid);
    CREATE TABLE team_rencontres(id uuid PRIMARY KEY,club_id uuid,etape_id uuid,club_adverse text,date_heure timestamptz,score_club int,score_adverse int);
    CREATE TABLE team_match_lines(id uuid PRIMARY KEY,club_id uuid,rencontre_id uuid,match_type text,joueurs_club jsonb,joueurs_adverse jsonb,
      live_match_id uuid,score text,gagnant text,result_kind text);`);
  await db.exec((await migration('20260423_live_matches')).replace('ALTER PUBLICATION supabase_realtime ADD TABLE live_matches;', ''));
  await db.exec(`ALTER TABLE live_matches ADD COLUMN club_id uuid NOT NULL DEFAULT '${C1}', ADD COLUMN court text,
      ADD COLUMN started_at timestamptz,ADD COLUMN retired_player live_match_winner,ADD COLUMN first_server live_match_winner,
      ADD COLUMN team_match_line_id uuid,ADD COLUMN team_rencontre_id uuid;
    DROP POLICY live_matches_select ON live_matches;
    CREATE POLICY tenant_isolation ON live_matches FOR ALL TO authenticated USING(club_id IN (SELECT club_id FROM club_members WHERE user_id=auth.uid())) WITH CHECK(club_id IN (SELECT club_id FROM club_members WHERE user_id=auth.uid()));
    GRANT SELECT ON club_members TO authenticated; GRANT SELECT,INSERT,UPDATE,DELETE ON live_matches TO authenticated;`);
  for (const name of ['20260907_live_match_consistency', '2026093001_live_activity', '2026101102_live_photos',
    '2026101104_live_reactions_throttle', '2026101501_live_post_reactions', '2026102001_live_post_after_finish',
    '2026101301_live_set_times', '2026102203_live_recap', '2026102301_live_recap_replay',
    '2026102401_live_web_push', '2026102402_live_push_start_text',
    '2026102403_live_push_result_text', '2026102404_live_push_score_format', '2026102901_content_web_push'])
    await db.exec(await migration(name));
  // Profils distincts : 102 et 105 sont homonymes ; 104 a un accent.
  await db.exec(`UPDATE profiles SET prenom='Ada',nom='Admin' WHERE id='${id(101)}';
    UPDATE profiles SET prenom='Sam',nom='Durand' WHERE id IN ('${id(102)}','${id(105)}');
    UPDATE profiles SET prenom='Alex',nom='Martin' WHERE id='${id(103)}';
    UPDATE profiles SET prenom='Élodie',nom='Dupré' WHERE id='${id(104)}';`);
  async function as(user, sql, args = []) {
    const role = user === null ? 'anon' : user === 'service' ? 'service_role' : 'authenticated';
    await db.exec(`BEGIN; SET LOCAL ROLE ${role};
      SELECT set_config('request.jwt.claim.sub','${typeof user === 'number' ? id(user) : ''}',true);`);
    try {
      const { rows } = await db.query(sql, args);
      await db.exec('COMMIT');
      return rows;
    } catch (e) {
      await db.exec('ROLLBACK');
      throw e;
    }
  }
  const insertMatch = (match, j1, j2, extra = '') => db.exec(`INSERT INTO live_matches(id,club_id,match_date,j1_prenom,j1_nom,j1_classement,j2_prenom,j2_nom,j2_classement${extra ? ',' + extra.split('=')[0] : ''})
    VALUES('${match}','${C1}','2026-11-19','${j1[0]}','${j1[1]}','${j1[2] ?? '30'}','${j2[0]}','${j2[1]}','${j2[2] ?? '30'}'${extra ? ',' + extra.split('=').slice(1).join('=') : ''})`);
  const update = (match, set) => as(103, `UPDATE live_matches SET ${set} WHERE id='${match}'`);
  const playLive = async (match, finish) => {
    await update(match, `status='live',scored_by='${id(103)}',started_at=now()-interval '80 minutes',set1_j1=0,set1_j2=0`);
    await update(match, 'set1_j1=2');
    await update(match, 'set1_j2=5');
    await update(match, 'set1_j1=7,set1_j2=5');
    await update(match, `set2_j1=6,set2_j2=3,status='finished',finished_at=now(),${finish}`);
  };
  return { db, as, insertMatch, update, playLive };
}

const err = (promise, pattern) => assert.rejects(promise, pattern);

test('live interviews: member resolution, requests, push, generation, answers, zone mixte', async () => {
  const { db, as, insertMatch, update, playLive } = await setup();
  try {
    // Un live terminé AVANT la migration : rattaché par le rattrapage, sans demande d'interview.
    const old = id(50);
    await insertMatch(old, ['Alex', 'Martin', '30/1'], ['Bob', 'Extérieur', '30']);
    await playLive(old, `winner='j2'`);
    await db.exec(`INSERT INTO team_rencontres VALUES('${id(60)}','${C1}',null,'TC Voisin','2026-11-01 13:00+00',3,1);
      INSERT INTO team_match_lines VALUES('${id(61)}','${C1}','${id(60)}','simple',
        '[{"prenom":"Alex","nom":"Martin","member_id":"${id(103)}"}]','[{"prenom":"Paul","nom":"PIERRE"}]',null,'6-1 6-2','club','normal');`);
    const interviewsMigration = await migration('2026112010_live_interviews');
    await db.exec(interviewsMigration);
    await db.exec(await migration('2026112101_interview_push_channel'));
    assert.deepEqual((await db.query(`SELECT side,member_id FROM live_match_members WHERE live_match_id='${old}'`)).rows,
      [{ side: 'j1', member_id: id(103) }], 'backfill');
    assert.equal((await db.query('SELECT count(*)::int n FROM live_interviews')).rows[0].n, 0, 'no request for past matches');

    // Appareils abonnés : 103 (ancienne signature, autres catégories coupées : Interviews reste
    // active par défaut), 104 (nouvelle signature), 105 (Interviews coupée : rien).
    const endpoint = (user) => `https://fcm.googleapis.com/fcm/send/u${user}`;
    await as(103, 'SELECT * FROM push_subscribe($1,$2,$3,$4,$5,$6,$7)', [C1, endpoint(103), 'p'.repeat(40), 'a'.repeat(20), false, false, false]);
    assert.equal((await db.query(`SELECT notify_interviews FROM course_push_subscriptions WHERE user_id='${id(103)}'`)).rows[0].notify_interviews, true);
    assert.deepEqual((await as(104, 'SELECT * FROM push_subscribe($1,$2,$3,$4,$5,$6,$7,$8)',
      [C1, endpoint(104), 'p'.repeat(40), 'a'.repeat(20), null, null, null, null]))[0],
      { notify_courses: false, notify_live: false, notify_news: true, notify_interviews: true });
    await as(105, 'SELECT * FROM push_subscribe($1,$2,$3,$4,$5,$6,$7,$8)', [C1, endpoint(105), 'p'.repeat(40), 'a'.repeat(20), null, null, null, false]);

    // Live : casse, accent et ordre inversé reconnus ; le perdant est interviewé aussi.
    const m = id(51);
    await insertMatch(m, ['alex', 'MARTIN', '30/1'], ['Dupre', 'Elodie', '15/5']);
    await playLive(m, `winner='j1',first_server='j1'`);
    const rows = (await db.query(`SELECT side,member_id,status,expires_at>now()+interval '47 hours' AS ok FROM live_interviews
      WHERE live_match_id='${m}' ORDER BY side`)).rows;
    assert.deepEqual(rows, [{ side: 'j1', member_id: id(103), status: 'pending', ok: true },
      { side: 'j2', member_id: id(104), status: 'pending', ok: true }]);
    const [i103, i104] = (await db.query(`SELECT id FROM live_interviews WHERE live_match_id='${m}' ORDER BY side`)).rows.map((r) => r.id);
    const jobs = (await db.query(`SELECT s.user_id,d.kind,d.title,d.body,d.url FROM content_push_deliveries d
      JOIN course_push_subscriptions s ON s.id=d.subscription_id ORDER BY s.user_id`)).rows;
    assert.deepEqual(jobs, [
      { user_id: id(103), kind: 'interview', title: '🎙️ Interview d\'après-match', body: 'Le club veut ta réaction après ta victoire contre Dupre Elodie', url: `/matches/${m}` },
      { user_id: id(104), kind: 'interview', title: '🎙️ Interview d\'après-match', body: 'Le club veut ta réaction après ton match contre alex MARTIN', url: `/matches/${m}` },
    ]);
    const claimed = await as('service', 'SELECT url,tag FROM content_push_claim(10) ORDER BY url');
    assert.deepEqual(claimed.map((c) => c.tag).sort(), [`interview-${i103}`, `interview-${i104}`].sort());

    // Rouvrir puis refinir : ni doublon de demande ni second push.
    await update(m, `status='live'`);
    await update(m, `status='finished'`);
    assert.equal((await db.query(`SELECT count(*)::int n FROM live_interviews WHERE live_match_id='${m}'`)).rows[0].n, 2);
    assert.equal((await db.query(`SELECT count(*)::int n FROM content_push_deliveries`)).rows[0].n, 2);

    // Homonymes : aucun rattachement. Score saisi hors live : rattaché, pas d'interview.
    const ambiguous = id(52), offline = id(53);
    await insertMatch(ambiguous, ['Sam', 'Durand'], ['Bob', 'Extérieur']);
    await playLive(ambiguous, `winner='j1'`);
    assert.equal((await db.query(`SELECT count(*)::int n FROM live_match_members WHERE live_match_id='${ambiguous}'`)).rows[0].n, 0);
    await insertMatch(offline, ['Alex', 'Martin'], ['Bob', 'Extérieur']);
    await update(offline, `set1_j1=6,set1_j2=0,set2_j1=6,set2_j2=0,winner='j1',status='finished',finished_at=now()`);
    assert.equal((await db.query(`SELECT count(*)::int n FROM live_match_members WHERE live_match_id='${offline}'`)).rows[0].n, 1);
    assert.equal((await db.query(`SELECT count(*)::int n FROM live_interviews WHERE live_match_id='${offline}'`)).rows[0].n, 0);

    // Rencontre par équipes : le member_id de la ligne lève l'homonymie.
    const team = id(54);
    await db.exec(`INSERT INTO team_match_lines VALUES('${id(62)}','${C1}','${id(60)}','simple',
      '[{"prenom":"Sam","nom":"Durand","member_id":"${id(105)}"}]','[]','${team}',null,null,null)`);
    await insertMatch(team, ['Sam', 'Durand'], ['Bob', 'Extérieur'], `team_match_line_id='${id(62)}'`);
    await playLive(team, `winner='j1'`);
    assert.deepEqual((await db.query(`SELECT member_id FROM live_interviews WHERE live_match_id='${team}'`)).rows, [{ member_id: id(105) }]);
    assert.equal((await db.query(`SELECT count(*)::int n FROM content_push_deliveries d JOIN course_push_subscriptions s
      ON s.id=d.subscription_id WHERE s.user_id='${id(105)}'`)).rows[0].n, 0, 'Interviews turned off: interview created, no push');

    // Une panne du push ne bloque jamais la fin du match.
    await db.exec(`CREATE OR REPLACE FUNCTION live_push_kick() RETURNS void LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'boom'; END $$`);
    const broken = id(55);
    await insertMatch(broken, ['Alex', 'Martin'], ['Bob', 'Extérieur']);
    await playLive(broken, `winner='j1'`);
    assert.equal((await db.query(`SELECT status FROM live_matches WHERE id='${broken}'`)).rows[0].status, 'finished');
    await db.exec(`CREATE OR REPLACE FUNCTION live_push_kick() RETURNS void LANGUAGE plpgsql AS $$ BEGIN END $$`);

    // Lectures : chacun ses interviews ; aucun accès direct aux tables.
    const pending = (await as(103, 'SELECT interview_my_pending($1) r', [C1]))[0].r;
    assert.deepEqual(pending.map((p) => [p.id, p.result, p.opponent]), [[i103, 'win', 'Dupre Elodie']]);
    assert.equal((await as(104, 'SELECT interview_my_pending($1) r', [C1]))[0].r[0].result, 'loss');
    await err(as(104, 'SELECT interview_get($1)', [i103]), /ne t'est pas destinée/);
    await err(as(103, 'SELECT * FROM live_interviews'), /permission denied/);
    await err(as(null, 'SELECT * FROM live_match_members'), /permission denied/);
    await err(as(103, `SELECT interview_gen_save($1,$2,'["Q ?"]'::jsonb)`, [i103, id(103)]), /permission denied/);

    // Génération : faits relus en base, tentative comptée, questions écrites par le service seul.
    const begun = (await as(103, 'SELECT interview_gen_begin($1,200) r', [i103]))[0].r;
    assert.equal(begun.status, 'pending');
    const f = begun.facts;
    assert.equal(f.side, 'j1');
    assert.equal(f.player.prenom, 'Alex');
    assert.equal(f.match.winner, 'j1');
    assert.equal(f.match.first_server, 'j1');
    assert.ok(f.recap.score.length >= 3, 'score history');
    assert.deepEqual(f.history.map((h) => h.side), ['j1'], 'past live of the same member, other matches excluded');
    assert.deepEqual(f.team_history.map((t) => t.club_adverse), ['TC Voisin']);
    assert.deepEqual(f.previous_interviews, []);
    await err(as(103, 'SELECT interview_gen_begin($1,200)', [i103]).then(() => as(103, 'SELECT interview_gen_begin($1,200)', [i103]))
      .then(() => as(103, 'SELECT interview_gen_begin($1,200)', [i103])), /n'ont pas pu être préparées/);
    await db.exec(`UPDATE live_interviews SET gen_attempts=1 WHERE id='${i103}'`);
    const saved = (await as('service', `SELECT interview_gen_save($1,$2,'["Comment as-tu renversé ce premier set ?"," Et la suite ? "]'::jsonb) r`, [i103, id(103)]))[0].r;
    assert.deepEqual(saved, [{ id: 'q1', texte: 'Comment as-tu renversé ce premier set ?' }, { id: 'q2', texte: 'Et la suite ?' }]);
    assert.deepEqual((await as(103, 'SELECT interview_gen_begin($1,200) r', [i103]))[0].r, { status: 'ready', questions: saved });
    assert.equal((await db.query(`SELECT gen_attempts FROM live_interviews WHERE id='${i103}'`)).rows[0].gen_attempts, 1, 'ready: no new attempt');
    await err(as(104, 'SELECT interview_gen_begin($1,1)', [i104]), /momentanément indisponibles/);

    // Réponses : au moins une, publiées sans les questions passées.
    await err(as(103, `SELECT interview_answer($1,'[{"question_id":"q1","texte":"  "}]'::jsonb)`, [i103]), /au moins à une question/);
    await as(103, `SELECT interview_answer($1,$2::jsonb)`, [i103, JSON.stringify([{ question_id: 'q1', texte: ' Je suis resté calme. ' }, { question_id: 'zz', texte: 'ignoré' }])]);
    const zone = (user) => as(user, 'SELECT live_match_interviews($1,$2) r', [m, C1]).then((r) => r[0].r);
    const visible = await zone(null);
    assert.deepEqual(visible.map((v) => [v.player, v.items, v.can_delete]),
      [['Alex Martin', [{ question: 'Comment as-tu renversé ce premier set ?', answer: 'Je suis resté calme.' }], false]]);
    assert.equal((await zone(103))[0].can_delete, true);
    assert.equal((await zone(104))[0].can_delete, false);
    assert.equal((await zone(101))[0].can_delete, true, 'club admin');
    await err(as(103, `SELECT interview_answer($1,'[{"question_id":"q1","texte":"encore"}]'::jsonb)`, [i103]), /plus disponible/);

    // L'interview suivante du même joueur reçoit la précédente (continuité).
    const next = id(56);
    await insertMatch(next, ['Alex', 'Martin'], ['Bob', 'Extérieur']);
    await playLive(next, `winner='j1'`);
    const iNext = (await db.query(`SELECT id FROM live_interviews WHERE live_match_id='${next}'`)).rows[0].id;
    const continuity = (await as(103, 'SELECT interview_gen_begin($1,200) r', [iNext]))[0].r.facts;
    assert.equal(continuity.previous_interviews.length, 1);
    assert.equal(continuity.previous_interviews[0].answers[0].texte, 'Je suis resté calme.');
    assert.equal(continuity.previous_interviews[0].opponent, 'Dupre Elodie');

    // Pas de commentaire, expiration, retrait.
    await as(104, 'SELECT interview_decline($1)', [i104]);
    assert.equal((await as(104, 'SELECT interview_get($1) r', [i104]))[0].r.status, 'declined');
    await err(as(104, 'SELECT interview_decline($1)', [i104]), /plus disponible/);
    await db.exec(`UPDATE live_interviews SET expires_at=now()-interval '1 minute' WHERE id='${iNext}'`);
    assert.equal((await as(103, 'SELECT interview_get($1) r', [iNext]))[0].r.status, 'expired');
    assert.deepEqual((await as(103, 'SELECT interview_my_pending($1) r', [C1]))[0].r, []);
    await err(as(103, 'SELECT interview_gen_begin($1,200)', [iNext]), /plus disponible/);
    await err(as(104, 'SELECT interview_delete($1)', [i103]), /Seuls le joueur et les administrateurs/);
    await as(101, 'SELECT interview_delete($1)', [i103]);
    assert.deepEqual(await zone(null), []);
  } finally {
    await db.close();
  }
});
