import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { PGlite } from '@electric-sql/pglite';
import { coursesFixtureSQL, id } from './helpers/courses-fixture.mjs';

test('post generation quota: admins only, monthly per club, global breaker, counted after success', async () => {
  const db = new PGlite();
  try {
    await db.exec(coursesFixtureSQL);
    await db.exec(await readFile(new URL('../supabase/migrations/2026111302_post_generation.sql', import.meta.url), 'utf8'));
    async function as(user, sql, args = []) {
      await db.exec(`BEGIN; SET LOCAL ROLE authenticated; SELECT set_config('request.jwt.claim.sub','${id(user)}',true);`);
      try { const r = await db.query(sql, args); await db.exec('COMMIT'); return r.rows; }
      catch (e) { await db.exec('ROLLBACK'); throw e; }
    }
    const check = (user, club = id(1), global = 300) =>
      as(user, 'SELECT post_gen_check($1,$2) AS left', [club, global]).then(rows => rows[0].left);
    const record = (user, club = id(1)) => as(user, 'SELECT post_gen_record($1,10,20)', [club]);

    assert.equal(await check(101), 30, 'default limit is 30 per month');
    await assert.rejects(check(102), /administrateurs/, 'a manager cannot generate');
    await assert.rejects(check(103), /administrateurs/, 'a member cannot generate');
    await assert.rejects(check(106), /administrateurs/, 'the admin of another club cannot generate');
    await assert.rejects(check(107, id(3)), /administrateurs/, 'a suspended club cannot generate');
    await assert.rejects(record(106), /administrateurs/, 'nor count a generation for another club');
    assert.equal(await check(108), 30, 'super-admin in support can');
    await assert.rejects(as(101, 'SELECT * FROM post_generations'), /permission denied/, 'the log is not readable directly');

    await db.exec(`UPDATE clubs SET post_gen_monthly_limit=2 WHERE id='${id(1)}'`);
    await record(101);
    assert.equal(await check(101), 1);
    await record(101);
    await assert.rejects(check(101), /Limite de 2 générations/);
    assert.equal(await check(106, id(2)), 30, 'the quota is per club');

    await db.exec(`UPDATE post_generations SET created_at = now() - interval '40 days'`);
    assert.equal(await check(101), 2, 'the previous months do not count');
    const row = (await db.query('SELECT actor_id,input_tokens,output_tokens FROM post_generations LIMIT 1')).rows[0];
    assert.deepEqual(row, { actor_id: id(101), input_tokens: 10, output_tokens: 20 });

    await db.exec(`UPDATE post_generations SET created_at = now()`);
    await assert.rejects(check(106, id(2), 2), /momentanément indisponible/, 'global daily breaker applies to every club');
    await assert.rejects(check(106, id(2), 0), /momentanément indisponible/);
  } finally {
    await db.close();
  }
});
