// Onboarding W3 (brief SAAS_11 §13.4) — migration 2026112001 dans PGlite : `club_self_serve_create`
// écrit `brand.logo_original` / `brand.logo_variants` et l'événement `logo_choice` ; contrôle des
// chemins ; contrainte d'événements étendue sans perdre ceux de W1 ; `club_public_brand` expose
// les variantes ; CAC inchangé.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { PGlite } from '@electric-sql/pglite';
import { LOGO_VARIANTS } from '../shared/tenupLogo.mjs';

const id = (n) => `00000000-0000-0000-0000-${String(n).padStart(12, '0')}`;
const migration = (file) => readFile(new URL(`../supabase/migrations/${file}`, import.meta.url), 'utf8');
const between = (text, start, end) => text.slice(text.indexOf(start), end ? text.indexOf(end) : undefined);
const CAC = id(1), OUTSIDER = id(109);
const IMAGES = (club) => `https://project.supabase.co/storage/v1/object/public/content-images/${club}/config`;
const HASH = (c) => c.repeat(64);

async function fixture({ duplicate = false, videoEvents = null } = {}) {
  const db = new PGlite();
  const socle = await migration('20260629_multi_tenant_socle.sql');
  const rls = await migration('20260816_multi_tenant_rls.sql');
  await db.exec(`
    CREATE ROLE anon; CREATE ROLE authenticated; CREATE ROLE service_role BYPASSRLS; -- comme sur Supabase
    CREATE SCHEMA auth; CREATE SCHEMA storage;
    CREATE FUNCTION storage.foldername(name text) RETURNS text[] LANGUAGE sql AS $$
      SELECT (string_to_array(name, '/'))[1:array_length(string_to_array(name, '/'), 1) - 1] $$;
    CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $$
      SELECT nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
    CREATE FUNCTION auth.jwt() RETURNS jsonb LANGUAGE sql STABLE AS $$
      SELECT coalesce(nullif(current_setting('request.jwt.claims', true), ''), '{}')::jsonb $$;
    GRANT USAGE ON SCHEMA public, auth, storage TO anon, authenticated, service_role;
    CREATE TABLE auth.users (id uuid PRIMARY KEY, email text, raw_app_meta_data jsonb DEFAULT '{}');
    CREATE TABLE profiles (id uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE);
    CREATE FUNCTION set_updated_at() RETURNS trigger LANGUAGE plpgsql AS $$
      BEGIN NEW.updated_at = now(); RETURN NEW; END $$;
    CREATE TABLE club_signup_requests (club_id uuid, user_id uuid REFERENCES auth.users(id) ON DELETE CASCADE);
  `);
  await db.exec(between(socle, 'DO $$ BEGIN\n  CREATE TYPE club_role', '-- ============================================================\n-- club_id NULLABLE'));
  await db.exec(`
    INSERT INTO clubs (id, slug, name, sport, status) VALUES ('${CAC}', 'cac-tennis', 'CAC Tennis Club', 'tennis', 'active');
    INSERT INTO auth.users (id, email) SELECT ('00000000-0000-0000-0000-' || lpad(n::text, 12, '0'))::uuid,
      'user' || n || '@example.test' FROM generate_series(101, 109) n;
    INSERT INTO profiles (id, is_super_admin) SELECT id, id = '${id(108)}' FROM auth.users;
    INSERT INTO club_members (club_id, user_id, role) VALUES ('${CAC}', '${id(101)}', 'admin'), ('${CAC}', '${id(102)}', 'manager');
  `);
  await db.exec(between(rls, 'CREATE OR REPLACE FUNCTION public.auth_club_ids()', '-- ============================================================\n-- 2.'));
  for (const file of ['2026081802_super_admin_console.sql', '20260909_club_settings_public_read.sql', '2026102601_club_self_serve.sql',
    '2026111401_club_site_publish.sql', '2026111402_tenup_site_profile.sql']) {
    await db.exec(await migration(file));
  }
  // Un club self-serve déjà rattaché à Moissac (import de ses équipes, S6b).
  await db.exec(`INSERT INTO clubs (id, slug, name, sport, status, plan, created_via, trial_ends_at, tenup_club_id)
    VALUES ('${id(2)}', 'tc-alpha', 'TC Alpha', 'tennis', 'active', 'trial', 'self_serve', now() + interval '30 days', '60820110')`);
  if (duplicate) await db.exec(`INSERT INTO clubs (id, slug, name, sport, status, plan, created_via, trial_ends_at, tenup_club_id)
    VALUES ('${id(3)}', 'tc-beta', 'TC Beta', 'tennis', 'active', 'trial', 'self_serve', now() + interval '30 days', '60820110')`);
  await db.exec(await migration('2026111520_tenup_club_unique.sql'));
  for (const file of ['2026092002_public_club_brand.sql', '2026111403_public_brand_short_name.sql', '2026111502_onboarding_events.sql']) await db.exec(await migration(file));
  if (videoEvents) await db.exec(videoEvents);
  await db.exec(await migration('2026112001_logo_variants.sql'));

  async function as(role, user, sql, params = []) {
    await db.exec('BEGIN');
    try {
      await db.query(`SELECT set_config('request.jwt.claim.sub', $1, true), set_config('request.jwt.claims', $2, true)`,
        [user || '', JSON.stringify(user ? { sub: user } : {})]);
      await db.exec(`SET LOCAL ROLE ${role}`);
      const result = await db.query(sql, params);
      await db.exec('COMMIT');
      return result.rows;
    } catch (error) { await db.exec('ROLLBACK'); throw error; }
  }
  let next = 500;
  const create = async ({ email = 'nouveau@example.test', slug = 'moissac-tc', club = id(next++), logo = (c) => `${IMAGES(c)}/logo/1-clean-1024.png`,
    original = (c) => `${IMAGES(c)}/1-logo.webp`, variants = (c) => VARIANTS(c), choice = { verdict: 'cleaned', choice: 'clean' } } = {}) =>
    (await as('service_role', null, 'SELECT club_self_serve_create($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14) r',
      [club, email, 'Moissac Tennis Club', 'Moissac', 'tennis', slug, '#f36524', logo?.(club) ?? null, null, null, 'Moissac TC',
        original?.(club) ?? null, variants ? JSON.stringify(variants(club)) : null, choice ? JSON.stringify(choice) : null]))[0].r;
  const account = (n, email) => db.query('INSERT INTO auth.users (id, email) VALUES ($1, $2)', [id(n), email]);
  return { db, as, create, account };
}

const VARIANTS = (club) => Object.fromEntries(LOGO_VARIANTS.map((name) => [name, `${IMAGES(club)}/logo/1-${name}.png`]));
const code = async (promise) => { try { await promise; return null; } catch (error) { return error.code; } };
const brandOf = async (f, club) => (await f.db.query('SELECT config FROM club_settings WHERE club_id = $1', [club])).rows[0].config.brand;
const events = async (f, club) => (await f.db.query('SELECT name, props FROM onboarding_events WHERE club_id = $1', [club])).rows;

test('logo SQL: retouched logo by default, original and variants kept, logo_choice logged once', async () => {
  const f = await fixture();
  await f.account(301, 'nouveau@example.test');
  const { club_id: club, created } = await f.create();
  assert.equal(created, true);
  const brand = await brandOf(f, club);
  assert.match(brand.logo, /\/logo\/1-clean-1024\.png$/);
  assert.match(brand.logo_original, /\/config\/1-logo\.webp$/);
  assert.deepEqual(brand.logo_variants, VARIANTS(club));
  assert.deepEqual(await events(f, club), [{ name: 'logo_choice', props: { verdict: 'cleaned', choice: 'clean' } }]);
  // Rejeu : rien de plus.
  assert.equal((await f.create({ club: id(777) })).created, false);
  assert.equal((await events(f, club)).length, 1);

  // Original préféré : `brand.logo` = l'original, variantes gardées pour y revenir.
  await f.account(302, 'deux@example.test');
  const second = (await f.create({ email: 'deux@example.test', slug: 'deux-tc', logo: (c) => `${IMAGES(c)}/1-logo.webp` })).club_id;
  assert.equal((await brandOf(f, second)).logo, (await brandOf(f, second)).logo_original);
  // Monogramme : pas de logo, l'original reste restaurable.
  await f.account(303, 'trois@example.test');
  const third = (await f.create({ email: 'trois@example.test', slug: 'trois-tc', logo: null, variants: null, choice: { verdict: 'monogram', choice: 'monogram' } })).club_id;
  const mono = await brandOf(f, third);
  assert.equal('logo' in mono, false);
  assert.equal('logo_variants' in mono, false);
  assert.match(mono.logo_original, /1-logo\.webp$/);
});

test('logo SQL: paths, variant names and choice are checked (PT400)', async () => {
  const f = await fixture();
  await f.account(301, 'nouveau@example.test');
  const other = id(999);
  for (const bad of [
    { original: () => `${IMAGES(other)}/1-logo.webp` },
    { variants: (c) => ({ ...VARIANTS(c), 'clean-1024': `${IMAGES(other)}/logo/1-clean-1024.png` }) },
    { variants: (c) => ({ ...VARIANTS(c), 'clean-1024': `${IMAGES(c)}/1-clean-1024.png` }) }, // hors de logo/
    { variants: (c) => { const { 'email-128': _e, ...rest } = VARIANTS(c); return rest; } },
    { variants: (c) => ({ ...VARIANTS(c), extra: `${IMAGES(c)}/logo/x.png` }) },
    { variants: (c) => ({ ...VARIANTS(c), 'avatar-256': 'javascript:alert(1)' }) },
    { choice: { verdict: 'cleaned', choice: 'other' } },
    { choice: { verdict: 'cleaned', choice: 'clean', email: 'x@y.z' } },
  ]) {
    assert.equal(await code(f.create(bad)), 'PT400', JSON.stringify(Object.keys(bad)));
  }
  assert.equal((await f.db.query("SELECT count(*)::int n FROM onboarding_events WHERE name = 'logo_choice'")).rows[0].n, 0);
  // Appel de 2026111520 (11 arguments) : inchangé, sans événement.
  const bare = (await f.as('service_role', null, 'SELECT club_self_serve_create($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11) r',
    [id(900), 'nouveau@example.test', 'TC Manuel', 'Albi', 'tennis', 'tc-manuel', '#1d4ed8', null, null, null, null]))[0].r;
  assert.equal(bare.created, true);
  assert.deepEqual(await events(f, id(900)), []);
  assert.equal((await f.db.query("SELECT count(*)::int n FROM pg_proc WHERE proname = 'club_self_serve_create'")).rows[0].n, 1);
  for (const role of ['anon', 'authenticated']) assert.equal(await code(f.as(role, role === 'anon' ? null : OUTSIDER, 'SELECT club_self_serve_create($1,$2,$3,$4,$5,$6,$7,$8,$9) r',
    [id(901), 'nouveau@example.test', 'TC X', 'Albi', 'tennis', 'tc-x', '#1d4ed8', null, null])), '42501');
});

test('logo SQL: the event constraint is extended, W1 video events kept whichever lands first; public brand', async () => {
  const w1 = (await migration('2026111502_onboarding_events.sql')).length && `
    ALTER TABLE public.onboarding_events DROP CONSTRAINT onboarding_events_name_check;
    ALTER TABLE public.onboarding_events ADD CONSTRAINT onboarding_events_name_check CHECK (name IN (
      'club_activated', 'teams_import_started', 'teams_imported', 'poster_generated', 'app_shared', 'site_published',
      'first_steps_finished', 'video_previewed', 'video_exported', 'video_shared', 'video_export_failed'));`;
  const f = await fixture({ videoEvents: w1 });
  for (const name of ['logo_choice', 'video_shared', 'club_activated']) {
    assert.equal(await code(f.db.query('INSERT INTO onboarding_events (club_id, name) VALUES ($1, $2)', [CAC, name])), null, name);
  }
  assert.equal(await code(f.db.query("INSERT INTO onboarding_events (club_id, name) VALUES ($1, 'inconnu')", [CAC])), '23514');
  // Rejouable.
  await f.db.exec(await migration('2026112001_logo_variants.sql'));

  await f.account(301, 'nouveau@example.test');
  const club = (await f.create()).club_id;
  await f.db.query("UPDATE clubs SET status = 'active', trial_ends_at = now() + interval '30 days' WHERE id = $1", [club]);
  const brand = (await f.as('anon', null, 'SELECT club_public_brand($1) b', [club]))[0].b.brand;
  assert.deepEqual(brand.logo_variants, VARIANTS(club));
  assert.equal(brand.short_name, 'Moissac TC');
  // CAC : rien de nouveau.
  const cac = (await f.as('anon', null, 'SELECT club_public_brand($1) b', [CAC]))[0].b.brand;
  assert.equal(cac.logo_variants, null);
  assert.deepEqual((await f.db.query('SELECT status, plan FROM clubs WHERE id = $1', [CAC])).rows[0], { status: 'active', plan: 'internal' });
});
