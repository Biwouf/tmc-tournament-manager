import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import test from 'node:test';
import vm from 'node:vm';
import ts from 'typescript';
import { PGlite } from '@electric-sql/pglite';

const root = new URL('../', import.meta.url);
const text = (path) => readFile(new URL(path, root), 'utf8');

// Compile the actual plugin configuration, using each application's own packages.
for (const prefix of ['', 'pwa/']) {
  test(`${prefix || 'BO/'} editorial rendering rejects active content and preserves formatting`, async () => {
    const require = createRequire(new URL(`${prefix}package.json`, root));
    const React = await import(require.resolve('react'));
    const { renderToStaticMarkup } = await import(require.resolve('react-dom/server'));
    const { default: Markdown } = await import(require.resolve('react-markdown'));
    const raw = await import(require.resolve('rehype-raw'));
    const sanitize = await import(require.resolve('rehype-sanitize'));
    const source = ts.transpileModule(await text(`${prefix}src/lib/markdown.ts`), {
      compilerOptions: { module: ts.ModuleKind.CommonJS, esModuleInterop: true },
    }).outputText;
    const exports = {};
    vm.runInNewContext(source, { exports, require: (name) => ({
      'rehype-raw': { ...raw, __esModule: true },
      'rehype-sanitize': { ...sanitize, __esModule: true },
    }[name]) });
    const render = (body) => renderToStaticMarkup(React.createElement(Markdown,
      { rehypePlugins: exports.editorialRehypePlugins }, body));
    const malicious = render('<style>body{display:none}</style><form action="https://evil.invalid"><input type="password"/></form><iframe src="https://evil.invalid"></iframe><script>alert(1)</script><p style="position:fixed" onclick="alert(1)">Texte</p><a href="javascript:alert(1)">Lien</a>');
    assert.doesNotMatch(malicious, /<style|<form|<input|<iframe|<script|onclick|position:fixed|javascript:|display:none/);
    const editorial = render('**Gras**, *italique*, <u>souligné</u>\n\n- Élément\n\n[Site](https://example.com)\n\n![Légende](https://example.com/image.png)');
    for (const expected of ['<strong>Gras</strong>', '<em>italique</em>', '<u>souligné</u>', '<li>Élément</li>', 'href="https://example.com"', 'alt="Légende"']) {
      assert.ok(editorial.includes(expected), expected);
    }
  });
}

test('PostgreSQL: role isolation, suspension, Storage and last-admin invariant', async () => {
  const db = new PGlite();
  const id = (n) => `00000000-0000-0000-0000-${String(n).padStart(12, '0')}`;
  const tables = ['events','actus','tournaments','team_saisons','team_competitions',
    'team_equipes','team_etapes','team_rencontres','team_match_lines','live_matches','club_settings'];
  try {
    await db.exec(`
      CREATE ROLE anon; CREATE ROLE authenticated;
      CREATE SCHEMA auth; CREATE SCHEMA storage;
      CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql AS $$
        SELECT nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
      GRANT USAGE ON SCHEMA public, auth, storage TO anon, authenticated;
      CREATE TYPE club_role AS ENUM ('admin','manager','member');
      CREATE TABLE clubs (id uuid PRIMARY KEY, slug text, status text);
      CREATE TABLE profiles (id uuid PRIMARY KEY, is_super_admin boolean DEFAULT false);
      CREATE TABLE club_members (id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        club_id uuid REFERENCES clubs(id) ON DELETE CASCADE, user_id uuid,
        role club_role, UNIQUE(club_id,user_id));
      CREATE FUNCTION public.is_super_admin() RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path=public AS $$
        SELECT coalesce((SELECT is_super_admin FROM profiles WHERE id=auth.uid()), false) $$;
      CREATE FUNCTION public.auth_club_ids() RETURNS SETOF uuid LANGUAGE sql STABLE SECURITY DEFINER SET search_path=public AS $$
        SELECT club_id FROM club_members WHERE user_id=auth.uid() $$;
      CREATE FUNCTION storage.foldername(name text) RETURNS text[] LANGUAGE sql AS $$
        SELECT (string_to_array(name, '/'))[1:array_length(string_to_array(name, '/'),1)-1] $$;
      GRANT SELECT ON clubs TO anon, authenticated;
      INSERT INTO clubs VALUES ('${id(1)}','cac-tennis','active'),('${id(2)}','other','active'),('${id(3)}','suspended','suspended');
      INSERT INTO profiles VALUES ('${id(999)}',true);
      INSERT INTO club_members(club_id,user_id,role) VALUES
        ('${id(1)}','${id(101)}','admin'), ('${id(1)}','${id(102)}','manager'), ('${id(1)}','${id(103)}','member'),
        ('${id(2)}','${id(201)}','admin'), ('${id(3)}','${id(301)}','admin');
    `);
    for (const table of tables) {
      await db.exec(`CREATE TABLE ${table} (id uuid PRIMARY KEY, club_id uuid NOT NULL REFERENCES clubs(id), title text);
        ALTER TABLE ${table} ENABLE ROW LEVEL SECURITY;
        GRANT SELECT,INSERT,UPDATE,DELETE ON ${table} TO authenticated;
        GRANT SELECT ON ${table} TO anon;
        CREATE POLICY tenant_isolation ON ${table} FOR ALL TO authenticated
          USING (club_id IN (SELECT auth_club_ids()) OR is_super_admin())
          WITH CHECK (club_id IN (SELECT auth_club_ids()) OR is_super_admin());
        CREATE POLICY public_read ON ${table} FOR SELECT TO anon USING(true);
        INSERT INTO ${table} VALUES ('${id(11)}','${id(1)}','A'),('${id(22)}','${id(2)}','B'),('${id(33)}','${id(3)}','C');`);
    }
    const migration = await text('supabase/migrations/20260905_audit_content_permissions.sql');
    await db.exec(migration);
    await db.exec(migration); // Idempotency matters for manual SQL Editor deployments.
    async function asUser(user, sql, role = 'authenticated') {
      await db.exec(`BEGIN; SET LOCAL ROLE ${role}; SELECT set_config('request.jwt.claim.sub','${user ? id(user) : ''}',true);`);
      try { return await db.query(sql); } finally { await db.exec('ROLLBACK'); }
    }
    for (const table of tables.filter(t => !['live_matches','club_settings'].includes(t))) {
      for (const user of [101,102]) {
        assert.equal((await asUser(user,`UPDATE ${table} SET title='ok' WHERE club_id='${id(1)}' RETURNING id`)).rows.length,1, `${user} updates ${table}`);
        assert.equal((await asUser(user,`DELETE FROM ${table} WHERE club_id='${id(1)}' RETURNING id`)).rows.length,1);
        assert.equal((await asUser(user,`INSERT INTO ${table} VALUES ('${id(44)}','${id(1)}','ok') RETURNING id`)).rows.length,1);
      }
      for (const user of [103,201,301]) {
        assert.equal((await asUser(user,`UPDATE ${table} SET title='bad' WHERE club_id='${id(1)}' RETURNING id`)).rows.length,0);
        assert.equal((await asUser(user,`DELETE FROM ${table} WHERE club_id='${id(1)}' RETURNING id`)).rows.length,0);
        await assert.rejects(asUser(user,`INSERT INTO ${table} VALUES ('${id(44)}','${id(1)}','bad')`),/row-level security/);
      }
      assert.equal((await asUser(102,`UPDATE ${table} SET club_id='${id(2)}' WHERE club_id='${id(1)}' RETURNING id`).then(()=>false,()=>true)),true);
      assert.equal((await asUser(999,`UPDATE ${table} SET title='support' WHERE club_id='${id(3)}' RETURNING id`)).rows.length,1);
    }
    for (const table of tables) {
      assert.equal((await asUser(301,`SELECT * FROM ${table}`)).rows.length,0, `suspended ${table}`);
      assert.equal((await asUser(null,`SELECT * FROM ${table} WHERE club_id='${id(3)}'`,'anon')).rows.length,0);
      assert.equal((await asUser(301,`UPDATE ${table} SET title='bad' WHERE club_id='${id(3)}' RETURNING id`)).rows.length,0);
    }
    assert.equal((await asUser(103,`UPDATE live_matches SET title='score' WHERE club_id='${id(1)}' RETURNING id`)).rows.length,1,'member retains Live Score');
    for (const [user, path, expected] of [
      [101,`${id(1)}/logo.png`,true], [102,`${id(1)}/logo.png`,true],
      [103,`${id(1)}/logo.png`,false], [201,`${id(1)}/logo.png`,false],
      [301,`${id(3)}/logo.png`,false], [999,`${id(3)}/logo.png`,true],
      [101,'legacy/image.png',true], [102,'root.png',true], [103,'root.png',false], [201,'legacy/image.png',false],
    ]) {
      assert.equal((await asUser(user,`SELECT can_write_club_object('${path}') AS allowed`)).rows[0].allowed,expected,`${user} ${path}`);
    }
    await assert.rejects(db.exec(`DELETE FROM club_members WHERE user_id='${id(101)}'`),/au moins un administrateur/);
    await assert.rejects(db.exec(`UPDATE club_members SET role='member' WHERE user_id='${id(101)}'`),/au moins un administrateur/);
    await db.exec(`UPDATE club_members SET role='admin' WHERE user_id='${id(102)}'; DELETE FROM club_members WHERE user_id='${id(101)}';`);
    await assert.rejects(db.exec(`DELETE FROM club_members WHERE user_id='${id(102)}'`),/au moins un administrateur/);
  } finally { await db.close(); }
});
