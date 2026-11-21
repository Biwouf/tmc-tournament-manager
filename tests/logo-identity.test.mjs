// Onboarding W3 (brief SAAS_11 §13.4) — après l'inscription : Configuration › Identité propose
// « Revenir au logo d'origine » / « Utiliser le logo retouché » (`LogoVariantSwitch`), la config
// tolère `logo_original` / `logo_variants` absents, et la PWA tire ses icônes des variantes
// seulement quand `brand.logo` est le logo retouché (`appIcons.ts`).
import test from 'node:test';
import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { mkdir, rm } from 'node:fs/promises';
import { createElement as h } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { LOGO_VARIANTS } from '../shared/tenupLogo.mjs';

const dir = new URL('../node_modules/.tmp/logo-identity/', import.meta.url);
async function bundle(entry, name) {
  await mkdir(dir, { recursive: true });
  const out = new URL(`${name}.mjs`, dir);
  await build({ entryPoints: [new URL(entry, import.meta.url).pathname], outfile: out.pathname, bundle: true, platform: 'node', format: 'esm',
    jsx: 'automatic', packages: 'external', loader: { '.css': 'empty' } });
  return import(out.href);
}
test.after(() => rm(dir, { recursive: true, force: true }));

const BASE = 'https://x.supabase.co/storage/v1/object/public/content-images/club/config';
const VARIANTS = Object.fromEntries(LOGO_VARIANTS.map((n) => [n, `${BASE}/logo/1-${n}.png`]));
const ORIGINAL = `${BASE}/1-logo.jpg`;

test('Identité : bascule entre l’original Ten’Up et le logo retouché, rien sans original', async () => {
  const { LogoVariantSwitch } = await bundle('../src/components/siteConfig/SiteConfigFields.tsx', 'fields');
  const render = (props) => renderToStaticMarkup(h(LogoVariantSwitch, { onChange: () => {}, ...props }));
  assert.match(render({ value: VARIANTS['clean-1024'], original: ORIGINAL, clean: VARIANTS['clean-1024'] }), /Revenir au logo d’origine/);
  assert.match(render({ value: ORIGINAL, original: ORIGINAL, clean: VARIANTS['clean-1024'] }), /Utiliser le logo retouché/);
  // Logo changé depuis (fichier du club) : les deux restent proposés, le retouché d'abord.
  assert.match(render({ value: `${BASE}/2-logo.webp`, original: ORIGINAL, clean: VARIANTS['clean-1024'] }), /Utiliser le logo retouché/);
  // Monogramme (pas de variantes) : l'original seulement, et plus rien une fois remis.
  assert.match(render({ value: '', original: ORIGINAL }), /Revenir au logo d’origine/);
  assert.equal(render({ value: ORIGINAL, original: ORIGINAL }), '');
  // Clubs sans original (CAC, saisie manuelle) : rien.
  assert.equal(render({ value: `${BASE}/2-logo.webp` }), '');
});

test('config : logo_original et logo_variants lus quand présents, tolérés absents ou malformés', async () => {
  const { parseClubConfig } = await import('../src/lib/clubConfig.ts');
  const brand = parseClubConfig({ brand: { name: 'Moissac TC', logo: VARIANTS['clean-1024'], logo_original: ORIGINAL, logo_variants: VARIANTS } }).brand;
  assert.equal(brand.logo_original, ORIGINAL);
  assert.deepEqual(brand.logo_variants, VARIANTS);
  const bare = parseClubConfig({ brand: { name: 'CAC Tennis Club', logo: '/logo.png' } }).brand;
  assert.equal(bare.logo_original, undefined);
  assert.equal(bare.logo_variants, undefined);
  const broken = parseClubConfig({ brand: { name: 'X', logo_variants: 'pas un objet', logo_original: 42 } }).brand;
  assert.equal(broken.name, 'X', 'la lecture ne jette jamais');
  assert.equal(broken.logo_variants, undefined);
});

test('PWA appIcons : variantes seulement pour le logo retouché, sinon le dessin d’avant', async () => {
  const { variantsFor, iconsFromVariants } = await import('../pwa/src/lib/appIcons.ts');
  assert.deepEqual(variantsFor(VARIANTS['clean-1024'], VARIANTS), VARIANTS);
  assert.equal(variantsFor(ORIGINAL, VARIANTS), null, 'original choisi');
  assert.equal(variantsFor('/logo.png', undefined), null, 'club sans variantes (CAC)');
  assert.equal(variantsFor(undefined, VARIANTS), null);
  const { icons, apple180 } = iconsFromVariants(VARIANTS);
  assert.deepEqual(icons, [
    { src: VARIANTS['any-512'], sizes: '512x512', type: 'image/png', purpose: 'any' },
    { src: VARIANTS['maskable-192'], sizes: '192x192', type: 'image/png', purpose: 'maskable' },
    { src: VARIANTS['maskable-512'], sizes: '512x512', type: 'image/png', purpose: 'maskable' },
  ]);
  assert.equal(apple180, VARIANTS['apple-180']);
});
