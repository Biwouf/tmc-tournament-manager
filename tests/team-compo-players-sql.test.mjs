import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { PGlite } from '@electric-sql/pglite';
const text = path => readFile(new URL('../' + path, import.meta.url), 'utf8');
const id = n => `00000000-0000-0000-0000-${String(n).padStart(12,'0')}`;
const C1 = id(1), FUTURE = id(41), PAST = id(42), MIXTE = id(43), OTHER = id(44);

// Club 1 : admin 101, capitaine 102 (équipe 11), membre 103 (femme), membre 104 (capitaine de l'équipe 12),
// membre 105 (sans profil complet). Club 2 : admin 201. 301 : compte sans club (demande en attente).
async function setup() {
  const db = new PGlite();
  const as = async (user, sql, params) => {
    await db.exec(user ? `SET ROLE authenticated; SELECT set_config('request.jwt.claim.sub','${user}',false);`
      : `SET ROLE anon; SELECT set_config('request.jwt.claim.sub','',false);`);
    try { return await db.query(sql, params); } finally { await db.exec('RESET ROLE'); }
  };
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
    CREATE TABLE profiles (id uuid PRIMARY KEY, prenom text, nom text);
    CREATE TABLE profile_details (user_id uuid PRIMARY KEY, sex text, classement text);
    CREATE FUNCTION is_super_admin() RETURNS boolean LANGUAGE sql AS $$ SELECT false $$;
    CREATE FUNCTION auth_club_ids() RETURNS SETOF uuid LANGUAGE sql STABLE SECURITY DEFINER AS $$
      SELECT club_id FROM club_members WHERE user_id = auth.uid() $$;
    CREATE FUNCTION can_manage_club_content(target_club uuid) RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER AS $$
      SELECT EXISTS (SELECT 1 FROM club_members WHERE club_id = target_club AND user_id = auth.uid() AND role IN ('admin','manager')) $$;
    CREATE TABLE team_saisons (id uuid PRIMARY KEY, club_id uuid NOT NULL);
    CREATE TABLE team_competitions (id uuid PRIMARY KEY, club_id uuid NOT NULL, genre text NOT NULL, format text NOT NULL);
    CREATE TABLE team_equipes (id uuid PRIMARY KEY, club_id uuid NOT NULL, competition_id uuid NOT NULL);
    CREATE TABLE team_etapes (id uuid PRIMARY KEY, equipe_id uuid NOT NULL, club_id uuid NOT NULL);
    CREATE TABLE team_rencontres (id uuid PRIMARY KEY, etape_id uuid NOT NULL, club_id uuid NOT NULL,
      date_heure timestamptz NOT NULL, confirmed_at timestamptz, confirmed_by uuid);
    CREATE TABLE team_match_lines (id uuid PRIMARY KEY, club_id uuid NOT NULL, rencontre_id uuid NOT NULL,
      joueurs_club jsonb NOT NULL DEFAULT '[]', live_match_id uuid, gagnant text);
    DO $$ DECLARE t text; BEGIN
      FOREACH t IN ARRAY ARRAY['team_saisons','team_competitions','team_equipes','team_etapes','team_rencontres','team_match_lines'] LOOP
        EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
        EXECUTE format('GRANT SELECT ON %I TO anon, authenticated', t);
        EXECUTE format('CREATE POLICY tenant_isolation ON %I FOR ALL TO authenticated USING (club_id IN (SELECT auth_club_ids()))', t);
      END LOOP;
    END $$;
    CREATE POLICY team_rencontres_anon_select ON team_rencontres FOR SELECT TO anon USING (true);
    CREATE POLICY team_lines_public_read ON team_match_lines FOR SELECT TO anon USING
      (EXISTS(SELECT 1 FROM clubs c WHERE c.id=club_id AND c.status='active'));
    GRANT SELECT ON clubs TO anon, authenticated;

    INSERT INTO clubs VALUES ('${C1}','active'), ('${id(2)}','active');
    INSERT INTO auth.users SELECT unnest(ARRAY['${id(101)}','${id(102)}','${id(103)}','${id(104)}','${id(105)}','${id(201)}','${id(301)}']::uuid[]);
    INSERT INTO club_members VALUES ('${C1}','${id(101)}','admin'), ('${C1}','${id(102)}','member'),
      ('${C1}','${id(103)}','member'), ('${C1}','${id(104)}','member'), ('${C1}','${id(105)}','member'),
      ('${id(2)}','${id(201)}','admin');
    INSERT INTO profiles VALUES ('${id(101)}','Alain','Admin'), ('${id(102)}','Romain','Escaffre'),
      ('${id(103)}','Claire','Dupont'), ('${id(104)}','Marc','Zébulon'), ('${id(105)}','',''),
      ('${id(201)}','Autre','Club'), ('${id(301)}','Paula','Attente');
    INSERT INTO profile_details VALUES ('${id(102)}','male','15/2'), ('${id(103)}','female','30/1');
    INSERT INTO team_saisons VALUES ('${id(5)}','${C1}');
    INSERT INTO team_competitions VALUES ('${id(6)}','${C1}','hommes','3S1D'), ('${id(7)}','${C1}','mixte','4S2D');
    INSERT INTO team_equipes VALUES ('${id(11)}','${C1}','${id(6)}'), ('${id(12)}','${C1}','${id(6)}'), ('${id(13)}','${C1}','${id(7)}');
    INSERT INTO team_etapes VALUES ('${id(31)}','${id(11)}','${C1}'), ('${id(32)}','${id(11)}','${C1}'),
      ('${id(33)}','${id(13)}','${C1}'), ('${id(34)}','${id(12)}','${C1}');
    INSERT INTO team_rencontres VALUES ('${FUTURE}','${id(31)}','${C1}',now()+interval '3 days'),
      ('${PAST}','${id(32)}','${C1}',now()-interval '1 day'), ('${MIXTE}','${id(33)}','${C1}',now()+interval '5 days'),
      ('${OTHER}','${id(34)}','${C1}',now()+interval '6 days');
    INSERT INTO team_match_lines VALUES ('${id(51)}','${C1}','${FUTURE}','[{"nom":"Escaffre"}]',NULL,NULL),
      ('${id(52)}','${C1}','${FUTURE}','[{"nom":"Dupont"}]','${id(99)}',NULL),
      ('${id(53)}','${C1}','${PAST}','[{"nom":"Zébulon"}]',NULL,NULL);
  `);
  await db.exec(await text('supabase/migrations/2026092601_team_format_3s1d.sql'));
  await db.exec(await text('supabase/migrations/2026102603_team_captains.sql'));
  await db.exec(`INSERT INTO team_equipe_captains(club_id,equipe_id,user_id) VALUES ('${C1}','${id(11)}','${id(102)}'),
    ('${C1}','${id(12)}','${id(104)}')`);
  await db.exec(await text('supabase/migrations/2026111901_team_compo_players.sql'));
  await db.exec(await text('supabase/migrations/2026111902_team_compo_user_id.sql'));
  // Barème FFT : seule la fonction de 2026112201 (le reste touche l'inscription, absente ici).
  await db.exec((await text('supabase/migrations/2026112201_classement_fft.sql')).match(/CREATE OR REPLACE FUNCTION public\.is_tennis_ranking[\s\S]*?\$\$;/)[0]);
  await db.exec(await text('supabase/migrations/2026112801_team_compo_guest_classement.sql'));
  const get = (user, rencontre = FUTURE) => as(user, 'SELECT team_compo_get($1,$2) AS r', [C1, rencontre]).then(x => x.rows[0].r);
  const save = (user, players, version, rencontre = FUTURE) =>
    as(user, 'SELECT team_compo_save($1,$2,$3,$4) AS r', [C1, rencontre, JSON.stringify(players), version]).then(x => x.rows[0].r);
  return { db, as, get, save };
}

test('Faille : un visiteur ne lit les noms d’un match qu’une fois la rencontre commencée ou le match en live', async () => {
  const { db, as } = await setup();
  try {
    const anonLines = (await as(null, 'SELECT id FROM team_match_lines ORDER BY id')).rows.map(r => r.id);
    assert.deepEqual(anonLines, [id(52), id(53)], 'match futur sans live masqué ; live et rencontre passée visibles');
    // Un compte sans club lit comme un visiteur ; un membre voit tout.
    assert.deepEqual((await as(id(301), 'SELECT id FROM team_match_lines ORDER BY id')).rows.map(r => r.id), [id(52), id(53)]);
    assert.equal((await as(id(103), 'SELECT id FROM team_match_lines')).rows.length, 3);
    // Le compte en attente voit les rencontres (il ne voyait rien avant), pas celles d'un club suspendu.
    assert.equal((await as(id(301), 'SELECT id FROM team_rencontres')).rows.length, 4);
    await db.exec(`UPDATE clubs SET status='suspended' WHERE id='${C1}'`);
    assert.equal((await as(id(301), 'SELECT id FROM team_rencontres')).rows.length, 0);
    assert.equal((await as(null, 'SELECT id FROM team_match_lines')).rows.length, 0);
  } finally { await db.close(); }
});

test('Compo : lecture réservée aux comptes connectés, aucun accès direct aux tables', async () => {
  const { db, as, get, save } = await setup();
  try {
    await save(id(102), [{ user_id: id(102) }, { user_id: id(103) }, { prenom: 'Paul', nom: 'Girard' }], 0);
    await assert.rejects(as(null, 'SELECT team_compo_get($1,$2)', [C1, FUTURE]), /permission denied/);
    await assert.rejects(as(null, 'SELECT team_compo_summaries($1,$2)', [C1, [FUTURE]]), /permission denied/);
    await assert.rejects(as(null, 'SELECT * FROM team_match_players'), /permission denied/);
    await assert.rejects(as(id(103), 'SELECT * FROM team_match_players'), /permission denied/);
    await assert.rejects(as(id(103), 'SELECT * FROM team_match_compos'), /permission denied/);

    // Un compte sans club lit la liste, sans le sexe (compétition non mixte, pas d'édition).
    const r = await get(id(301));
    assert.equal(r.can_edit, false);
    assert.deepEqual(r.players.map(p => `${p.prenom} ${p.nom}`), ['Claire Dupont', 'Romain Escaffre', 'Paul Girard']);
    assert.ok(r.players.every(p => p.sex === null), 'sexe masqué pour un lecteur simple');
    const romain = r.players.find(p => p.nom === 'Escaffre');
    assert.equal(romain.is_captain, true);
    assert.equal(romain.classement, '15/2');
    assert.equal(romain.initials, 'RE');
    assert.equal(r.players.find(p => p.nom === 'Girard').is_guest, true);
    assert.equal(r.min_players, 3);
    assert.equal(r.version, 1);
    assert.deepEqual(r.updated_by, { prenom: 'Romain', nom: 'Escaffre', role: 'capitaine' });
    assert.deepEqual(r.captains, [{ prenom: 'Romain', nom: 'Escaffre' }]);

    // Moi dans la liste ; le capitaine voit le sexe.
    assert.equal((await get(id(103))).players.find(p => p.is_me).nom, 'Dupont');
    const editor = await get(id(102));
    assert.equal(editor.can_edit, true);
    assert.equal(editor.players.find(p => p.nom === 'Dupont').sex, 'female');
    // L'éditeur reçoit user_id (pour renvoyer la liste) ; un lecteur simple, non.
    assert.equal(editor.players.find(p => p.nom === 'Dupont').user_id, id(103));
    assert.equal(editor.players.find(p => p.nom === 'Girard').user_id, null);
    assert.ok(r.players.every(p => p.user_id === null));

    // Compétition mixte : le sexe est renvoyé à tous pour grouper. Format 4S2D → 4 joueurs au moins.
    const mixte = await get(id(301), MIXTE);
    assert.equal(mixte.genre, 'mixte');
    assert.equal(mixte.min_players, 4);
    assert.equal(mixte.version, 0);
    assert.equal(mixte.updated_at, null);
    // Rencontre d'un autre club : introuvable.
    await assert.rejects(as(id(201), 'SELECT team_compo_get($1,$2)', [id(2), FUTURE]), /COMPO_NOT_FOUND/);
  } finally { await db.close(); }
});

test('Compo : seuls l’admin et le capitaine de l’équipe enregistrent', async () => {
  const { db, as, save } = await setup();
  try {
    await assert.rejects(save(id(103), [{ user_id: id(103) }], 0), /COMPO_FORBIDDEN/, 'membre simple');
    await assert.rejects(save(id(104), [{ user_id: id(104) }], 0), /COMPO_FORBIDDEN/, 'capitaine d’une autre équipe');
    await assert.rejects(save(id(301), [], 0), /COMPO_FORBIDDEN/, 'compte sans club');
    await assert.rejects(as(id(103), 'SELECT team_compo_candidates($1,$2)', [C1, FUTURE]), /COMPO_FORBIDDEN/);
    await assert.rejects(as(null, 'SELECT team_compo_save($1,$2,$3,$4)', [C1, FUTURE, '[]', 0]), /permission denied/);

    // Candidats : membres au nom renseigné, avec sexe et capitaine.
    const candidates = (await as(id(101), 'SELECT team_compo_candidates($1,$2) AS r', [C1, FUTURE])).rows[0].r;
    assert.deepEqual(candidates.map(c => c.nom), ['Admin', 'Dupont', 'Escaffre', 'Zébulon']);
    assert.equal(candidates.find(c => c.nom === 'Escaffre').is_captain, true);
    assert.equal(candidates.find(c => c.nom === 'Dupont').sex, 'female');

    const r = await save(id(101), [{ user_id: id(104) }], 0);
    assert.equal(r.version, 1);
    assert.equal(r.updated_by.role, 'admin');
    // Un joueur d'un autre club est refusé.
    await assert.rejects(save(id(101), [{ user_id: id(201) }], 1), /PLAYER_NOT_MEMBER/);
  } finally { await db.close(); }
});

test('Compo : doublons refusés, version périmée refusée sans 40001, diff qui garde les ids', async () => {
  const { db, save, get } = await setup();
  try {
    await assert.rejects(save(id(102), [{ user_id: id(103) }, { user_id: id(103) }], 0),
      e => /DUPLICATE_PLAYER/.test(e.message) && e.detail === 'Claire Dupont');
    await assert.rejects(save(id(102), [{ prenom: 'Paul', nom: 'Girard' }, { prenom: ' paul ', nom: 'GIRÂRD' }], 0),
      e => /DUPLICATE_PLAYER/.test(e.message) && e.detail === 'paul GIRÂRD');
    await assert.rejects(save(id(102), [{ prenom: '  ' }], 0), /COMPO_INVALID/);
    await assert.rejects(save(id(102), [{ prenom: 'Paul', sex: 'x' }], 0), /COMPO_INVALID/);
    await assert.rejects(save(id(102), Array.from({ length: 31 }, (_, i) => ({ prenom: `Invité ${i}` })), 0), /COMPO_TOO_LARGE/);

    const first = await save(id(102), [{ user_id: id(103) }, { prenom: 'Paul', nom: 'Girard', sex: 'male' }], 0);
    const claire = first.players.find(p => p.nom === 'Dupont').id;
    const paul = first.players.find(p => p.nom === 'Girard').id;
    await db.exec(`UPDATE team_match_players SET notified_at=now() WHERE id='${claire}'`);

    // Un invité gardé par son id, et un nouvel invité au même nom : doublon.
    await assert.rejects(save(id(102), [{ id: paul }, { prenom: 'PAUL', nom: 'girard' }], 1), /DUPLICATE_PLAYER/);
    // Version périmée : PT409, jamais 40001 (PostgREST le rejoue à l'infini).
    await assert.rejects(save(id(101), [], 0), e => e.code === 'PT409' && /COMPO_STALE/.test(e.message) && e.detail === 'Romain');

    const second = await save(id(101), [{ user_id: id(103) }, { id: paul }, { user_id: id(102) }], 1);
    assert.equal(second.version, 2);
    assert.equal(second.players.find(p => p.nom === 'Dupont').id, claire, 'id stable');
    assert.equal(second.players.find(p => p.nom === 'Girard').id, paul, 'invité gardé');
    const notified = (await db.query(`SELECT notified_at FROM team_match_players WHERE id='${claire}'`)).rows[0];
    assert.notEqual(notified.notified_at, null, 'notified_at conservé');

    // Retirer un invité puis le rajouter sous le même nom dans le même enregistrement : accepté.
    const third = await save(id(102), [{ prenom: 'Paul', nom: 'Girard' }], 2);
    assert.deepEqual(third.players.map(p => p.nom), ['Girard']);
    assert.notEqual(third.players[0].id, paul);

    // Liste vide : la compo est « dé-saisie ».
    const empty = await save(id(102), [], 3);
    assert.deepEqual(empty.players, []);
    assert.equal((await get(id(301))).version, 4);
    const forbidden = (await db.query(`SELECT count(*)::int n FROM pg_proc WHERE prosrc ~ '''40001''' AND proname LIKE 'team_compo%'`)).rows[0];
    assert.equal(forbidden.n, 0);
  } finally { await db.close(); }
});

test('Résumés de la liste : un appel, 3 aperçus au plus, moi puis le capitaine d’abord', async () => {
  const { db, as, save } = await setup();
  try {
    await save(id(102), [{ user_id: id(101) }, { user_id: id(102) }, { user_id: id(103) }, { prenom: 'Béa', nom: 'Aaron' }], 0);
    await save(id(101), [{ user_id: id(104) }], 0, MIXTE);
    const summaries = async user => (await as(user, 'SELECT team_compo_summaries($1,$2) AS r', [C1, [FUTURE, MIXTE, PAST]])).rows[0].r;

    const mine = await summaries(id(103));
    assert.equal(mine.length, 2, 'rencontre sans compo absente');
    const future = mine.find(s => s.rencontre_id === FUTURE);
    assert.equal(future.count, 4);
    assert.equal(future.is_me, true);
    assert.deepEqual(future.preview.map(p => p.prenom), ['Claire', 'Romain', 'Béa'], 'moi, capitaine, puis par nom');
    assert.equal(future.preview[2].is_guest, true);
    assert.equal(future.preview[0].initials, 'CD');
    assert.equal(mine.find(s => s.rencontre_id === MIXTE).is_me, false);

    // Un compte sans club voit les résumés ; anon jamais ; 200 ids au plus.
    assert.equal((await summaries(id(301))).length, 2);
    await assert.rejects(as(id(301), 'SELECT team_compo_summaries($1,$2)', [C1, Array.from({ length: 201 }, () => FUTURE)]), /COMPO_INVALID/);
    // Les rencontres d'un autre club passées en paramètre sont ignorées.
    assert.deepEqual((await as(id(201), 'SELECT team_compo_summaries($1,$2) AS r', [id(2), [FUTURE]])).rows[0].r, []);
  } finally { await db.close(); }
});

test('Classement d’un invité : facultatif à l’ajout, modifiable, gardé par un client pas à jour', async () => {
  const { db, save, get } = await setup();
  try {
    await assert.rejects(save(id(102), [{ prenom: 'Paul', classement: '-30' }], 0), /COMPO_INVALID/);
    const first = await save(id(102), [{ user_id: id(102) }, { prenom: 'Paul', nom: 'Girard', classement: '30/2' },
      { prenom: 'Léo', nom: 'Sans', classement: '' }], 0);
    const paul = first.players.find(p => p.nom === 'Girard');
    assert.equal(paul.classement, '30/2');
    assert.equal(first.players.find(p => p.nom === 'Sans').classement, null, 'vide = non précisé');
    assert.equal(first.players.find(p => p.nom === 'Escaffre').classement, '15/2', 'membre : classement du profil');
    // Lu aussi par un simple membre.
    assert.equal((await get(id(103))).players.find(p => p.nom === 'Girard').classement, '30/2');

    // {id} sans la clé : inchangé ; {id, classement} : modifié ; null : effacé.
    const leo = first.players.find(p => p.nom === 'Sans').id;
    const kept = await save(id(102), [{ id: paul.id }, { id: leo, classement: 'NC' }], 1);
    assert.equal(kept.players.find(p => p.nom === 'Girard').classement, '30/2');
    assert.equal(kept.players.find(p => p.nom === 'Sans').classement, 'NC');
    const changed = await save(id(101), [{ id: paul.id, classement: '15' }, { id: leo, classement: null }], 2);
    assert.equal(changed.players.find(p => p.nom === 'Girard').id, paul.id, 'id stable');
    assert.equal(changed.players.find(p => p.nom === 'Girard').classement, '15');
    assert.equal(changed.players.find(p => p.nom === 'Sans').classement, null);
    await assert.rejects(save(id(101), [{ id: paul.id, classement: 'top' }], 3), /COMPO_INVALID/);
    // Un membre ne porte jamais de classement d'invité.
    await db.exec(`INSERT INTO team_match_players(club_id,rencontre_id,user_id) VALUES ('${C1}','${FUTURE}','${id(103)}')`);
    await assert.rejects(db.exec(`UPDATE team_match_players SET guest_classement='30' WHERE user_id='${id(103)}'`), /check/);
  } finally { await db.close(); }
});
