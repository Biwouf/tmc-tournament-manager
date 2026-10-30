// SaaS S3 — logique du tunnel d'inscription (src/lib/clubSignup.ts) et source partagée des
// tokens de marque (shared/brandTokens.mjs). Le module TS est chargé par le type stripping de Node.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { signupSlugProblem } from '../shared/clubSlug.mjs';
import { brandTokens } from '../shared/brandTokens.mjs';
const lib = await import('../src/lib/clubSignup.ts');
const root = new URL('..', import.meta.url).pathname;

test('slugify : mots vides retirés, accents, 32 caractères sans tiret final', () => {
  assert.equal(lib.slugify('Tennis Club de Saint-Aubin'), 'tennis-club-saint-aubin');
  assert.equal(lib.slugify('Étoile Sportive d’Écully'), 'etoile-sportive-ecully');
  assert.equal(lib.slugify("Les Amis du Tennis et de l'Arbre"), 'amis-tennis-arbre');
  assert.equal(lib.slugify('  '), '');
  const long = lib.slugify('Association Sportive Municipale Tennis Castelsarrasin Moissac');
  assert.ok(long.length <= 32 && !long.endsWith('-'), long);
  for (const name of ['Tennis Club de Saint-Aubin', 'CAC Tennis', 'TC Montauban 82']) assert.equal(signupSlugProblem(lib.slugify(name)), null, name);
});

test('saisie et suggestion d’adresse', () => {
  assert.equal(lib.cleanSlugInput('TC Saint Aubin'), 'tc-saint-aubin');
  assert.equal(lib.cleanSlugInput('Été_92!'), 'ete92');
  assert.equal(lib.cleanSlugInput('x'.repeat(40)).length, 32);
  assert.equal(lib.suggestSlug('tc-saint-aubin', 'Montauban'), 'tc-saint-aubin-montauban');
  assert.equal(lib.suggestSlug('tc-montauban', 'Montauban'), null, 'la ville y est déjà');
  assert.equal(lib.suggestSlug('tc', ''), null);
  assert.equal(lib.suggestSlug('a'.repeat(30), 'Albi').length, 32);
});

test('messages de disponibilité', () => {
  assert.equal(lib.slugMessage({ state: 'idle' }), '');
  assert.match(lib.slugMessage({ state: 'available' }), /disponible/);
  assert.match(lib.slugMessage({ state: 'unavailable', reason: 'taken' }), /déjà prise/);
  assert.match(lib.slugMessage({ state: 'unavailable', reason: 'reserved' }), /réservée/);
  assert.match(lib.slugMessage({ state: 'unavailable', reason: 'format' }), /3 à 32/);
});

function pixels(...runs) {
  const data = [];
  for (const [count, [r, g, b, a = 255]] of runs) for (let i = 0; i < count; i++) data.push(r, g, b, a);
  return Uint8ClampedArray.from(data);
}

test('extractPalette : teintes dominantes, sans fond blanc, noir ni transparence', () => {
  const palette = lib.extractPalette(pixels(
    [900, [31, 107, 74]], [300, [232, 197, 71]], [2000, [255, 255, 255]], [500, [0, 0, 0]], [400, [200, 30, 30, 0]],
  ));
  assert.deepEqual(palette, ['#1f6b4a', '#e8c547']);
  // Deux verts voisins ne font qu'une teinte ; jamais plus de quatre.
  assert.equal(lib.extractPalette(pixels([500, [31, 107, 74]], [400, [40, 112, 80]])).length, 1);
  const many = lib.extractPalette(pixels([100, [200, 20, 20]], [100, [20, 200, 20]], [100, [20, 20, 200]], [100, [200, 200, 20]], [100, [200, 20, 200]]));
  assert.equal(many.length, 4);
  assert.deepEqual(lib.extractPalette(pixels([100, [255, 255, 255]])), []);
  // La saturation pèse : un rouge vif minoritaire passe devant un gris majoritaire.
  assert.equal(lib.extractPalette(pixels([300, [120, 120, 120]], [200, [229, 24, 40]]))[0], '#e51828');
});

test('codes de club-signup → message humain et étape à corriger', () => {
  assert.deepEqual(lib.signupOutcome(200), { ok: true });
  const cases = [
    [409, {}, 3, /prise/, true, 'taken'],
    [400, { reason: 'reserved' }, 3, /pas disponible/, true, 'reserved'],
    [400, { error: 'Image attendue : PNG, JPEG ou WebP.' }, 2, /PNG/, true, undefined],
    [400, { error: 'Informations incomplètes ou invalides.' }, 4, /incomplètes/, true, undefined],
    [413, {}, 2, /5 Mo/, true, undefined],
    [429, {}, 4, /une heure/, true, undefined],
    [403, {}, 4, /anti-robot/, true, undefined],
    [502, {}, 4, /e-mail n’a pas pu partir/, true, undefined],
    [500, {}, 4, /momentanément indisponible/, true, undefined],
    [503, undefined, 4, /momentanément indisponible/, true, undefined],
    ['network', undefined, 4, /réseau/, false, undefined],
  ];
  for (const [status, body, step, message, reset, reason] of cases) {
    const outcome = lib.signupOutcome(status, body);
    assert.equal(outcome.ok, false, String(status));
    assert.equal(outcome.step, step, String(status));
    assert.match(outcome.message, message, String(status));
    assert.equal(outcome.resetTurnstile, reset, String(status));
    assert.equal(outcome.slugReason, reason, String(status));
  }
});

test('envoi : formulaire multipart attendu par club-signup, réseau coupé', async () => {
  let sent;
  const ok = await lib.submitClubSignup(async (url, init) => { sent = { url, form: init.body }; return Response.json({ ok: true }); }, 'https://x/functions/v1/club-signup', {
    name: ' TC Nouveau ', city: 'Moissac', slug: 'tc-nouveau', color: '#1f6b4a', email: ' Président@Club.FR ', turnstileToken: 'jeton',
    logo: new Blob(['x'], { type: 'image/webp' }), photo: null,
  });
  assert.deepEqual(ok, { ok: true });
  assert.equal(sent.url, 'https://x/functions/v1/club-signup');
  const fields = Object.fromEntries([...sent.form.entries()].filter(([, v]) => typeof v === 'string'));
  assert.deepEqual(fields, { name: 'TC Nouveau', city: 'Moissac', sport: 'tennis', slug: 'tc-nouveau', color: '#1f6b4a', email: 'président@club.fr', turnstile_token: 'jeton' });
  assert.equal(sent.form.get('logo').name, 'logo.webp');
  assert.equal(sent.form.get('photo'), null);
  const taken = await lib.submitClubSignup(async () => Response.json({ error: 'pris', reason: 'taken' }, { status: 409 }), 'u', { name: 'a', city: 'b', slug: 'c', color: '#000000', email: 'a@b.c', turnstileToken: 't' });
  assert.equal(taken.step, 3);
  const offline = await lib.submitClubSignup(async () => { throw new TypeError('Failed to fetch'); }, 'u', { name: 'a', city: 'b', slug: 'c', color: '#000000', email: 'a@b.c', turnstileToken: 't' });
  assert.equal(offline.status, 0); assert.equal(offline.resetTurnstile, false);
  const html = await lib.submitClubSignup(async () => new Response('<html>', { status: 502 }), 'u', { name: 'a', city: 'b', slug: 'c', color: '#000000', email: 'a@b.c', turnstileToken: 't' });
  assert.equal(html.status, 502);
});

function memoryStorage(quota = Infinity) {
  const map = new Map();
  return { map, getItem: k => map.get(k) ?? null, setItem: (k, v) => { if (v.length > quota) throw new Error('QuotaExceededError'); map.set(k, v); } };
}

test('saisie conservée au rechargement, sans les images trop lourdes', () => {
  const storage = memoryStorage();
  assert.deepEqual(lib.loadDraft(storage), lib.emptyDraft());
  const draft = { ...lib.emptyDraft(), step: 3, name: 'TC Nouveau', city: 'Moissac', slug: 'tc-nouveau', slugEdited: true, color: '#1f6b4a',
    palette: ['#1f6b4a', '#e8c547'], email: 'a@b.fr', logo: 'data:image/webp;base64,AAAA', photo: 'data:image/webp;base64,' + 'A'.repeat(lib.MAX_STORED_IMAGE) };
  lib.saveDraft(storage, draft);
  const back = lib.loadDraft(storage);
  assert.deepEqual(back, { ...draft, photo: null }, 'photo trop lourde abandonnée, le reste conservé');
  // Quota dépassé même sans la grande image : la saisie est écrite sans aucune image.
  const tight = memoryStorage(400);
  lib.saveDraft(tight, { ...draft, logo: 'data:image/webp;base64,' + 'B'.repeat(500), photo: null });
  assert.equal(lib.loadDraft(tight).name, 'TC Nouveau');
  assert.equal(lib.loadDraft(tight).logo, null);
});

test('saisie conservée : lecture tolérante', () => {
  const storage = memoryStorage();
  storage.setItem(lib.DRAFT_KEY, '{abîmé');
  assert.deepEqual(lib.loadDraft(storage), lib.emptyDraft());
  storage.setItem(lib.DRAFT_KEY, JSON.stringify({ step: 9, color: 'red', palette: ['#zzzzzz', '#123456'], sample: 7, slug: 'Mon Club!', logo: 'javascript:alert(1)', name: 42 }));
  const draft = lib.loadDraft(storage);
  assert.equal(draft.step, 1); assert.equal(draft.color, lib.BRAND_FALLBACK); assert.deepEqual(draft.palette, ['#123456']);
  assert.equal(draft.sample, null); assert.equal(draft.slug, 'mon-club'); assert.equal(draft.logo, null); assert.equal(draft.name, '');
  storage.setItem(lib.DRAFT_KEY, JSON.stringify({ step: 'sent' }));
  assert.equal(lib.loadDraft(storage).step, 4, 'confirmation sans envoi connu → étape 4');
  storage.setItem(lib.DRAFT_KEY, JSON.stringify({ step: 'sent', sent: { email: 'a@b.fr', slug: 'tc' } }));
  assert.deepEqual(lib.loadDraft(storage).sent, { email: 'a@b.fr', slug: 'tc' });
});

test('configuration : fermé sans clé Turnstile ni pages juridiques, valeurs de test en dev seulement', () => {
  assert.equal(lib.signupConfig({}).open, false);
  assert.equal(lib.signupConfig({ VITE_TURNSTILE_SITE_KEY: 'k', VITE_SIGNUP_TERMS_URL: 'https://www.feelike.pro/cgu' }).open, false);
  const prod = lib.signupConfig({ VITE_TURNSTILE_SITE_KEY: 'k', VITE_SIGNUP_TERMS_URL: 'https://t', VITE_SIGNUP_PRIVACY_URL: 'https://p' });
  assert.deepEqual(prod, { siteKey: 'k', termsUrl: 'https://t', privacyUrl: 'https://p', open: true });
  const dev = lib.signupConfig({ DEV: true });
  assert.equal(dev.open, true); assert.equal(dev.siteKey, lib.TURNSTILE_TEST_SITE_KEY);
  assert.notEqual(lib.signupConfig({ DEV: false }).siteKey, lib.TURNSTILE_TEST_SITE_KEY);
});

// Critère 3 du brief : l'aperçu et la vitrine posent les mêmes fonds et textes de marque.
test('tokens de marque : une seule fonction pour la vitrine et l’aperçu', () => {
  const light = brandTokens('#e8c547');
  assert.equal(light['--brand-fill'], light['--brand']);
  assert.equal(light['--brand-foreground'], 'hsl(5.5 15.1% 14.3%)', 'encre sur le jaune');
  const green = brandTokens('#3a9a5c');
  assert.equal(green['--brand-fill'], green['--brand']);
  assert.equal(green['--brand-foreground'], 'hsl(5.5 15.1% 14.3%)', 'encre sur le vert moyen');
  const source = (file) => readFileSync(join(root, file), 'utf8');
  assert.match(source('web/src/lib/tokens.ts'), /from '\.\.\/\.\.\/\.\.\/shared\/brandTokens\.mjs'/);
  assert.match(source('src/components/signup/SignupPreview.tsx'), /from '\.\.\/\.\.\/\.\.\/shared\/brandTokens\.mjs'/);
  for (const file of ['web/src/lib/tokens.ts', 'src/components/signup/SignupPreview.tsx', 'src/pages/SignupTunnelPage.tsx']) {
    assert.doesNotMatch(source(file), /function (hexToHsl|luminance|darkenUntil)/, `${file} ne recopie pas le calcul`);
  }
});

// Critère 2 : la règle du slug n'existe qu'une fois côté code (les copies SQL sont testées
// par club-signup-sql.test.mjs).
test('aucune copie de la regex de slug ni de la liste des réservés hors de shared/clubSlug.mjs', () => {
  const files = [];
  const walk = (dir) => {
    for (const name of readdirSync(dir)) {
      if (['node_modules', 'dist', '.astro', 'migrations', 'tests'].includes(name)) continue;
      const path = join(dir, name);
      if (statSync(path).isDirectory()) walk(path);
      else if (/\.(m?[jt]sx?|astro)$/.test(name)) files.push(path);
    }
  };
  for (const dir of ['src', 'pwa/src', 'web/src', 'web/server.mjs', 'shared', 'supabase/functions', 'landing/src']) {
    const path = join(root, dir);
    if (statSync(path).isDirectory()) walk(path); else files.push(path);
  }
  const offenders = files.filter(file => !file.endsWith('shared/clubSlug.mjs'))
    .filter(file => /\{1,30\}|'static',\s*'assets'|"static",\s*"assets"/.test(readFileSync(file, 'utf8')))
    .map(file => relative(root, file));
  assert.deepEqual(offenders, []);
});
