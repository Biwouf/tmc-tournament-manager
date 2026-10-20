import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { PGlite } from '@electric-sql/pglite';
import { coursesFixtureSQL, id } from './helpers/courses-fixture.mjs';
const migration = async (name) =>
  readFile(
    new URL(`../supabase/migrations/${name}.sql`, import.meta.url),
    'utf8',
  );

test('Live activity: shared members, private unique votes, permissions, tenant/status, retries and pagination', async () => {
  const db = new PGlite();
  try {
    await db.exec(coursesFixtureSQL);
    await db.exec(`CREATE TABLE events(id uuid PRIMARY KEY);
   CREATE FUNCTION set_updated_at() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN NEW.updated_at=now(); RETURN NEW; END $$;
   CREATE FUNCTION can_manage_club_content(cid uuid) RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER AS $$ SELECT EXISTS(SELECT 1 FROM club_members WHERE club_id=cid AND user_id=auth.uid() AND role IN ('admin','manager')) $$;`);
    await db.exec(
      (await migration('20260423_live_matches')).replace(
        'ALTER PUBLICATION supabase_realtime ADD TABLE live_matches;',
        '',
      ),
    );
    await db.exec(`ALTER TABLE live_matches ADD COLUMN club_id uuid NOT NULL DEFAULT '${id(1)}', ADD COLUMN court text,ADD COLUMN started_at timestamptz,ADD COLUMN retired_player live_match_winner;
   DROP POLICY live_matches_select ON live_matches;
   CREATE POLICY tenant_isolation ON live_matches FOR ALL TO authenticated USING(club_id IN (SELECT club_id FROM club_members WHERE user_id=auth.uid())) WITH CHECK(club_id IN (SELECT club_id FROM club_members WHERE user_id=auth.uid()));
   CREATE POLICY public_read ON live_matches FOR SELECT TO anon USING(EXISTS(SELECT 1 FROM clubs WHERE clubs.id=club_id AND status='active'));
   GRANT SELECT ON club_members TO authenticated; GRANT SELECT ON live_matches TO anon;
   GRANT SELECT,INSERT,UPDATE,DELETE ON live_matches TO authenticated;
   INSERT INTO auth.users VALUES('${id(109)}'); INSERT INTO profiles(id,prenom,nom) VALUES('${id(109)}','Spectateur','Connecté');`);
    await db.exec(await migration('20260907_live_match_consistency'));
    await db.exec(await migration('2026093001_live_activity'));
    await db.exec(await migration('2026101102_live_photos'));
    await db.exec(await migration('2026101104_live_reactions_throttle'));
    await db.exec(await migration('2026101501_live_post_reactions'));
    await db.exec(await migration('2026102001_live_post_after_finish'));
    await db.exec(`INSERT INTO live_matches(id,club_id,match_date,j1_prenom,j1_nom,j2_prenom,j2_nom,status,scored_by,set1_j1,set1_j2)
   VALUES('${id(20)}','${id(1)}','2026-09-30','Alex','A','Sam','B','live','${id(103)}',4,3),
   ('${id(21)}','${id(2)}','2026-09-30','Autre','Club','Autre','Club','live','${id(106)}',0,0),
   ('${id(22)}','${id(3)}','2026-09-30','Suspendu','Club','Suspendu','Club','live','${id(107)}',0,0);`);
    async function as(user, sql, args = []) {
      await db.exec(
        `BEGIN; SET LOCAL ROLE ${user === null ? 'anon' : 'authenticated'}; SELECT set_config('request.jwt.claim.sub','${user === null ? '' : id(user)}',true);`,
      );
      try {
        const { rows } = await db.query(sql, args);
        await db.exec('COMMIT');
        return rows;
      } catch (e) {
        await db.exec('ROLLBACK');
        throw e;
      }
    }
    const command = (action, data, user = 103, match = id(20), club = id(1)) =>
      as(user, 'SELECT live_activity_command($1,$2,$3,$4) AS result', [
        match,
        club,
        action,
        data,
      ]).then((rows) => rows[0].result);
    const page = (user = null, before = null, match = id(20), club = id(1)) =>
      as(user, 'SELECT live_activity_page($1,$2,$3) AS result', [
        match,
        club,
        before,
      ]).then((rows) => rows[0].result);
    assert.equal((await page(109)).can_animate, false);
    assert.equal((await page(104)).can_animate, true);
    assert.equal(
      (await as(109, 'SELECT count(*)::int n FROM live_matches'))[0].n,
      2,
      'connected spectators have public read across active clubs',
    );
    assert.equal(
      (await as(null, 'SELECT count(*)::int n FROM live_matches'))[0].n,
      2,
    );
    await assert.rejects(page(107, null, id(22), id(3)), /introuvable/);
    await assert.rejects(page(null, null, id(20), id(2)), /introuvable/);
    await assert.rejects(
      command('message', { id: randomUUID(), body: 'No' }, null),
      /permission denied/,
    );
    await assert.rejects(
      command('message', { id: randomUUID(), body: 'No' }, 109),
      /membres/,
    );
    await assert.rejects(
      command(
        'poll',
        { id: randomUUID(), body: 'No', options: ['A', 'B'] },
        106,
      ),
      /membres/,
    );
    await assert.rejects(
      command(
        'react',
        { id: randomUUID(), emoji: '❤️' },
        107,
        id(22),
        id(3),
      ),
      /indisponible/,
    );
    await assert.rejects(
      as(109, 'UPDATE live_matches SET set1_j1=5 WHERE id=$1', [id(20)]),
      /membres/,
    );
    const updated = await as(
      104,
      'UPDATE live_matches SET set1_j1=5 WHERE id=$1 AND revision=0 RETURNING revision',
      [id(20)],
    );
    assert.equal(
      updated[0].revision,
      1,
      'another member edits directly without takeover',
    );
    assert.equal(
      (
        await as(
          103,
          'UPDATE live_matches SET set1_j2=4 WHERE id=$1 AND revision=0 RETURNING revision',
          [id(20)],
        )
      ).length,
      0,
      'stale score cannot overwrite a member update',
    );
    const post = randomUUID();
    await command('message', { id: post, body: ' Beau jeu ! ' }, 104);
    await command('message', { id: post, body: ' Beau jeu ! ' }, 104);
    assert.equal((await page()).items.length, 1, 'retry is idempotent');
    assert.equal(
      (await page()).items[0].score.set1_j1,
      5,
      'score snapshot is server generated',
    );
    await assert.rejects(
      command('message', { id: post, body: 'Different' }, 104),
      /déjà utilisée/,
    );
    await assert.rejects(
      command('message', { id: randomUUID(), body: ' ' }, 104),
      /Texte invalide/,
    );
    await assert.rejects(
      command('message', { id: randomUUID(), body: 'x'.repeat(281) }, 104),
      /Texte invalide/,
    );
    await assert.rejects(
      as(
        104,
        "INSERT INTO live_posts(match_id,author_name,kind,body,score) VALUES($1,'X','message','Forgery','{}')",
        [id(20)],
      ),
      /permission denied/,
    );
    const poll = randomUUID(),
      poll2 = randomUUID();
    await command(
      'poll',
      { id: poll, body: 'Qui gagne ?', options: ['Alex', 'Sam'] },
      103,
    );
    await command(
      'poll',
      { id: poll2, body: 'Et le prochain set ?', options: ['Alex', 'Sam'] },
      104,
    );
    assert.equal(
      (await page()).items.filter((p) => p.kind === 'poll' && !p.closed).length,
      2,
      'multiple open polls',
    );
    await assert.rejects(
      command(
        'poll',
        { id: randomUUID(), body: 'X', options: [' Alex ', 'alex'] },
        103,
      ),
      /distinctes/,
    );
    await assert.rejects(
      command('poll', { id: randomUUID(), body: 'X', options: ['A'] }, 103),
      /2 à 4/,
    );
    await assert.rejects(
      command(
        'poll',
        { id: randomUUID(), body: 'X', options: ['A', 'x'.repeat(61)] },
        103,
      ),
      /distinctes/,
    );
    await assert.rejects(
      command('vote', { id: poll, option: 2 }, 109),
      /Réponse invalide/,
    );
    await assert.rejects(
      command('vote', { id: poll, option: 0 }, 109, id(21), id(2)),
      /indisponible/,
    );
    await command('vote', { id: poll, option: 0 }, 109);
    await command('vote', { id: poll, option: 0 }, 109);
    let p = (await page(109)).items.find((p) => p.id === poll);
    assert.equal(p.total, 1);
    assert.deepEqual(p.counts, [1, 0]);
    assert.equal(p.my_vote, 0);
    p = (await page(106)).items.find((p) => p.id === poll);
    assert.equal(p.total, 1);
    assert.equal(p.counts, null);
    assert.equal(p.my_vote, null, 'no leaked other vote');
    await assert.rejects(
      as(109, 'SELECT * FROM live_votes'),
      /permission denied/,
    );
    await command('vote', { id: poll, option: 1 }, 109);
    p = (await page(109)).items.find((p) => p.id === poll);
    assert.equal(p.total, 1);
    assert.deepEqual(p.counts, [0, 1]);
    await assert.rejects(command('close', { id: poll }, 109), /membres/);
    await command('close', { id: poll }, 104);
    await assert.rejects(
      command('vote', { id: poll, option: 0 }, 109),
      /clôturé/,
    );
    assert.deepEqual(
      (await page()).items.find((p) => p.id === poll).counts,
      [0, 1],
    );
    await assert.rejects(
      command('react', { id: post, emoji: '❤️' }, null),
      /permission denied/,
    );
    for (const emoji of ['abc', '🔥 bravo', '中', '', ' 🔥', '🔥'.repeat(17)])
      await assert.rejects(
        command('react', { id: post, emoji }, 109),
        /Réaction invalide/,
        `${emoji} is not a single emoji`,
      );
    for (const emoji of ['😡', '👍🏽', '🇫🇷', '👨‍👩‍👧', '1️⃣', '❤️', '🏴󠁧󠁢󠁳󠁣󠁴󠁿'])
      await command('react', { id: post, emoji }, 109);
    // Chaque emoji du sélecteur de la PWA est accepté par le serveur.
    const picker = JSON.parse(
      await readFile(new URL('../pwa/src/lib/emojiData.json', import.meta.url), 'utf8'),
    ).flatMap((t) => t.emojis.map(([emoji]) => emoji));
    assert.deepEqual(
      (
        await db.query(
          'SELECT e FROM unnest($1::text[]) e WHERE NOT live_is_emoji(e)',
          [picker],
        )
      ).rows,
      [],
    );
    await command('react', { id: post, emoji: null }, 109);
    await assert.rejects(
      command('react', { id: poll, emoji: '🔥' }, 109),
      /indisponible/,
      'polls are not reactable',
    );
    await assert.rejects(
      command('react', { id: post, emoji: '🔥' }, 109, id(21), id(2)),
      /indisponible/,
    );
    await command('react', { id: post, emoji: '🔥' }, 109);
    await command('react', { id: post, emoji: '🔥' }, 109);
    await command('react', { id: post, emoji: '🔥' }, 104);
    let reacted = (await page(109)).items.find((p) => p.id === post);
    assert.equal(reacted.my_reaction, '🔥');
    assert.deepEqual(
      reacted.reactions,
      [{ emoji: '🔥', count: 2, names: ['Spectateur Connecté', 'Prénom Nom'] }],
      'one reaction per account, retry is idempotent',
    );
    await command('react', { id: post, emoji: '👏' }, 109);
    reacted = (await page(106)).items.find((p) => p.id === post);
    assert.equal(reacted.my_reaction, null);
    assert.deepEqual(
      reacted.reactions.map((r) => [r.emoji, r.count]),
      [
        ['🔥', 1],
        ['👏', 1],
      ],
      'another emoji replaces the previous one',
    );
    assert.deepEqual(
      (await page()).items.find((p) => p.id === post).reactions,
      [
        { emoji: '🔥', count: 1, names: null },
        { emoji: '👏', count: 1, names: null },
      ],
      'visitors see counts, not names',
    );
    await command('react', { id: post, emoji: null }, 109);
    await command('react', { id: post, emoji: null }, 109);
    assert.deepEqual(
      (await page(109)).items
        .find((p) => p.id === post)
        .reactions.map((r) => r.emoji),
      ['🔥'],
      'removal is idempotent',
    );
    await assert.rejects(
      as(109, 'SELECT * FROM live_post_reactions'),
      /permission denied/,
    );
    for (let i = 0; i < 51; i++)
      await command('message', { id: randomUUID(), body: `Message ${i}` }, 104);
    let latest = await page();
    assert.equal(latest.items.length, 50);
    assert.equal(latest.has_more, true);
    const older = await page(null, latest.before);
    assert.equal(older.items.length, 4);
    assert.equal(older.has_more, false);
    assert.ok(older.items.at(-1).sequence < latest.items[0].sequence);
    const post2 = latest.items.at(-1).id;
    await command('delete', { id: post }, 103);
    await command('delete', { id: post }, 104);
    await assert.rejects(
      command('react', { id: post, emoji: '🔥' }, 109),
      /indisponible/,
      'deleted posts are not reactable',
    );
    assert.equal(
      (await page(null, latest.before)).items.some((p) => p.id === post),
      false,
    );
    assert.equal(
      (await as(null, 'SELECT * FROM live_posts WHERE id=$1', [post])).length,
      0,
      'soft-deleted content not exposed through SELECT',
    );
    await as(
      104,
      "UPDATE live_matches SET status='finished',winner='j1' WHERE id=$1",
      [id(20)],
    );
    await assert.rejects(
      command('vote', { id: poll2, option: 0 }, 109),
      /pas en cours/,
    );
    await command('react', { id: post2, emoji: '🎉' }, 109);
    assert.equal(
      (await page(109)).items.find((p) => p.id === post2).my_reaction,
      '🎉',
      'reactions stay open after the match',
    );
    await command('message', { id: randomUUID(), body: 'Bravo !' }, 104);
    assert.equal(
      (await page()).items.at(-1).body,
      'Bravo !',
      'comments stay open after the match',
    );
    await assert.rejects(
      command('message', { id: randomUUID(), body: 'Intrus' }, 109),
      /membres/,
    );
    await assert.rejects(
      command('poll', { id: randomUUID(), body: 'Trop tard ?', options: ['Oui', 'Non'] }, 104),
      /pas en cours/,
    );
    await command('delete', { id: poll2 }, 104);
    await db.exec(`UPDATE clubs SET status='suspended' WHERE id='${id(1)}'`);
    await assert.rejects(command('delete', { id: poll }, 104), /introuvable/);
    await assert.rejects(
      as(104, 'UPDATE live_matches SET set1_j1=4 WHERE id=$1', [id(20)]),
      /membres/,
    );
  } finally {
    await db.close();
  }
});

test('Live photos: members upload in their live, object required, optional caption, delete frees the file', async () => {
  const db = new PGlite();
  try {
    await db.exec(coursesFixtureSQL);
    await db.exec(`CREATE TABLE events(id uuid PRIMARY KEY);
   CREATE FUNCTION set_updated_at() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN NEW.updated_at=now(); RETURN NEW; END $$;`);
    await db.exec(
      (await migration('20260423_live_matches')).replace(
        'ALTER PUBLICATION supabase_realtime ADD TABLE live_matches;',
        '',
      ),
    );
    await db.exec(`ALTER TABLE live_matches ADD COLUMN club_id uuid NOT NULL DEFAULT '${id(1)}', ADD COLUMN court text,ADD COLUMN started_at timestamptz,ADD COLUMN retired_player live_match_winner;
   GRANT SELECT ON club_members TO authenticated;
   INSERT INTO auth.users VALUES('${id(109)}'); INSERT INTO profiles(id,prenom,nom) VALUES('${id(109)}','Spectateur','Connecté');`);
    await db.exec(await migration('20260907_live_match_consistency'));
    await db.exec(await migration('2026093001_live_activity'));
    await db.exec(await migration('2026101102_live_photos'));
    await db.exec(await migration('2026101104_live_reactions_throttle'));
    await db.exec(await migration('2026101501_live_post_reactions'));
    await db.exec(await migration('2026102001_live_post_after_finish'));
    await db.exec(`INSERT INTO live_matches(id,club_id,match_date,j1_prenom,j1_nom,j2_prenom,j2_nom,status)
   VALUES('${id(20)}','${id(1)}','2026-10-11','Alex','A','Sam','B','live'),
   ('${id(21)}','${id(2)}','2026-10-11','Autre','Club','Autre','Club','live'),
   ('${id(23)}','${id(1)}','2026-10-11','Fini','A','Fini','B','finished'),
   ('${id(24)}','${id(1)}','2026-10-11','Attente','A','Attente','B','pending');`);
    async function as(user, sql, args = []) {
      await db.exec(
        `BEGIN; SET LOCAL ROLE ${user === null ? 'anon' : 'authenticated'}; SELECT set_config('request.jwt.claim.sub','${user === null ? '' : id(user)}',true);`,
      );
      try {
        const { rows } = await db.query(sql, args);
        await db.exec('COMMIT');
        return rows;
      } catch (e) {
        await db.exec('ROLLBACK');
        throw e;
      }
    }
    const command = (action, data, user = 103, match = id(20), club = id(1)) =>
      as(user, 'SELECT live_activity_command($1,$2,$3,$4) AS result', [
        match,
        club,
        action,
        data,
      ]).then((rows) => rows[0].result);
    const page = () =>
      as(null, 'SELECT live_activity_page($1,$2,null) AS result', [
        id(20),
        id(1),
      ]).then((rows) => rows[0].result);
    const upload = (user, name) =>
      as(
        user,
        "INSERT INTO storage.objects(bucket_id,name) VALUES('live-images',$1)",
        [name],
      );
    const remove = (user, name) =>
      as(
        user,
        "DELETE FROM storage.objects WHERE bucket_id='live-images' AND name=$1 RETURNING id",
        [name],
      );
    const post = randomUUID();
    const path = `${id(1)}/${id(20)}/${post}.jpg`;
    for (const [user, name, why] of [
      [109, path, 'spectator'],
      [106, path, 'member of another club'],
      [103, `${id(1)}/${id(24)}/${post}.jpg`, 'pending match'],
      [103, `${id(1)}/${id(21)}/${post}.jpg`, 'match of another club'],
      [103, `${id(1)}/${id(20)}/${post}.png`, 'not the expected path'],
    ])
      await assert.rejects(upload(user, name), /row-level security/, why);
    await assert.rejects(
      command('photo', { id: post, body: '' }, 104),
      /Photo introuvable/,
      'post requires the uploaded object',
    );
    await upload(104, path);
    await assert.rejects(
      command('photo', { id: post, body: '' }, 109),
      /membres/,
    );
    await command('photo', { id: post, body: '  ' }, 104);
    await command('photo', { id: post }, 104);
    let items = (await page()).items;
    assert.equal(items.length, 1, 'retry is idempotent');
    assert.equal(items[0].kind, 'photo');
    assert.equal(items[0].body, '', 'caption is optional');
    assert.equal(items[0].image_path, path, 'path is server generated');
    await assert.rejects(
      command('photo', { id: post, body: 'Autre légende' }, 104),
      /déjà utilisée/,
    );
    const captioned = randomUUID();
    await upload(103, `${id(1)}/${id(20)}/${captioned}.jpg`);
    await assert.rejects(
      command('photo', { id: captioned, body: 'x'.repeat(281) }, 103),
      /Texte invalide/,
    );
    await command('photo', { id: captioned, body: ' Balle de match ' }, 103);
    assert.equal((await page()).items[1].body, 'Balle de match');
    await assert.rejects(
      command('message', { id: randomUUID(), body: '' }, 103),
      /Texte invalide/,
      'messages still require text',
    );
    assert.equal(
      (await remove(103, path)).length,
      0,
      'displayed photo cannot be deleted',
    );
    await command('delete', { id: post }, 103);
    assert.equal((await remove(106, path)).length, 0, 'other club cannot');
    assert.equal((await remove(103, path)).length, 1, 'freed after delete');
    assert.equal((await page()).items.length, 1);
    const late = randomUUID();
    await upload(103, `${id(1)}/${id(23)}/${late}.jpg`);
    await command('photo', { id: late, body: 'Après la balle de match' }, 103, id(23));
    assert.equal(
      (await as(null, 'SELECT count(*)::int n FROM live_posts WHERE match_id=$1', [id(23)]))[0].n,
      1,
      'photos stay open after the match',
    );
  } finally {
    await db.close();
  }
});

test('Shared team live: all members edit, fixed formats and confirmation invalidation survive', async () => {
  const db = new PGlite();
  try {
    await db.exec(coursesFixtureSQL);
    await db.exec(`CREATE TABLE events(id uuid PRIMARY KEY);
   CREATE FUNCTION set_updated_at() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN NEW.updated_at=now(); RETURN NEW; END $$;
   CREATE FUNCTION can_manage_club_content(cid uuid) RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER AS $$ SELECT EXISTS(SELECT 1 FROM club_members WHERE club_id=cid AND user_id=auth.uid() AND role IN ('admin','manager')) $$;`);
    await db.exec(
      (await migration('20260423_live_matches')).replace(
        'ALTER PUBLICATION supabase_realtime ADD TABLE live_matches;',
        '',
      ),
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
          `CREATE POLICY test_read ON ${table} FOR SELECT TO anon USING(true);`,
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
    await db.exec(await migration('2026093001_live_activity'));
    await db.exec(await migration('2026093002_team_live_shared_scoring'));
    await db.exec(await migration('2026100104_live_encounter_scores'));
    await db.exec(await migration('2026100401_no_retry_errcodes'));
    assert.equal(
      (
        await db.query(
          "SELECT count(*)::int n FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='public' AND p.prosrc LIKE '%''40001''%'",
        )
      ).rows[0].n,
      0,
      'PostgREST retries SQLSTATE 40001 forever: no business error may use it',
    );
    await db.exec("UPDATE team_competitions SET singles_set3_format='normal'");

    async function as(user, sql, args = []) {
      await db.exec(
        `BEGIN; SET LOCAL ROLE ${user === null ? 'anon' : 'authenticated'}; SELECT set_config('request.jwt.claim.sub','${user === null ? '' : id(user)}',true);`,
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
    const command = (op, data, user = 103) =>
      as(user, 'SELECT team_match_command($1,$2,$3,$4,$5) AS result', [
        id(1),
        id(14),
        op,
        data,
        randomUUID(),
      ]).then((rows) => rows[0].result);
    const line = async (lid) =>
      (await db.query('SELECT * FROM team_match_lines WHERE id=$1', [lid]))
        .rows[0];
    const live = async (mid) =>
      (await db.query('SELECT * FROM live_matches WHERE id=$1', [mid])).rows[0];
    const scores = (user = null, club = id(1), ids = [id(14)]) =>
      as(user, 'SELECT live_encounter_scores($1,$2) AS result', [
        club,
        ids,
      ]).then((rows) => rows[0].result);
    assert.equal(
      (await scores())[0].score_club,
      null,
      'no invented score when no match/result exists',
    );
    assert.deepEqual(
      await scores(null, id(2)),
      [],
      'club scope is enforced for public summaries',
    );
    await assert.rejects(
      scores(
        null,
        id(1),
        Array.from({ length: 101 }, () => id(14)),
      ),
      /Trop de rencontres/,
    );
    const created = await command('create', {
      match_type: 'simple',
      slot: 1,
      joueurs_club: [
        { prenom: 'Alex', nom: 'A', classement: 'NC', member_id: id(103) },
      ],
      joueurs_adverse: [{ prenom: 'Sam', nom: 'B', classement: 'NC' }],
    });
    assert.deepEqual(
      (await scores(106)).map((r) => [r.score_club, r.score_adverse]),
      [[0, 0]],
      'connected spectators can read public scores',
    );
    const started = await command('start_live', {
      id: created.id,
      revision: 0,
    });
    let m = await live(started.live_match_id);
    await as(
      104,
      'UPDATE live_matches SET set1_j1=1 WHERE id=$1 AND revision=$2',
      [m.id, m.revision],
    );
    m = await live(m.id);
    assert.equal(m.set1_j1, 1, 'non-owner scores without takeover');
    assert.equal(
      (await line(created.id)).revision,
      1,
      'a point without result to invalidate keeps the line revision',
    );
    await assert.rejects(
      command('start_live', { id: created.id, revision: 0, live_revision: m.revision }),
      (e) => e.code === 'PT409' && /Le match a changé/.test(e.message),
      'stale revisions answer 409 instead of a retried serialization failure',
    );
    await assert.rejects(
      as(
        104,
        "UPDATE live_matches SET set3_format='super_tiebreak' WHERE id=$1",
        [m.id],
      ),
      /format est fixé/,
    );
    await assert.rejects(
      as(104, 'DELETE FROM live_matches WHERE id=$1', [m.id]),
      /lié à une rencontre/,
    );
    await as(
      104,
      "UPDATE live_matches SET status='finished',winner='j1',set1_j1=6,set1_j2=3,set2_j1=6,set2_j2=4 WHERE id=$1 AND revision=$2",
      [m.id, m.revision],
    );
    m = await live(m.id);
    assert.deepEqual(
      (await scores())[0],
      {
        id: id(14),
        club_adverse: 'Adversaires',
        wo: false,
        confirmed: false,
        score_club: 1,
        score_adverse: 0,
      },
      'a finished live counts before its result is confirmed',
    );
    await command(
      'result',
      {
        id: created.id,
        revision: (await line(created.id)).revision,
        live_revision: m.revision,
        kind: 'normal',
        sets: [
          { club: 6, adverse: 3 },
          { club: 6, adverse: 4 },
        ],
      },
      104,
    );
    m = await live(m.id);
    assert.equal(m.team_result_confirmed, true);
    assert.ok((await line(created.id)).confirmed_at);
    assert.equal(
      (await scores())[0].score_club,
      1,
      'a validated live is counted once',
    );
    const players = [
      { prenom: 'Jo', nom: 'A', classement: 'NC' },
      { prenom: 'Camille', nom: 'B', classement: 'NC' },
    ];
    const double = await command('create', {
      match_type: 'double',
      slot: 1,
      joueurs_club: players,
      joueurs_adverse: players,
    });
    await command('result', {
      id: double.id,
      revision: 0,
      kind: 'wo',
      winner: 'adverse',
      sets: [],
    });
    assert.equal(
      (await scores())[0].score_adverse,
      2,
      'double at two points uses the competition format',
    );
    await db.exec(
      `UPDATE team_competitions SET format='3S1D' WHERE id='${id(11)}'`,
    );
    assert.equal(
      (await scores())[0].score_adverse,
      1,
      'single-point doubles use the same format rule',
    );
    await db.exec(`UPDATE clubs SET status='suspended' WHERE id='${id(1)}'`);
    assert.deepEqual(
      await scores(103),
      [],
      'suspended clubs expose no summary',
    );
    await db.exec(`UPDATE clubs SET status='active' WHERE id='${id(1)}'`);

    await as(
      103,
      "UPDATE live_matches SET status='live',winner=NULL,finished_at=NULL,set2_j1=5 WHERE id=$1 AND revision=$2",
      [m.id, m.revision],
    );
    m = await live(m.id);
    assert.equal(m.team_result_confirmed, false);
    assert.equal(
      (await line(created.id)).confirmed_at,
      null,
      'a correction invalidates the team result',
    );
    await as(101, 'DELETE FROM team_rencontres WHERE id=$1', [id(14)]);
    assert.equal(
      (await live(m.id)).team_match_line_id,
      null,
      'FK clean-up is still permitted',
    );
  } finally {
    await db.close();
  }
});
