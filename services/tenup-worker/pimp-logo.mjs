// Onboarding « Ten'Up d'abord », W3 (brief SAAS_11 §13.4) : nettoyage DÉTERMINISTE d'un logo
// Ten'Up avec sharp. Aucune IA, aucun redessin : fond relié au bord retiré, rognage, mise au
// carré, marges, agrandissement Lanczos d'une petite source. Référence : maquettes
// `wow/logo/pipeline/pimp-sharp.mjs`.
//
// 1. Diagnostic : taille, alpha, format, uniformité des 4 coins (écart < 30).
// 2. Fond : coins uniformes et opaques → remplissage depuis les bords (4-connexe, tolérance 60),
//    bord adouci (flou de l'alpha). Seul le fond RELIÉ AU BORD disparaît. Coins non uniformes
//    (photo, dégradé) → pas de détourage.
// 3. Rognage au contenu (alpha), carré transparent.
// 4. Source < 512 px → Lanczos ×4 + accentuation légère.
// 5. Variantes PNG (`LOGO_VARIANTS`), palette recalculée sur le logo détouré.
// 6. Repli monogramme : source < 96 px, contenu < 5 % de l'image, image illisible.
import sharp from 'sharp';

/** Taille de chaque variante ; `clean-1024` ne dépasse pas la définition utile du logo. */
export const LOGO_VARIANTS = ['clean-1024', 'avatar-256', 'maskable-512', 'maskable-192', 'any-512', 'apple-180', 'email-128'];
export const MAX_LOGO_BYTES = 5 * 1024 * 1024;

const TRANSPARENT = { r: 0, g: 0, b: 0, alpha: 0 };
const WHITE = { r: 255, g: 255, b: 255, alpha: 1 };
const CORNER_SPREAD = 30;
const TOLERANCE = 60;
/** Rayon relatif au-delà duquel le logo n'est plus « rond » (bord adouci et JPEG compris). */
const ROUND = 1.06;

/**
 * Même règle que `extractPalette` (`src/lib/clubSignup.ts`), recopiée ici : le worker est
 * déployé seul (Root Directory `services/tenup-worker`). `tests/logo-pimp.test.mjs` vérifie
 * que les deux rendent la même palette.
 */
export function extractPalette(data) {
  const buckets = new Map();
  for (let i = 0; i + 3 < data.length; i += 4) {
    if (data[i + 3] < 128) continue;
    const r = data[i], g = data[i + 1], b = data[i + 2];
    const max = Math.max(r, g, b), min = Math.min(r, g, b);
    if ((max > 235 && min > 220) || max < 22) continue;
    const key = `${r >> 4}-${g >> 4}-${b >> 4}`;
    const bucket = buckets.get(key) ?? { n: 0, r: 0, g: 0, b: 0, s: 0 };
    bucket.n++; bucket.r += r; bucket.g += g; bucket.b += b; bucket.s += max ? (max - min) / max : 0;
    buckets.set(key, bucket);
  }
  const ranked = [...buckets.values()]
    .map((e) => ({ c: [e.r / e.n, e.g / e.n, e.b / e.n], w: e.n * (0.35 + e.s / e.n) }))
    .sort((a, b) => b.w - a.w);
  const out = [];
  for (const { c } of ranked) {
    if (out.every((o) => Math.hypot(o[0] - c[0], o[1] - c[1], o[2] - c[2]) > 70)) out.push(c);
    if (out.length === 4) break;
  }
  return out.map((c) => '#' + c.map((v) => Math.round(v).toString(16).padStart(2, '0')).join(''));
}

/** Moyenne d'un carré de `n` px dans un coin : un seul pixel JPEG est trop bruité. */
function cornerMean(data, W, H, cx, cy, n) {
  const sum = [0, 0, 0, 0];
  const x0 = cx ? W - n : 0, y0 = cy ? H - n : 0;
  for (let y = y0; y < y0 + n; y++) for (let x = x0; x < x0 + n; x++) {
    const i = (y * W + x) * 4;
    for (let k = 0; k < 4; k++) sum[k] += data[i + k];
  }
  return sum.map((v) => v / (n * n));
}

function backgroundKind([r, g, b]) {
  const max = Math.max(r, g, b), min = Math.min(r, g, b);
  if (max < 48) return 'black';
  if (min > 205 && max - min < 30) return 'white';
  return 'color';
}

/** Remplissage depuis les bords : seuls les pixels proches du fond ET reliés au bord deviennent transparents. */
function removeBorderBackground(data, W, H, bg) {
  const seen = new Uint8Array(W * H);
  const stack = new Int32Array(W * H);
  let top = 0, removed = 0;
  const push = (p) => { if (!seen[p]) { seen[p] = 1; stack[top++] = p; } };
  for (let x = 0; x < W; x++) { push(x); push((H - 1) * W + x); }
  for (let y = 0; y < H; y++) { push(y * W); push(y * W + W - 1); }
  while (top) {
    const p = stack[--top];
    const i = p * 4;
    if (Math.hypot(data[i] - bg[0], data[i + 1] - bg[1], data[i + 2] - bg[2]) > TOLERANCE) continue;
    data[i + 3] = 0; removed++;
    const x = p % W, y = (p / W) | 0;
    if (x > 0) push(p - 1);
    if (x < W - 1) push(p + 1);
    if (y > 0) push(p - W);
    if (y < H - 1) push(p + W);
  }
  return removed;
}

/** Boîte du contenu (alpha > 8), `null` si l'image est vide. */
function contentBox(data, W, H) {
  let left = W, right = -1, top = H, bottom = -1;
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    if (data[(y * W + x) * 4 + 3] <= 8) continue;
    if (x < left) left = x; if (x > right) right = x;
    if (y < top) top = y; if (y > bottom) bottom = y;
  }
  return right < 0 ? null : { left, top, width: right - left + 1, height: bottom - top + 1 };
}

/**
 * Rayon du contenu rapporté au demi-côté du carré : ≈ 1 pour un badge rond, √2 pour un carré
 * plein. Sert à grossir un logo rond dans la zone sûre des icônes maskable (cercle de 80 %).
 */
function contentRadius(data, W, box, side) {
  const cx = box.left + box.width / 2, cy = box.top + box.height / 2;
  let max = 0;
  for (let y = box.top; y < box.top + box.height; y++) for (let x = box.left; x < box.left + box.width; x++) {
    if (data[(y * W + x) * 4 + 3] < 128) continue;
    const d = (x + 0.5 - cx) ** 2 + (y + 0.5 - cy) ** 2;
    if (d > max) max = d;
  }
  return Math.sqrt(max) / (side / 2);
}

// PNG en palette (libimagequant, qualité 95) : ~4 × plus léger qu'un PNG sans perte, écart moyen
// invisible (contrôlé par `tests/logo-pimp.test.mjs`) ; effort 3 garde le tout sous 1 s.
const png = (image) => image.png({ compressionLevel: 6, palette: true, quality: 95, effort: 3 }).toBuffer();

/**
 * Traite un logo (octets PNG / JPEG / WebP). Ne jette jamais : une image illisible rend le
 * verdict `monogram`. `variants` (PNG en base64) n'existe que pour `cleaned`.
 */
export async function pimpLogo(input) {
  const started = performance.now();
  const done = (result) => ({ ...result, ms: Math.round(performance.now() - started) });
  let meta;
  try { meta = await sharp(input, { limitInputPixels: 25_000_000 }).metadata(); } catch { return done({ verdict: 'monogram', reason: 'unreadable' }); }
  if (!meta.width || !meta.height || !['png', 'jpeg', 'webp'].includes(meta.format)) return done({ verdict: 'monogram', reason: 'unreadable' });
  const source = { width: meta.width, height: meta.height, format: meta.format, alpha: Boolean(meta.hasAlpha) };
  if (Math.min(meta.width, meta.height) < 96) return done({ verdict: 'monogram', reason: 'small', source });

  // Pixels de travail : ×4 en Lanczos sous 512 px (pas d'invention de détails), 2048 px au plus.
  const longest = Math.max(meta.width, meta.height);
  const factor = longest < 512 ? 4 : longest > 2048 ? 2048 / longest : 1;
  const W = Math.max(1, Math.round(meta.width * factor)), H = Math.max(1, Math.round(meta.height * factor));
  let work = sharp(input).resize({ width: W, height: H, fit: 'fill', kernel: 'lanczos3' });
  if (factor > 1) work = work.sharpen({ sigma: 0.8 });
  const data = await work.ensureAlpha().raw().toBuffer();

  // Diagnostic du fond : 4 coins uniformes et opaques.
  const n = Math.max(1, Math.min(6, Math.floor(Math.min(W, H) / 20)));
  const corners = [[0, 0], [1, 0], [0, 1], [1, 1]].map(([x, y]) => cornerMean(data, W, H, x, y, n));
  const bg = [0, 1, 2].map((k) => corners.reduce((s, c) => s + c[k], 0) / 4);
  const spread = Math.max(...corners.map((c) => Math.hypot(c[0] - bg[0], c[1] - bg[1], c[2] - bg[2])));
  const opaque = corners.every((c) => c[3] >= 240);
  let removed = 0;
  if (opaque && spread < CORNER_SPREAD) removed = removeBorderBackground(data, W, H, bg);
  // Un fond « retiré » de quelques pixels n'en est pas un : rien à annoncer.
  const background = removed / (W * H) >= 0.01 ? backgroundKind(bg) : null;
  if (removed) {
    // Bord adouci : flou sur l'alpha seul, sans jamais rendre opaque un pixel retiré.
    const alpha = await sharp(data, { raw: { width: W, height: H, channels: 4 } }).extractChannel(3).blur(1.1).raw().toBuffer();
    for (let p = 0; p < W * H; p++) data[p * 4 + 3] = Math.min(data[p * 4 + 3], alpha[p]);
  }

  const box = contentBox(data, W, H);
  const contentShare = box ? (box.width * box.height) / (W * H) : 0;
  if (!box || contentShare < 0.05) return done({ verdict: 'monogram', reason: 'empty', source });
  const trimmed = box.width < W * 0.98 || box.height < H * 0.98;
  const side = Math.max(box.width, box.height);
  const radius = contentRadius(data, W, box, side);
  const changes = { background, trimmed, upscaled: factor > 1 };
  // Cadre gardé, en pixels de la source : permet de vérifier que rien n'est redessiné.
  const crop = { left: box.left / factor, top: box.top / factor, width: box.width / factor, height: box.height / factor };
  const diagnostic = { crop, corners_uniform: opaque && spread < CORNER_SPREAD, removed_share: +(removed / (W * H)).toFixed(3), content_share: +contentShare.toFixed(2), radius: +radius.toFixed(2) };

  // Carré transparent, logo centré.
  const cut = await sharp(data, { raw: { width: W, height: H, channels: 4 } }).extract(box).png().toBuffer();
  const padX = side - box.width, padY = side - box.height;
  const square = await sharp(cut).extend({
    left: Math.floor(padX / 2), right: Math.ceil(padX / 2), top: Math.floor(padY / 2), bottom: Math.ceil(padY / 2), background: TRANSPARENT,
  }).png().toBuffer();

  const thumb = await sharp(square).resize(48, 48, { fit: 'fill' }).ensureAlpha().raw().toBuffer();
  const palette = extractPalette(thumb);
  if (!background && !trimmed) return done({ verdict: 'unchanged', source, changes, diagnostic, round: radius <= ROUND, palette });

  // Zone sûre maskable (cercle de 80 %) : un badge rond tient à 0,78, un carré plein à 0,56.
  const round = radius <= ROUND;
  const safe = round ? 0.78 : Math.min(0.78, 0.8 / radius);
  const disc = round ? 0.9 : Math.min(0.9, 0.95 / radius);
  const variant = async (size, ratio, backdrop = null, round = false) => {
    const inner = Math.max(1, Math.round(size * ratio));
    const logo = await sharp(square).resize(inner, inner, { kernel: 'lanczos3' }).png().toBuffer();
    const layers = round
      ? [{ input: Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}"><circle cx="${size / 2}" cy="${size / 2}" r="${size / 2}" fill="#fff"/></svg>`) }, { input: logo, gravity: 'center' }]
      : [{ input: logo, gravity: 'center' }];
    return png(sharp({ create: { width: size, height: size, channels: 4, background: backdrop ?? TRANSPARENT } }).composite(layers));
  };
  const cleanSide = Math.min(1024, side);
  // Fonds blancs (maskable, Apple) : la couleur du club peut changer après l'inscription, une
  // icône déjà dessinée sur l'ancienne ne suivrait pas ; c'est aussi le fond de `appIcons.ts`.
  const jobs = {
    'clean-1024': () => png(sharp(square).resize(cleanSide, cleanSide, { kernel: 'lanczos3' })),
    'avatar-256': () => variant(256, 0.92),
    'maskable-512': () => variant(512, safe, WHITE),
    'maskable-192': () => variant(192, safe, WHITE),
    'any-512': () => variant(512, 0.94),
    'apple-180': () => variant(180, 0.84, WHITE),
    'email-128': () => variant(128, disc, null, true),
  };
  const buffers = await Promise.all(LOGO_VARIANTS.map((name) => jobs[name]()));
  const variants = Object.fromEntries(LOGO_VARIANTS.map((name, i) => [name, buffers[i].toString('base64')]));
  return done({ verdict: 'cleaned', source, changes, diagnostic, round, palette, variants });
}

/** Lien du logo : `cmsclub.fft.fr` en HTTPS seulement (même règle que `isTenupImageUrl`). */
export function validLogoUrl(value) {
  if (typeof value !== 'string' || value.length > 500) return false;
  try {
    const url = new URL(value);
    return url.protocol === 'https:' && url.hostname === 'cmsclub.fft.fr' && !url.port && !url.username && !url.password;
  } catch { return false; }
}

/** Télécharge le logo (sans redirection, ≤ 5 Mo) puis le traite. */
export async function pimpLogoFromUrl(url, fetcher = fetch) {
  if (!validLogoUrl(url)) throw new Error('Invalid logo URL');
  const response = await fetcher(url, { redirect: 'error', signal: AbortSignal.timeout(3_000), headers: { Accept: 'image/png,image/jpeg,image/webp' } });
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  if (Number(response.headers.get('content-length') ?? 0) > MAX_LOGO_BYTES) throw new Error('Logo too large');
  const bytes = Buffer.from(await response.arrayBuffer());
  if (!bytes.length || bytes.length > MAX_LOGO_BYTES) throw new Error('Logo too large');
  return pimpLogo(bytes);
}
