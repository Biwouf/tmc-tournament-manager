import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';
import ts from 'typescript';
import { PGlite } from '@electric-sql/pglite';
import { coursesFixtureSQL, id } from './helpers/courses-fixture.mjs';
const migration = await readFile(new URL('../supabase/migrations/2026092002_public_club_brand.sql', import.meta.url), 'utf8');
test('public brand: unchanged for visitors, pending, approved and removed accounts; active clubs only', async () => {
  const db = new PGlite();
  try {
    await db.exec(coursesFixtureSQL + `
      CREATE TABLE club_settings(club_id uuid PRIMARY KEY REFERENCES clubs(id),config jsonb);
      ALTER TABLE club_settings ENABLE ROW LEVEL SECURITY;
      GRANT SELECT ON club_settings TO anon,authenticated;
      CREATE POLICY public_read ON club_settings FOR SELECT TO anon USING(true);
      CREATE POLICY member_read ON club_settings FOR SELECT TO authenticated USING(EXISTS(SELECT 1 FROM club_members m WHERE m.club_id=club_settings.club_id AND m.user_id=auth.uid()));
      GRANT SELECT ON club_members TO authenticated;
      INSERT INTO club_settings VALUES('${id(1)}','{"brand":{"logo":"moissac.png","color":"#123456","color_secondary":"#eeeeee","color_accent":"#abcdef","private_field":"hidden"},"other_setting":"hidden"}');
    ` + migration);
    async function read(user, club = 1, direct = false) {
      await db.exec(`BEGIN; SET LOCAL ROLE ${user ? 'authenticated' : 'anon'}; SELECT set_config('request.jwt.claim.sub','${user ? id(user) : ''}',true);`);
      try {
        const result = await db.query(direct ? 'SELECT config FROM club_settings WHERE club_id=$1' : 'SELECT club_public_brand($1) config', [id(club)]);
        await db.exec('COMMIT'); return result.rows;
      } catch (error) { await db.exec('ROLLBACK'); throw error; }
    }
    const visitor = (await read(null))[0].config;
    assert.deepEqual(visitor, { brand: { logo: 'moissac.png', color: '#123456', color_secondary: '#eeeeee', color_accent: '#abcdef' } });
    assert.equal((await read(106, 1, true)).length, 0, 'existing full-settings policy stays private');
    assert.deepEqual((await read(106))[0].config, visitor, 'pending account keeps club branding');
    await db.query("INSERT INTO club_members(club_id,user_id,role) VALUES($1,$2,'member')", [id(1),id(106)]);
    assert.deepEqual((await read(106))[0].config, visitor);
    await db.query('DELETE FROM club_members WHERE club_id=$1 AND user_id=$2', [id(1),id(106)]);
    assert.deepEqual((await read(106))[0].config, visitor);
    assert.equal((await read(106,2))[0].config.brand.logo, null, 'no fallback to another club');
    for (const user of [null,106,108]) await assert.rejects(read(user,3), /CLUB_UNAVAILABLE/);
    await db.query("UPDATE clubs SET status='suspended' WHERE id=$1",[id(1)]);
    await assert.rejects(read(106), /CLUB_UNAVAILABLE/);
  } finally { await db.close(); }
});
test('PWA hook: public RPC is scoped to current club, without membership or account-dependent cache keys', async () => {
  const source = await readFile(new URL('../pwa/src/hooks/useClubConfig.ts', import.meta.url), 'utf8');
  const code = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS } }).outputText;
  let options;
  const calls = [];
  const module = { exports: {} };
  vm.runInNewContext(code, { exports: module.exports, require(name) {
    if (name === '@tanstack/react-query') return { useQuery: opts => { options = opts; return {}; } };
    if (name === '../contexts/ClubContext') return { useClub: () => ({ clubId: 'tc-moissac-id' }) };
    if (name === '../lib/supabase') return { supabase: { rpc: async (...args) => { calls.push(args); return { data: { brand: { logo: 'moissac.png', color: '#123456' } }, error: null }; } } };
    throw new Error('Unexpected dependency: ' + name);
  } });
  module.exports.useClubConfig();
  assert.equal(options.enabled, true);
  assert.deepEqual(Array.from(options.queryKey), ['club-config','tc-moissac-id']);
  assert.equal((await options.queryFn()).brand.logo, 'moissac.png');
  assert.equal(calls[0][0], 'club_public_brand');
  assert.equal(calls[0][1].p_club, 'tc-moissac-id');
});
