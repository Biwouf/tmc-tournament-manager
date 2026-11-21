// Onboarding W3 (brief SAAS_11 §13.4) — nettoyage du logo dans le worker (`kind: 'logo'`, sharp) :
// fixtures réelles Moissac 60820110 (JPEG 200 px, fond noir) et Blagnac 60310304 (JPEG 460 × 650,
// fond blanc), diagnostic (coins, alpha, petit, illisible), rien de redessiné, durée, gestionnaire.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import sharp from '../services/tenup-worker/node_modules/sharp/dist/index.mjs';
import { extractPalette, LOGO_VARIANTS, pimpLogo, pimpLogoFromUrl, validLogoUrl } from '../services/tenup-worker/pimp-logo.mjs';
import { createHandler } from '../services/tenup-worker/server.mjs';
import { extractPalette as clientPalette } from '../src/lib/clubSignup.ts';

const fixture = (name) => readFile(new URL(`./fixtures/logos/${name}`, import.meta.url));
const decode = (b64) => Buffer.from(b64, 'base64');

/** Boîte des pixels assez opaques d'un PNG, en fraction du côté. */
async function opaqueBox(buffer, threshold = 128) {
  const { data, info } = await sharp(buffer).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  let left = info.width, right = -1, top = info.height, bottom = -1;
  for (let y = 0; y < info.height; y++) for (let x = 0; x < info.width; x++) {
    if (data[(y * info.width + x) * 4 + 3] < threshold) continue;
    left = Math.min(left, x); right = Math.max(right, x); top = Math.min(top, y); bottom = Math.max(bottom, y);
  }
  return { width: (right - left + 1) / info.width, height: (bottom - top + 1) / info.height, info };
}

/** Image unie de `size` px avec un disque coloré au centre (fond relié au bord). */
const badge = (size, background, fill = '#0a238a', extra = '') => sharp(Buffer.from(
  `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}"><rect width="100%" height="100%" fill="${background}"/>` +
  `<circle cx="${size / 2}" cy="${size / 2}" r="${size * 0.3}" fill="${fill}"/>${extra}</svg>`)).jpeg({ quality: 92 }).toBuffer();

test('Moissac 60820110: black background removed, round badge, maskable at 0.78, palette without the JPEG noise', async () => {
  const source = await fixture('60820110-moissac.jpg');
  const result = await pimpLogo(source);
  assert.equal(result.verdict, 'cleaned');
  assert.deepEqual(result.source, { width: 200, height: 200, format: 'jpeg', alpha: false });
  assert.deepEqual(result.changes, { background: 'black', trimmed: true, upscaled: true });
  assert.equal(result.round, true);
  assert.ok(result.diagnostic.removed_share > 0.4, 'the black corners are gone');
  assert.deepEqual(Object.keys(result.variants), LOGO_VARIANTS);
  for (const [name, b64] of Object.entries(result.variants)) {
    const meta = await sharp(decode(b64)).metadata();
    assert.equal(meta.format, 'png', name);
    const size = Number(name.split('-').pop());
    assert.equal(meta.width, name === 'clean-1024' ? Math.min(1024, meta.width) : size, name);
    assert.equal(meta.width, meta.height, `${name} is square`);
  }
  // Badge plein dans la pastille, sans anneau noir.
  const clean = await sharp(decode(result.variants['clean-1024'])).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  const corner = clean.data[3];
  assert.equal(corner, 0, 'transparent corner');
  const avatar = await opaqueBox(decode(result.variants['avatar-256']));
  assert.ok(Math.abs(avatar.width - 0.92) < 0.03, `avatar fills 92 % (${avatar.width})`);
  const maskable = await opaqueBox(decode(result.variants['maskable-512']), 250);
  assert.equal(maskable.width, 1, 'maskable icon is opaque (white background)');
  const { data, info } = await sharp(decode(result.variants['maskable-512'])).removeAlpha().raw().toBuffer({ resolveWithObject: true });
  let left = info.width, right = 0;
  const row = Math.floor(info.height / 2);
  for (let x = 0; x < info.width; x++) {
    const i = (row * info.width + x) * 3;
    if (data[i] < 200 || data[i + 1] < 200 || data[i + 2] < 200) { left = Math.min(left, x); right = Math.max(right, x); }
  }
  assert.ok(Math.abs((right - left + 1) / 512 - 0.78) < 0.03, `badge at 0.78 of the maskable icon (${(right - left + 1) / 512})`);
  assert.equal(result.palette[0], '#f36524');
  assert.ok(!result.palette.includes('#0e1124'), 'no background noise in the palette');
  for (const hex of result.palette) {
    const [r, g, b] = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16));
    assert.ok(Math.max(r, g, b) > 40, `${hex} is not the black background`);
  }
});

test('Blagnac 60310304: white background removed, logo 1.7 × larger in the 64 px pastille', async () => {
  const result = await pimpLogo(await fixture('60310304-blagnac.jpg'));
  assert.equal(result.verdict, 'cleaned');
  assert.deepEqual(result.changes, { background: 'white', trimmed: true, upscaled: false });
  assert.equal(result.round, true);
  // Avant : l'image 460 × 650 en `contain` dans le rond ; après : l'avatar, logo sur 92 %.
  const { crop } = result.diagnostic;
  const before = Math.max(crop.width, crop.height) / 650;
  const after = (await opaqueBox(decode(result.variants['avatar-256']))).width;
  assert.ok(after / before >= 1.7, `${(after / before).toFixed(2)} × larger`);
});

test('nothing is redrawn: kept pixels differ from the source by < 3 % on average', async () => {
  for (const name of ['60820110-moissac.jpg', '60310304-blagnac.jpg']) {
    const source = await fixture(name);
    const result = await pimpLogo(source);
    const clean = decode(result.variants['clean-1024']);
    const side = (await sharp(clean).metadata()).width;
    // Référence : la source agrandie de la même façon (Lanczos, SANS accentuation), rognée au même
    // cadre et posée dans le même carré. L'écart mesure l'accentuation, la palette PNG et le bord.
    const { crop } = result.diagnostic;
    const factor = result.changes.upscaled ? 4 : 1;
    const [bw, bh] = [Math.round(crop.width * factor), Math.round(crop.height * factor)];
    const square = Math.max(bw, bh);
    const big = await sharp(source).resize(result.source.width * factor, result.source.height * factor, { kernel: 'lanczos3', fit: 'fill' }).ensureAlpha().png().toBuffer();
    const cut = await sharp(big).extract({ left: Math.round(crop.left * factor), top: Math.round(crop.top * factor), width: bw, height: bh }).png().toBuffer();
    const placed = await sharp(cut).extend({ left: Math.floor((square - bw) / 2), right: Math.ceil((square - bw) / 2), top: Math.floor((square - bh) / 2), bottom: Math.ceil((square - bh) / 2), background: { r: 0, g: 0, b: 0, alpha: 0 } }).png().toBuffer();
    const ref = await sharp(placed).resize(side, side, { kernel: 'lanczos3' }).ensureAlpha().raw().toBuffer();
    const got = await sharp(clean).ensureAlpha().raw().toBuffer();
    let diff = 0, count = 0;
    for (let i = 0; i < got.length; i += 4) {
      if (got[i + 3] < 255 || ref[i + 3] < 255) continue;
      diff += (Math.abs(got[i] - ref[i]) + Math.abs(got[i + 1] - ref[i + 1]) + Math.abs(got[i + 2] - ref[i + 2])) / 3;
      count++;
    }
    const mean = diff / count / 255;
    assert.ok(count > side * side * 0.3, `${name}: enough kept pixels`);
    assert.ok(mean < 0.03, `${name}: mean difference ${(mean * 100).toFixed(2)} %`);
  }
});

test('diagnostic: photo or gradient not cut out; internal background colour kept; transparent, small, empty, unreadable', async () => {
  // Dégradé : coins non uniformes → ni détourage ni recadrage, rien à annoncer.
  const gradient = await sharp(Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" width="300" height="300"><defs><linearGradient id="g"><stop offset="0" stop-color="#123"/><stop offset="1" stop-color="#e94"/></linearGradient></defs><rect width="100%" height="100%" fill="url(#g)"/><circle cx="150" cy="150" r="80" fill="#fff"/></svg>')).jpeg().toBuffer();
  const photo = await pimpLogo(gradient);
  assert.equal(photo.verdict, 'unchanged');
  assert.equal(photo.diagnostic.corners_uniform, false);
  assert.equal(photo.diagnostic.removed_share, 0);
  assert.equal(photo.variants, undefined);

  // Noir à l'intérieur du dessin, non relié au bord : il reste.
  const ring = await badge(300, '#000', '#f26524', '<circle cx="150" cy="150" r="40" fill="#000"/>');
  const kept = await pimpLogo(ring);
  assert.equal(kept.verdict, 'cleaned');
  const { data, info } = await sharp(decode(kept.variants['clean-1024'])).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  const center = (Math.floor(info.height / 2) * info.width + Math.floor(info.width / 2)) * 4;
  assert.equal(data[center + 3], 255, 'inner black stays opaque');
  assert.ok(data[center] < 40, 'and black');

  // Déjà transparent et serré : rien à faire. Avec de grandes marges : recadré, sans fond annoncé.
  const tight = await sharp(Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" width="200" height="200"><circle cx="100" cy="100" r="100" fill="#0a238a"/></svg>')).png().toBuffer();
  assert.equal((await pimpLogo(tight)).verdict, 'unchanged');
  const margins = await sharp(tight).extend({ top: 250, bottom: 250, left: 250, right: 250, background: { r: 0, g: 0, b: 0, alpha: 0 } }).png().toBuffer();
  const trimmed = await pimpLogo(margins);
  assert.equal(trimmed.verdict, 'cleaned');
  assert.deepEqual(trimmed.changes, { background: null, trimmed: true, upscaled: false });

  assert.deepEqual(await pimpLogo(await badge(80, '#000')).then(({ verdict, reason }) => ({ verdict, reason })), { verdict: 'monogram', reason: 'small' });
  const empty = await sharp({ create: { width: 300, height: 300, channels: 3, background: '#fff' } }).composite([{ input: Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" width="10" height="10"><rect width="10" height="10" fill="#000"/></svg>'), left: 140, top: 140 }]).png().toBuffer();
  assert.deepEqual(await pimpLogo(empty).then(({ verdict, reason }) => ({ verdict, reason })), { verdict: 'monogram', reason: 'empty' });
  assert.deepEqual(await pimpLogo(Buffer.from('pas une image')).then(({ verdict, reason }) => ({ verdict, reason })), { verdict: 'monogram', reason: 'unreadable' });
});

test('≤ 1 s per logo, and the worker palette is the tunnel palette', async () => {
  for (const name of ['60820110-moissac.jpg', '60310304-blagnac.jpg']) {
    const source = await fixture(name);
    await pimpLogo(source);
    const runs = [];
    for (let i = 0; i < 3; i++) runs.push((await pimpLogo(source)).ms);
    const median = runs.sort((a, b) => a - b)[1];
    console.log(`[logo] ${name}: ${median} ms (médiane de 3)`);
    assert.ok(median <= 1000, `${name}: ${median} ms`);
  }
  const pixels = await sharp(await fixture('60310304-blagnac.jpg')).resize(48, 48, { fit: 'fill' }).ensureAlpha().raw().toBuffer();
  assert.deepEqual(extractPalette(pixels), clientPalette(pixels));
});

test('logo URL: cmsclub.fft.fr over HTTPS only, no redirect, 5 MB max', async () => {
  assert.equal(validLogoUrl('https://cmsclub.fft.fr/60/82/0110/a.jpg'), true);
  for (const bad of ['http://cmsclub.fft.fr/a.jpg', 'https://evil.test/a.jpg', 'https://cmsclub.fft.fr:444/a.jpg', 'https://u:p@cmsclub.fft.fr/a.jpg', null, 'x'.repeat(600)]) {
    assert.equal(validLogoUrl(bad), false, String(bad).slice(0, 40));
  }
  await assert.rejects(pimpLogoFromUrl('https://evil.test/a.jpg', async () => { throw new Error('no fetch'); }), /Invalid logo URL/);
  const seen = [];
  const source = await fixture('60820110-moissac.jpg');
  const result = await pimpLogoFromUrl('https://cmsclub.fft.fr/a.jpg', async (url, init) => { seen.push([url, init.redirect]); return new Response(source); });
  assert.deepEqual(seen, [['https://cmsclub.fft.fr/a.jpg', 'error']]);
  assert.equal(result.verdict, 'cleaned');
  await assert.rejects(pimpLogoFromUrl('https://cmsclub.fft.fr/a.jpg', async () => new Response('x', { headers: { 'content-length': String(6 * 1024 * 1024) } })), /too large/);
  await assert.rejects(pimpLogoFromUrl('https://cmsclub.fft.fr/a.jpg', async () => new Response('x', { status: 404 })), /HTTP 404/);
});

test('worker handler: kind logo skips the Chromium lock and the cache, refuses other hosts, never leaks an error', async () => {
  const token = 't'.repeat(40);
  let release;
  const calls = [];
  const handler = createHandler({
    token,
    extract: () => new Promise((resolve) => { release = resolve; }),
    pimp: async (url) => { calls.push(url); if (url.endsWith('/boom.jpg')) throw new Error('decode failed'); return { verdict: 'unchanged', ms: 1 }; },
  });
  const call = (body) => new Promise((resolve) => {
    const res = { headersSent: false, writeHead(status) { this.status = status; this.headersSent = true; }, end(text) { resolve({ status: this.status, body: JSON.parse(text) }); } };
    handler({ method: 'POST', url: '/extract', headers: { authorization: `Bearer ${token}` }, body }, res);
  });
  const pending = call({ kind: 'club-identity', url: 'https://tenup.fft.fr/club/60820110' }); // tient le verrou
  assert.deepEqual(await call({ kind: 'logo', url: 'https://cmsclub.fft.fr/a.jpg' }), { status: 200, body: { verdict: 'unchanged', ms: 1 } });
  await call({ kind: 'logo', url: 'https://cmsclub.fft.fr/a.jpg' });
  assert.equal(calls.length, 2, 'not cached');
  assert.equal((await call({ kind: 'logo', url: 'https://tenup.fft.fr/a.jpg' })).status, 400);
  const errors = [];
  const original = console.error;
  console.error = (...args) => errors.push(args);
  try { assert.deepEqual(await call({ kind: 'logo', url: 'https://cmsclub.fft.fr/boom.jpg' }), { status: 502, body: { error: 'Logo indisponible.' } }); }
  finally { console.error = original; }
  assert.equal(errors.length, 1);
  release({ ok: true });
  assert.equal((await pending).status, 200);
});
