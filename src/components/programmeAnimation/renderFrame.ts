// Rendu Canvas 2D de l'animation « programme du jour », image par image : `renderFrame` dessine
// l'instant `T` dans un contexte 2D (canvas de la page ou OffscreenCanvas d'un worker). Même
// scène que le gabarit HTML de la skill `tournoi-animation-facebook`, réécrite en Canvas pour
// l'export : la rastérisation DOM (`html-to-image`) coûtait ~140 ms par image et se mettait en
// pause onglet caché. Fonction pure de `T` (aucun état, aucun `Date.now()`), sans DOM : elle
// tourne telle quelle dans le worker d'export (`exportWorker.ts`) et dans le lecteur.
//
// La mise en page reproduit celle de l'ancienne scène React, boîte par boîte : les cotes
// ci-dessous (paddings, gaps, hauteurs de ligne) sont celles de ses styles. Hauteur de ligne
// non précisée = 1,5 (héritée de la page, preflight Tailwind).
import type { AnimPalette } from './palette';
import { MANROPE, PROMPT } from './fonts';
import {
  BEAT, CARD_H, DERBY_LEAD, Easing, M, PARTNERS_BOTTOM, PARTNERS_H, TITLE_HIT, clamp, decay, derbyOn,
  type AnimCard, type AnimPlayer, type Timeline,
} from './timeline';

export type Ctx2D = CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D;
export type AnimationTexts = { title: string; kicker: string; datePrefix: string; dateLabel: string };
export type FrameAssets = {
  /** Logo pour fond clair (cartes, pastille du récap). */
  logo: ImageBitmap | null;
  /** Logo pour fond foncé (en-tête). Absent : le logo clair est posé dans un disque blanc. */
  logoOnDark: ImageBitmap | null;
  partners: ImageBitmap[];
};

const INK = '#1a1416';
const VS_FONT = '"Arial Black", Impact, sans-serif';
const RAD = Math.PI / 180;
const LH = 1.5;

/* ---------- Canvas annexes (OffscreenCanvas si dispo : worker et page) ---------- */
type AnyCanvas = OffscreenCanvas | HTMLCanvasElement;
function makeCanvas(w: number, h: number): AnyCanvas {
  if (typeof OffscreenCanvas !== 'undefined') return new OffscreenCanvas(w, h);
  return Object.assign(document.createElement('canvas'), { width: w, height: h });
}
const ctxOf = (c: AnyCanvas) => c.getContext('2d') as Ctx2D;

/* ---------- Grain : tuile de bruit générée une fois (PRNG déterministe) ---------- */
let grainTile: AnyCanvas | null = null;
function grain(): AnyCanvas {
  if (grainTile) return grainTile;
  const c = makeCanvas(256, 256), g = ctxOf(c), img = g.createImageData(256, 256);
  let x = 1234567;
  for (let i = 0; i < img.data.length; i += 4) {
    x ^= x << 13; x ^= x >>> 17; x ^= x << 5;
    const v = (x >>> 0) % 256;
    img.data[i] = img.data[i + 1] = img.data[i + 2] = v;
    img.data[i + 3] = 255;
  }
  g.putImageData(img, 0, 0);
  return (grainTile = c);
}

/* ---------- Opacité de groupe ----------
   En CSS, `opacity` s'applique au groupe déjà composé (fond + texte + ombre) : on le dessine
   dans un calque de la taille du canvas, posé ensuite avec l'alpha. Pile de calques réutilisés. */
const layers: AnyCanvas[] = [];
let depth = 0;
function withAlpha(g: Ctx2D, alpha: number, draw: (g: Ctx2D) => void) {
  if (alpha <= 0.001) return;
  if (alpha >= 0.999) return draw(g);
  const { width, height } = g.canvas;
  let c = layers[depth];
  if (!c || c.width !== width || c.height !== height) c = layers[depth] = makeCanvas(width, height);
  const l = ctxOf(c);
  l.setTransform(1, 0, 0, 1, 0, 0);
  l.clearRect(0, 0, width, height);
  l.setTransform(g.getTransform());
  l.imageSmoothingQuality = 'high';
  depth++;
  try {
    draw(l);
  } finally {
    depth--;
  }
  g.save();
  g.setTransform(1, 0, 0, 1, 0, 0);
  g.globalAlpha = alpha;
  g.drawImage(c, 0, 0);
  g.restore();
}

/** Transformation CSS autour d'une origine : `translate(o) · f · translate(-o)`. */
function around(g: Ctx2D, ox: number, oy: number, f: () => void) {
  g.translate(ox, oy);
  f();
  g.translate(-ox, -oy);
}

/** Les ombres du canvas ignorent la transformation courante : on les met à l'échelle. */
function shadow(g: Ctx2D, color: string, blur: number, ox: number, oy: number) {
  const m = g.getTransform(), s = Math.sqrt(Math.abs(m.a * m.d - m.b * m.c));
  g.shadowColor = color;
  g.shadowBlur = blur * s;
  g.shadowOffsetX = ox * s;
  g.shadowOffsetY = oy * s;
}

function rr(g: Ctx2D, x: number, y: number, w: number, h: number, r: number) {
  r = Math.max(0, Math.min(r, w / 2, h / 2));
  g.moveTo(x + r, y);
  g.arcTo(x + w, y, x + w, y + h, r);
  g.arcTo(x + w, y + h, x, y + h, r);
  g.arcTo(x, y + h, x, y, r);
  g.arcTo(x, y, x + w, y, r);
  g.closePath();
}
function fillRR(g: Ctx2D, x: number, y: number, w: number, h: number, r: number, color: string | CanvasGradient) {
  g.beginPath();
  rr(g, x, y, w, h, r);
  g.fillStyle = color;
  g.fill();
}
function clipRR(g: Ctx2D, x: number, y: number, w: number, h: number, r: number) {
  g.beginPath();
  rr(g, x, y, w, h, r);
  g.clip();
}
function clipRect(g: Ctx2D, x: number, y: number, w: number, h: number) {
  g.beginPath();
  g.rect(x, y, w, h);
  g.clip();
}

function drawContain(g: Ctx2D, img: ImageBitmap, x: number, y: number, w: number, h: number) {
  const s = Math.min(w / img.width, h / img.height), dw = img.width * s, dh = img.height * s;
  g.drawImage(img, x + (w - dw) / 2, y + (h - dh) / 2, dw, dh);
}

/* ---------- Texte ---------- */
const font = (weight: number, size: number, family: string, italic = false) => `${italic ? 'italic ' : ''}${weight} ${size}px ${family}`;

// Ascendante / descendante de la police, arrondies comme le fait la mise en page de Chrome :
// elles placent la ligne de base dans la boîte de ligne (demi-interlignage).
const metricsCache = new Map<string, { a: number; d: number }>();
function metrics(g: Ctx2D, f: string) {
  let m = metricsCache.get(f);
  if (!m) {
    g.font = f;
    const t = g.measureText('Hg');
    const size = parseFloat(f.replace(/^italic /, '').split(' ')[1]);
    m = t.fontBoundingBoxAscent !== undefined
      ? { a: Math.round(t.fontBoundingBoxAscent), d: Math.round(t.fontBoundingBoxDescent) }
      : { a: Math.round(size * 0.95), d: Math.round(size * 0.25) };
    metricsCache.set(f, m);
  }
  return m;
}
/** Ligne de base d'une ligne de texte de hauteur `lh` posée en `top`. */
function baseline(g: Ctx2D, f: string, top: number, lh: number) {
  const { a, d } = metrics(g, f);
  return top + (lh - (a + d)) / 2 + a;
}

// `letterSpacing` du canvas (Chrome 99, Firefox 115, Safari 18.4) ; sinon lettre par lettre.
// Comme en CSS, l'espacement suit chaque caractère, y compris le dernier.
const nativeLS = (g: Ctx2D) => 'letterSpacing' in g;
let lsTrailing: boolean | null = null;
function measure(g: Ctx2D, text: string, ls = 0): number {
  if (!ls) return g.measureText(text).width;
  const n = Array.from(text).length;
  if (nativeLS(g)) {
    if (lsTrailing === null) { // la largeur mesurée compte-t-elle l'espacement après le dernier caractère ?
      const w0 = g.measureText('ab').width;
      g.letterSpacing = '10px';
      lsTrailing = Math.abs(g.measureText('ab').width - w0 - 20) < 1;
    }
    g.letterSpacing = `${ls}px`;
    const w = g.measureText(text).width;
    g.letterSpacing = '0px';
    return lsTrailing ? w : w + ls;
  }
  let w = 0;
  for (const ch of text) w += g.measureText(ch).width;
  return w + n * ls;
}
function fillRun(g: Ctx2D, text: string, x: number, y: number, ls = 0, stroke = false) {
  if (!ls) return stroke ? g.strokeText(text, x, y) : g.fillText(text, x, y);
  if (nativeLS(g)) {
    g.letterSpacing = `${ls}px`;
    if (stroke) g.strokeText(text, x, y);
    else g.fillText(text, x, y);
    g.letterSpacing = '0px';
    return;
  }
  for (const ch of text) {
    if (stroke) g.strokeText(ch, x, y);
    else g.fillText(ch, x, y);
    x += g.measureText(ch).width + ls;
  }
}
/** `text-overflow: ellipsis` : plus long préfixe qui tient avec « … ». */
function ellipsize(g: Ctx2D, text: string, maxW: number, ls = 0): string {
  if (measure(g, text, ls) <= maxW + 0.01) return text;
  const chars = Array.from(text), ell = measure(g, '…', ls);
  let lo = 0, hi = chars.length;
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1;
    if (measure(g, chars.slice(0, mid).join(''), ls) + ell <= maxW) lo = mid;
    else hi = mid - 1;
  }
  return chars.slice(0, lo).join('') + '…';
}

type TextOpts = {
  text: string; f: string; lh: number; color: string; x: number; w: number; top: number;
  align?: 'left' | 'center' | 'right'; ls?: number; ell?: boolean;
};
/** Une ligne de texte dans une boîte (x, top, w, lh). Trop longue : alignée au début, comme en CSS. */
function textLine(g: Ctx2D, o: TextOpts) {
  g.font = o.f;
  const ls = o.ls ?? 0, full = measure(g, o.text, ls), over = full > o.w + 0.01;
  const text = over && o.ell ? ellipsize(g, o.text, o.w, ls) : o.text;
  const tw = text === o.text ? full : measure(g, text, ls);
  const align = over ? 'left' : o.align ?? 'left';
  const x = align === 'left' ? o.x : align === 'center' ? o.x + (o.w - tw) / 2 : o.x + o.w - tw;
  g.fillStyle = o.color;
  fillRun(g, text, x, baseline(g, o.f, o.top, o.lh), ls);
}

/* ---------- Court de tennis en perspective (mètres → écran) ---------- */
function court(story: boolean) {
  const F = 1389, D = 5.54, HZ = story ? 680 : 250, CAMH = 3.59;
  const P = (X: number, Z: number): [number, number] => [540 + (X * F) / (Z + D), HZ + (CAMH * F) / (Z + D)];
  const L = 23.77, dW = 5.485, sW = 4.115, sv = 6.4, mid = L / 2;
  const seg = (a: [number, number], b: [number, number], net = false) => ({ a: P(...a), b: P(...b), net });
  return [
    seg([-dW, 0], [dW, 0]), seg([-dW, L], [dW, L]),
    seg([-dW, 0], [-dW, L]), seg([dW, 0], [dW, L]),
    seg([-sW, 0], [-sW, L]), seg([sW, 0], [sW, L]),
    seg([-sW, mid - sv], [sW, mid - sv]), seg([-sW, mid + sv], [sW, mid + sv]),
    seg([0, mid - sv], [0, mid + sv]),
    seg([0, 0], [0, 0.3]), seg([0, L], [0, L - 0.3]),
    seg([-dW - 0.9, mid], [dW + 0.9, mid], true),
  ];
}
const COURTS = { story: court(true), carre: court(false) };

/** Dégradé radial elliptique (centre, rayons) remplissant le rectangle donné. */
function ellipseGradient(g: Ctx2D, cx: number, cy: number, rx: number, ry: number, stops: [number, string][], rect: [number, number, number, number]) {
  g.save();
  g.translate(cx, cy);
  g.scale(1, ry / rx);
  const gr = g.createRadialGradient(0, 0, 0, 0, 0, rx);
  for (const [o, c] of stops) gr.addColorStop(o, c);
  g.fillStyle = gr;
  const k = rx / ry;
  g.fillRect(rect[0] - cx, (rect[1] - cy) * k, rect[2], rect[3] * k);
  g.restore();
}

type Ctx = { tl: Timeline; T: number; pal: AnimPalette; texts: AnimationTexts; assets: FrameAssets };

function background(g: Ctx2D, { tl, T, pal }: Ctx) {
  const { W, H, cues, total } = tl;
  const prog = T / total;
  const beatT = T >= cues.Date ? cues.Date + Math.floor((T - cues.Date) / BEAT) * BEAT : -9;
  const pulse = decay(T, beatT, 7) * (T >= cues.Date ? 1 : 0);
  const hit = tl.impacts.reduce((a, i) => Math.max(a, decay(T, i.t, 6)), 0);
  const dOn = derbyOn(tl, T);
  const frame = Math.floor(T * 30);
  const gx = (frame * 73) % 256, gy = (frame * 151) % 256;

  g.fillStyle = pal.dark;
  g.fillRect(0, 0, W, H);
  // boîte débordant de 60 px, zoomée lentement (origine 50 % 60 %)
  const bx = -60, by = -60, bw = W + 120, bh = H + 120;
  g.save();
  around(g, bx + bw / 2, by + bh * 0.6, () => {
    g.scale(1.04 + 0.06 * prog, 1.04 + 0.06 * prog);
    g.translate(0, -24 * prog);
  });
  const box: [number, number, number, number] = [bx, by, bw, bh];
  ellipseGradient(g, bx + bw / 2, by + bh * 0.42, bw * 0.75, bh * 0.65, [[0, pal.glow], [0.42, pal.red], [1, pal.dark]], box);
  if (dOn > 0) {
    g.globalAlpha = 0.45 * dOn;
    g.fillStyle = pal.derbyShade;
    g.fillRect(...box);
    g.globalAlpha = 1;
  }
  const a = 0.16 * pulse + 0.35 * hit;
  if (a > 0.001) {
    const R = Math.hypot(bw / 2, bh / 2); // cercle « farthest-corner »
    ellipseGradient(g, bx + bw / 2, by + bh / 2, R, R, [[0, pal.lightA(a)], [0.55, pal.lightA(0)]], box);
  }
  g.strokeStyle = '#fff';
  g.lineCap = 'round';
  COURTS[tl.format].forEach((l, i) => {
    const p = M.draw(T, 0.1 + i * 0.05, 0.7);
    if (p <= 0) return;
    g.globalAlpha = l.net ? 0.22 : 0.15 + 0.06 * pulse;
    g.lineWidth = l.net ? 5 : 3;
    g.beginPath();
    g.moveTo(l.a[0], l.a[1]);
    g.lineTo(l.a[0] + (l.b[0] - l.a[0]) * p, l.a[1] + (l.b[1] - l.a[1]) * p);
    g.stroke();
  });
  g.restore();

  ellipseGradient(g, W / 2, H / 2, W * 0.8, H * 0.8, [[0.55, pal.shadeA(0, 8)], [1, pal.shadeA(0.55, 8)]], [0, 0, W, H]);

  g.save();
  g.globalAlpha = 0.07;
  g.globalCompositeOperation = 'overlay';
  g.fillStyle = g.createPattern(grain(), 'repeat')!;
  g.translate(gx, gy);
  g.fillRect(-gx, -gy, W, H);
  g.restore();
}

/* ---------- VS (même dessin que l'affiche) ---------- */
// L'italique déborde à droite de sa boîte : décalée de -0,08 em pour la recentrer visuellement.
function vsBox(g: Ctx2D, size: number) {
  const fs = size * 0.8, f = font(900, fs, VS_FONT, true);
  g.font = f;
  return { f, fs, w: measure(g, 'VS'), h: fs };
}
function drawVS(g: Ctx2D, f: string, fs: number, x: number, top: number, color: string) {
  g.font = f;
  g.fillStyle = color;
  g.fillText('VS', x - 0.08 * fs, baseline(g, f, top, fs));
}

// Bande de reflet qui traverse un élément (p de 0 à 1) ; boîte (x, top-20) → (x+w, top+h+20)
function shine(g: Ctx2D, p: number, x: number, top: number, h: number, w = 90, span = 640) {
  if (p <= 0 || p >= 1) return;
  g.save();
  around(g, x + w / 2, top + h / 2, () => {
    g.translate(-w - 40 + p * (span + w + 80), 0);
    g.transform(1, 0, Math.tan(-20 * RAD), 1, 0, 0);
  });
  const gr = g.createLinearGradient(x, 0, x + w, 0);
  gr.addColorStop(0, 'rgba(255,255,255,0)');
  gr.addColorStop(0.5, 'rgba(255,255,255,0.55)');
  gr.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = gr;
  g.fillRect(x, top - 20, w, h + 40);
  g.restore();
}

/* ---------- Cartes ---------- */
// Lignes d'un joueur : prénom, nom, classement, club (colonne centrée, padding 6). Club vide
// (« À DÉTERMINER ») : bloc vide, donc de hauteur nulle — seule sa marge de 2 px reste.
const PL = [26 * 1.1, 31 * 1.15, 24 * 1.3, 2 + 14 * LH];
function playerLines(g: Ctx2D, p: AnimPlayer, r: number, onRed: boolean, pal: AnimPalette, x: number, y: number, w: number, h: number) {
  const cx = x + 6, cw = w - 12;
  let top = y + 6 + (h - 12 - PL.reduce((a, b) => a + b, 0) + (p.club ? 0 : 14 * LH)) / 2;
  const ink = onRed ? '#fff' : INK;
  textLine(g, { text: p.first || ' ', f: font(600, 26, PROMPT), lh: PL[0], color: ink, x: cx, w: cw, top, align: 'center', ell: true });
  top += PL[0];
  textLine(g, { text: p.last, f: font(700, 31, PROMPT), lh: PL[1], color: ink, x: cx, w: cw, top, align: 'center', ell: true });
  top += PL[1];
  g.save();
  g.globalAlpha = r;
  textLine(g, { text: p.rank || ' ', f: font(700, 24, PROMPT), lh: PL[2], color: onRed ? '#fff' : pal.red, x: cx, w: cw, top: top + (1 - r) * 10, align: 'center' });
  top += PL[2] + 2;
  textLine(g, { text: p.club.toUpperCase(), f: font(p.home ? 800 : 600, 14, MANROPE), lh: 14 * LH, color: onRed ? '#fff' : p.home ? pal.red : '#5b5355',
    x: cx, w: cw, top, align: 'center', ls: 0.28, ell: true });
  g.restore();
}

function player(g: Ctx2D, p: AnimPlayer, T: number, s: number, side: 'L' | 'R', flipAt: number, pal: AnimPalette, x: number, y: number, w: number, h: number) {
  const k = M.enter(T, s, 0.45), r = M.enter(T, s + 0.55, 0.35);
  // joueur du club : le bloc se remplit de la couleur du club (de bas en haut) puis un reflet le traverse
  const f = p.home ? M.draw(T, flipAt, 0.35) : 0;
  const sh = p.home ? clamp((T - flipAt - 0.3) / 0.45, 0, 1) : 0;
  const sc = 1 + 0.05 * decay(T, flipAt + 0.3, 8) * (p.home ? 1 : 0);
  g.save();
  around(g, x + w / 2, y + h / 2, () => {
    g.translate((1 - k) * (side === 'L' ? -160 : 160), 0);
    g.scale(sc, sc);
  });
  withAlpha(g, k, (g) => {
    if (p.home) fillRR(g, x, y, w, h, 16, pal.redA(0.08));
    playerLines(g, p, r, false, pal, x, y, w, h);
    if (!p.home || f <= 0) return;
    g.save();
    clipRR(g, x, y, w, h, 16);
    clipRR(g, x, y + (1 - f) * h, w, f * h, 16);
    g.fillStyle = pal.red;
    g.fillRect(x, y, w, h);
    // ombre intérieure `inset 0 -6px 0` : bande de 6 px en bas
    g.beginPath();
    rr(g, x, y, w, h, 16);
    rr(g, x, y - 6, w, h, 16);
    g.fillStyle = 'rgba(0,0,0,0.12)';
    g.fill('evenodd');
    playerLines(g, p, r, true, pal, x, y, w, h);
    shine(g, sh, x, y, h, 90, 340);
    g.restore();
  });
  g.restore();
}

const HEAD_H = 52; // padding 12 + pastille horaire (36 + 2 × 2)
function card(g: Ctx2D, c: AnimCard, { tl, T, pal, assets }: Ctx) {
  const { m, time, s, e, top, impact } = c;
  if (T < s - 0.05 || T > e + 0.5) return;
  const k = M.enter(T, s, 0.5), x = M.draw(T, e, 0.4);
  const fall = clamp((T - (impact - 0.18)) / 0.18, 0, 1);
  const vsScale = T < impact ? 3 - 2 * Easing.easeInQuad(fall) : 1 + 0.18 * Math.exp(-(T - impact) * 9) * Math.cos((T - impact) * 38);
  const vsOp = T < impact - 0.18 ? 0 : clamp(fall * 1.6, 0, 1);
  const shake = T > impact && T < impact + 0.3 ? Math.sin((T - impact) * 90) * (m.derby ? 11 : 7) * (1 - (T - impact) / 0.3) : 0;
  const flash = decay(T, impact, 16);
  const line = M.enter(T, impact, 0.3);
  const pill = M.pop(T, s + 0.1, 0.35);
  const flipAt = impact + 0.25;
  const bn = M.draw(T, flipAt + 0.15, 0.4);
  const bnShine = clamp((T - flipAt - 0.6) / 0.5, 0, 1);
  const hasHome = m.a.home || m.b.home;
  const logo = assets.logo;
  // tampon du club : chute en tournant dans le coin de la carte
  const st = M.enter(T, flipAt + 0.05, 0.22);
  const stamp = T < flipAt + 0.05 ? 0 : 1;

  const L = 50, CW = tl.W - 100;
  g.save();
  around(g, L + CW / 2, top + CARD_H / 2, () => {
    g.translate(-x * 320 + shake * 0.4, (1 - k) * 160);
    g.scale(0.94 + 0.06 * k, 0.94 + 0.06 * k);
  });
  withAlpha(g, k * (1 - x), (g) => {
    if (m.banner) fillRR(g, L - 10, top - 10, CW + 20, CARD_H + 20, 36, 'rgba(255,255,255,0.12)');
    g.save();
    shadow(g, pal.shadeA(0.38), 50, 0, 22);
    fillRR(g, L, top, CW, CARD_H, 26, '#fff');
    g.restore();

    g.save();
    clipRR(g, L, top, CW, CARD_H, 26);
    // En-tête : pastille horaire, catégorie, tampon du club
    const pf = font(700, 24, PROMPT);
    g.font = pf;
    const pw = measure(g, time) + 40, px = L + 28, py = top + 12;
    g.save();
    around(g, px + pw / 2, py + 20, () => g.scale(pill, pill));
    fillRR(g, px, py, pw, 40, 20, pal.red);
    textLine(g, { text: time, f: pf, lh: 36, color: '#fff', x: px + 20, w: pw - 40, top: py + 2 });
    g.restore();
    const cf = font(600, 24, PROMPT), padR = hasHome && logo ? 56 : 0, cx = px + pw + 18;
    g.font = cf;
    const cw = Math.min(measure(g, m.cat) + padR, L + CW - 28 - cx);
    g.save();
    g.globalAlpha = M.enter(T, s + 0.2, 0.35);
    textLine(g, { text: m.cat, f: cf, lh: 36, color: pal.red, x: cx, w: cw - padR, top: py + 2, ell: true });
    g.restore();
    if (hasHome && logo && stamp) {
      const lx = L + CW - 24 - 44, ly = top + 8;
      g.save();
      g.globalAlpha = clamp(st * 3, 0, 1);
      around(g, lx + 22, ly + 22, () => {
        g.rotate((1 - st) * -140 * RAD);
        g.scale(2.4 - 1.4 * st, 2.4 - 1.4 * st);
      });
      drawContain(g, logo, lx, ly, 44, 44);
      g.restore();
    }

    // Joueurs et VS
    const bannerH = m.banner ? (m.derby ? 18 : 16) * LH + 14 : 0;
    const iy = top + HEAD_H + 6, ih = CARD_H - HEAD_H - bannerH - 14;
    const pw2 = (CW - 48 - 112 - 12) / 2, ax = L + 24, mx = ax + pw2 + 6, bx = mx + 112 + 6;
    player(g, m.a, T, s + 0.08, 'L', flipAt, pal, ax, iy, pw2, ih);
    const vs = vsBox(g, 84), ll = (ih - vs.h - 16) / 2;
    g.fillStyle = pal.redA(0.25);
    if (line > 0) {
      g.fillRect(mx + 55, iy + ll * (1 - line), 2, ll * line);
      g.fillRect(mx + 55, iy + ll + 16 + vs.h, 2, ll * line);
    }
    if (vsOp > 0) {
      const vx = mx + (112 - vs.w) / 2, vy = iy + ll + 8;
      g.save();
      g.globalAlpha = vsOp;
      around(g, vx - 0.08 * vs.fs + vs.w / 2, vy + vs.h / 2, () => {
        g.translate(shake, 0);
        g.scale(vsScale, vsScale);
        g.rotate((1 - fall) * -12 * RAD);
      });
      drawVS(g, vs.f, vs.fs, vx, vy, pal.red);
      g.restore();
    }
    player(g, m.b, T, s + 0.08, 'R', flipAt + (m.derby ? 0.12 : 0), pal, bx, iy, pw2, ih);

    // Bandeau « joueur du club » / derby, déployé depuis le centre
    if (m.banner && bn > 0) {
      const by = top + CARD_H - bannerH;
      g.save();
      clipRect(g, L + (1 - bn) * CW / 2, by, bn * CW, bannerH);
      g.fillStyle = pal.dark;
      g.fillRect(L, by, CW, bannerH);
      const bf = font(m.derby ? 700 : 600, m.derby ? 18 : 16, PROMPT);
      textLine(g, { text: m.banner, f: bf, lh: bannerH - 14, color: '#fff', x: L, w: CW, top: by + 7, align: 'center', ls: (m.derby ? 18 : 16) * 0.3, ell: true });
      shine(g, bnShine, L, by, bannerH, 110, 980);
      g.restore();
    }
    if (flash > 0.01) {
      g.globalAlpha = 0.85 * flash;
      g.fillStyle = '#fff';
      g.fillRect(L, top, CW, CARD_H);
      g.globalAlpha = 1;
    }
    g.restore();

    if (m.banner) {
      g.beginPath();
      rr(g, L - 8, top - 8, CW + 16, CARD_H + 16, 34);
      g.strokeStyle = '#fff';
      g.lineWidth = 4;
      g.stroke();
    }
  });
  g.restore();
}

// Mot DERBY plein écran en ouverture d'un écran derby, puis en filigrane derrière la carte
function derbyTitle(g: Ctx2D, { tl, T, pal }: Ctx) {
  tl.slots.forEach((sl, i) => {
    if (!sl.derby) return;
    const c = tl.cues[sl.cue], end = tl.slots[i + 1] ? tl.cues[tl.slots[i + 1].cue] : tl.cues.Recap;
    if (T < c - 0.05 || T > end) return;
    const slam = clamp((T - c - 0.05) / 0.22, 0, 1);
    const sc = T < c + 0.27 ? 2.6 - 1.6 * Easing.easeInQuad(slam) : 1 + 0.06 * Math.exp(-(T - c - 0.27) * 9) * Math.cos((T - c - 0.27) * 36);
    const back = M.draw(T, c + DERBY_LEAD - 0.35, 0.45); // recule en filigrane quand la carte arrive
    const out = M.draw(T, end - 0.45, 0.35);
    const sub = M.enter(T, c + 0.6, 0.35);
    const y = tl.story ? 1040 - 230 * back : 560 - 90 * back;
    withAlpha(g, clamp(slam * 2, 0, 1) * (1 - out), (g) => {
      // colonne centrée dans une boîte de 340 px : DERBY (250 × 0,9) + 8 + sous-titre (22 × 1,5)
      const top = y - 170 + (340 - (225 + 8 + 33)) / 2;
      const f = font(800, 250, PROMPT, true), ls = -5;
      g.font = f;
      const w = measure(g, 'DERBY', ls), x = (tl.W - w) / 2, bl = baseline(g, f, top, 225);
      g.save();
      around(g, x + w / 2, top + 112.5, () => g.scale(sc * (1 - 0.25 * back), sc * (1 - 0.25 * back)));
      g.lineWidth = 3 * back;
      g.lineJoin = 'round';
      if (back < 0.5) { // text-shadow 0 12px 0 : opaque quelle que soit l'opacité du texte
        g.fillStyle = g.strokeStyle = pal.shadeA(0.35, 12);
        fillRun(g, 'DERBY', x, bl + 12, ls);
        if (back > 0) fillRun(g, 'DERBY', x, bl + 12, ls, true);
      }
      g.fillStyle = `rgba(255,255,255,${1 - 0.88 * back})`;
      fillRun(g, 'DERBY', x, bl, ls);
      if (back > 0) {
        g.strokeStyle = 'rgba(255,255,255,0.35)';
        fillRun(g, 'DERBY', x, bl, ls, true);
      }
      g.restore();
      const a = sub * (1 - back);
      if (a > 0) {
        const sf = font(600, 22, PROMPT), text = `100 % ${tl.club.toUpperCase()}`;
        g.font = sf;
        const sw = Math.min(measure(g, text, 7.7), 1000);
        g.save();
        g.globalAlpha = a;
        textLine(g, { text, f: sf, lh: 33, color: '#fff', x: (tl.W - sw) / 2, w: sw, top: top + 233 + (1 - sub) * 16, ls: 7.7, ell: true });
        g.restore();
      }
    });
  });
}

const SHARDS = Array.from({ length: 16 }, (_, i) => {
  const a = (i / 16) * Math.PI * 2 + ((i * 37) % 10) / 20;
  return { a, v: 520 + ((i * 53) % 7) * 70, s: 6 + (i % 4) * 3, red: i % 3 === 0, spin: ((i * 29) % 11) - 5 };
});
function impactFX(g: Ctx2D, { tl, T, pal }: Ctx) {
  for (const im of tl.impacts) {
    const dt = T - im.t;
    if (dt < 0 || dt > 0.7) continue;
    const r = Easing.easeOutCubic(clamp(dt / 0.55, 0, 1)), R = im.big ? 1.4 : 1;
    const r2 = clamp(dt / 0.4, 0, 1);
    g.save();
    g.beginPath();
    g.arc(im.x, im.y, (40 + 480 * r) * R, 0, Math.PI * 2);
    g.globalAlpha = 0.75 * (1 - r);
    g.strokeStyle = '#fff';
    g.lineWidth = 22 * (1 - r) + 1;
    g.stroke();
    g.beginPath();
    g.arc(im.x, im.y, (20 + 300 * Easing.easeOutCubic(r2)) * R, 0, Math.PI * 2);
    g.globalAlpha = 0.6 * (1 - r2);
    g.strokeStyle = pal.red;
    g.lineWidth = 8;
    g.stroke();
    g.globalAlpha = clamp(1 - dt / 0.65, 0, 1);
    for (const sh of SHARDS) {
      const d = sh.v * R * dt * (1 - dt * 0.6);
      const x = im.x + Math.cos(sh.a) * d, y = im.y + Math.sin(sh.a) * d + 420 * dt * dt;
      g.save();
      g.translate(x, y);
      g.rotate(sh.spin * dt * 120 * RAD);
      g.fillStyle = sh.red ? pal.red : '#fff';
      g.fillRect(-sh.s / 2, -sh.s / 2, sh.s, sh.s * 0.55);
      g.restore();
    }
    g.restore();
  }
}

function wipes(g: Ctx2D, { tl, T, pal }: Ctx) {
  const cues = [...tl.slots.slice(1).map((sl) => tl.cues[sl.cue]), tl.cues.Recap];
  const ww = tl.story ? 1200 : 900, top = -200, h = tl.H + 400;
  for (const cue of cues) {
    const p = clamp((T - (cue - 0.42)) / 0.5, 0, 1);
    if (p <= 0 || p >= 1) continue;
    const x = tl.story ? -2100 + Easing.easeInOutCubic(p) * 4200 : -1500 + Easing.easeInOutCubic(p) * 3000;
    g.save();
    around(g, ww / 2, top + h / 2, () => {
      g.translate(x, 0);
      g.transform(1, 0, Math.tan(-18 * RAD), 1, 0, 0);
    });
    g.fillStyle = pal.dark;
    g.fillRect(0, top, ww, h);
    g.fillStyle = '#fff';
    g.globalAlpha = 0.9;
    g.fillRect(-40, top, 40, h);
    g.globalAlpha = 0.5;
    g.fillRect(ww, top, 14, h);
    g.restore();
  }
}

function header(g: Ctx2D, { tl, T, pal, texts, assets }: Ctx) {
  const { OY, cues, W } = tl;
  const lg = M.pop(T, 0.0, 0.45), rule = M.draw(T, 0.25, 0.35);
  const ti = M.pop(T, TITLE_HIT - 0.12, 0.4);
  const d = M.enter(T, cues.Date, 0.4), hl = M.draw(T, cues.Date + 0.25, 0.35);
  const by = T < 0.3 ? -Math.abs(Math.sin((T / 0.3) * Math.PI)) * 40 * (1 - T / 0.3) : -Math.abs(Math.sin(((T - 0.3) / 0.25) * Math.PI)) * 14 * clamp(1 - (T - 0.3) / 0.25, 0, 1);

  // Logo pour fond foncé posé tel quel ; sinon logo clair dans un disque blanc ; sinon initiales.
  if (lg > 0) {
    const lx = 498, ly = 18 + OY;
    g.save();
    around(g, lx + 42, ly + 42, () => {
      g.translate(0, by);
      g.rotate((1 - lg) * -300 * RAD);
      g.scale(lg, lg);
    });
    withAlpha(g, clamp(lg * 1.5, 0, 1), (g) => {
      if (assets.logoOnDark) return drawContain(g, assets.logoOnDark, lx, ly, 84, 84);
      g.beginPath();
      g.arc(lx + 42, ly + 42, 42, 0, Math.PI * 2);
      g.fillStyle = '#fff';
      g.fill();
      if (assets.logo) return drawContain(g, assets.logo, lx + 11, ly + 11, 62, 62);
      const initials = texts.kicker.split(/\s+/).filter(Boolean).slice(0, 2).map((w) => w[0]).join('');
      textLine(g, { text: initials, f: font(800, 22, PROMPT), lh: 33, color: pal.red, x: lx, w: 84, top: ly + 42 - 16.5, align: 'center' });
    });
    g.restore();
  }

  // Surtitre lettre par lettre, entre deux filets
  const kf = font(600, 20, PROMPT), ky = 106 + OY;
  g.font = kf;
  const chars = Array.from(texts.kicker), cws = chars.map((ch) => g.measureText(ch).width + 6);
  const kw = cws.reduce((a, b) => a + b, 0), rw = 70 * rule;
  let kx = (W - (rw * 2 + 44 + kw)) / 2;
  g.fillStyle = '#fff';
  g.fillRect(kx, ky + 14, rw, 2);
  g.fillRect(kx + rw + 44 + kw, ky + 14, rw, 2);
  kx += rw + 22;
  const kb = baseline(g, kf, ky, 30);
  g.save();
  chars.forEach((ch, i) => {
    const a = M.enter(T, 0.22 + i * 0.012, 0.22);
    if (a > 0) {
      g.globalAlpha = a;
      g.fillText(ch, kx, kb + (1 - a) * 14);
    }
    kx += cws[i];
  });
  g.restore();

  // Titre (boîte de 100 px qui le masque tant qu'il monte)
  if (texts.title) {
    const tf = font(800, 86, PROMPT), tlh = 86 * 1.12, top = 134 + OY;
    const ts = 1 + 0.06 * decay(T, TITLE_HIT, 10);
    g.save();
    clipRect(g, 30, top, W - 60, 100);
    around(g, W / 2, top + tlh / 2, () => {
      g.translate(0, (1 - ti) * 100);
      g.scale(ts, ts);
    });
    shadow(g, pal.shadeA(0.35, 12), 24, 0, 6);
    textLine(g, { text: texts.title, f: tf, lh: tlh, color: '#fff', x: 30, w: W - 60, top, align: 'center', ls: -2.58, ell: true });
    g.restore();
  }

  // « Programme du » + date soulignée
  if (d > 0) {
    const pf = font(600, 36, PROMPT), df = font(700, 36, PROMPT), top = 232 + OY;
    g.font = pf;
    const w1 = measure(g, texts.datePrefix);
    g.font = df;
    const w2 = measure(g, texts.dateLabel);
    const x = (W - w1 - w2) / 2 + (1 - d) * -140, bl = baseline(g, df, top, 54);
    g.save();
    g.globalAlpha = d;
    g.fillStyle = '#fff';
    g.font = pf;
    g.fillText(texts.datePrefix, x, bl);
    g.font = df;
    g.fillText(texts.dateLabel, x + w1, bl);
    if (hl > 0) fillRR(g, x + w1, bl + metrics(g, df).d, hl * w2, 4, 2, '#fff');
    g.restore();
  }
}

// Un onglet par horaire (un écran d'horaires rapprochés en allume plusieurs), actif tant que l'un de ses écrans est à l'affiche (la somme des deux
// fondus reste à 1 entre deux écrans du même horaire : l'onglet ne clignote pas).
function tabs(g: Ctx2D, { tl, T, pal }: Ctx) {
  const k = M.enter(T, tl.cues.Date + 0.3, 0.35);
  const hide = M.draw(T, tl.cues.Recap - 0.3, 0.3);
  const times = [...new Set(tl.slots.flatMap((sl) => sl.times))];
  const f = font(700, 22, PROMPT), top = 319 + tl.OY + (1 - k) * 16, h = 45;
  g.font = f;
  const ws = times.map((t) => measure(g, t) + 48);
  withAlpha(g, k * (1 - hide), (g) => {
    let x = (tl.W - ws.reduce((a, b) => a + b, 0) - 14 * (times.length - 1)) / 2;
    times.forEach((time, ti) => {
      let on = 0;
      tl.slots.forEach((sl, i) => {
        if (!sl.times.includes(time)) return;
        on += M.draw(T, tl.cues[sl.cue] - 0.15, 0.25) * (1 - (tl.slots[i + 1] ? M.draw(T, tl.cues[tl.slots[i + 1].cue] - 0.15, 0.25) : 0));
      });
      on = clamp(on, 0, 1);
      const w = ws[ti];
      g.save();
      around(g, x + w / 2, top + h / 2, () => g.scale(1 + 0.08 * on, 1 + 0.08 * on));
      if (on > 0) fillRR(g, x, top, w, h, h / 2, `rgba(255,255,255,${on})`);
      g.beginPath();
      rr(g, x, top, w, h, h / 2);
      rr(g, x + 2, top + 2, w - 4, h - 4, h / 2 - 2);
      g.fillStyle = '#fff';
      g.fill('evenodd');
      textLine(g, { text: time, f, lh: 33, color: on > 0.5 ? pal.red : '#fff', x: x + 24, w: w - 48, top: top + 6 });
      g.restore();
      x += w + 14;
    });
  });
}

// Logos des partenaires déjà tirés (`drawPosterPartners`) : une rangée jusqu'à 5, deux au-delà.
function partnerLogos(g: Ctx2D, logos: ImageBitmap[], x: number, y: number, w: number, h: number, reveal: number) {
  if (reveal <= 0) return;
  const half = Math.ceil(logos.length / 2);
  const rows = logos.length > 5 ? [logos.slice(0, half), logos.slice(half)] : [logos];
  const rowH = (h - 10 * (rows.length - 1)) / rows.length;
  g.save();
  clipRect(g, x, y, w * reveal, h);
  rows.forEach((row, r) => {
    const n = row.length, full = n * 160 + (n - 1) * 24;
    const iw = full > w ? 160 - (full - w) / n : 160;
    let ix = x + (w - (n * iw + (n - 1) * 24)) / 2;
    for (const img of row) {
      drawContain(g, img, ix, y + r * (rowH + 10), iw, rowH);
      ix += iw + 24;
    }
  });
  g.restore();
}

function partners(g: Ctx2D, { tl, T, assets, pal }: Ctx) {
  if (assets.partners.length === 0) return;
  const k = M.enter(T, tl.cues.Date + 0.4, 0.45), w = M.draw(T, tl.cues.Date + 0.55, 0.6);
  if (k <= 0) return;
  if (tl.story) { // story : petit panneau blanc flottant, sans titre, au-dessus de la zone « Envoyer un message »
    const top = tl.H - PARTNERS_BOTTOM - PARTNERS_H + (1 - k) * 120;
    withAlpha(g, clamp(k * 1.5, 0, 1), (g) => {
      g.save();
      shadow(g, pal.shadeA(0.3), 36, 0, 16);
      fillRR(g, 50, top, tl.W - 100, PARTNERS_H, 22, '#fff');
      g.restore();
      partnerLogos(g, assets.partners, 100, top + 15, 880, 110, w);
    });
    return;
  }
  const top = tl.H - 150 + (1 - k) * 160;
  g.fillStyle = '#fff';
  g.fillRect(0, top, tl.W, 150);
  textLine(g, { text: 'NOS PARTENAIRES', f: font(600, 18, PROMPT), lh: 27, color: INK, x: 0, w: tl.W, top: top + 10, align: 'center', ls: 5.4 });
  partnerLogos(g, assets.partners, 180, top + 43, 720, 100, w);
}

/* ---------- Récap ---------- */
type Run = { text: string; f: string; color: string };
/** Ligne faite de plusieurs polices (ligne de base commune), coupée par « … » si trop longue. */
function runsLine(g: Ctx2D, runs: Run[], ellF: string, x: number, w: number, bl: number, align: 'left' | 'right') {
  const ws = runs.map((r) => ((g.font = r.f), measure(g, r.text)));
  let total = ws.reduce((a, b) => a + b, 0);
  if (total > w + 0.01) {
    g.font = ellF;
    let room = w - measure(g, '…');
    const out: Run[] = [];
    for (let i = 0; i < runs.length && room > 0; i++) {
      g.font = runs[i].f;
      if (ws[i] <= room) {
        out.push(runs[i]);
        room -= ws[i];
        continue;
      }
      const chars = Array.from(runs[i].text);
      let n = 0;
      while (n < chars.length && measure(g, chars.slice(0, n + 1).join('')) <= room) n++;
      out.push({ ...runs[i], text: chars.slice(0, n).join('') });
      break;
    }
    out.push({ text: '…', f: ellF, color: runs[runs.length - 1].color });
    runs = out;
    align = 'left';
    total = 0;
  }
  let cx = align === 'left' ? x : x + w - total;
  for (const r of runs) {
    g.font = r.f;
    g.fillStyle = r.color;
    g.fillText(r.text, cx, bl);
    cx += measure(g, r.text);
  }
}

/** Boîte de ligne CSS de fragments alignés sur une même ligne de base. */
function lineBox(g: Ctx2D, parts: [string, number][]) {
  let above = 0, below = 0;
  for (const [f, lh] of parts) {
    const { a, d } = metrics(g, f), half = (lh - a - d) / 2;
    above = Math.max(above, a + half);
    below = Math.max(below, d + half);
  }
  return { above, h: above + below };
}

function recapSide(g: Ctx2D, p: AnimPlayer, align: 'left' | 'right', f: number, pal: AnimPalette, x: number, rowTop: number, rowH: number, w: number) {
  const on = p.home ? f : 0, white = on > 0.5;
  const clubF = font(p.home ? 800 : 600, 12, MANROPE), rankF = font(700, 16, PROMPT);
  const l2 = lineBox(g, [[clubF, 18], [rankF, 24]]);
  const h = 4 + 22 * 1.15 + 1 + l2.h + 4, y = rowTop + (rowH - h) / 2;
  g.save();
  clipRR(g, x, y, w, h, 12);
  if (p.home) {
    g.fillStyle = pal.redA(0.08 + 0.92 * on);
    g.fillRect(x, y, w, h);
  }
  textLine(g, { text: [p.first, p.last].filter(Boolean).join(' '), f: font(700, 22, PROMPT), lh: 22 * 1.15, color: white ? '#fff' : INK, x: x + 12, w: w - 24, top: y + 4, align, ell: true });
  const clubColor = white ? '#fff' : p.home ? pal.red : '#5b5355';
  runsLine(g, [
    { text: p.rank, f: rankF, color: white ? '#fff' : pal.red },
    { text: p.rank && p.club ? ' · ' : '', f: clubF, color: clubColor },
    { text: p.club.toUpperCase(), f: clubF, color: clubColor },
  ].filter((r) => r.text), clubF, x + 12, w - 24, y + 4 + 22 * 1.15 + 1 + l2.above, align);
  g.restore();
}

function recap(g: Ctx2D, { tl, T, pal, assets }: Ctx) {
  const s = tl.cues.Recap;
  if (T < s - 0.05) return;
  const { story, OY, homeCount, W } = tl;
  const rows = tl.slots.flatMap((sl) => sl.matches.map((m) => ({ m, time: m.time })));
  const STEP = Math.min(story ? 110 : 106, ((homeCount ? 510 : 550) + (story ? 280 : 0)) / rows.length), RH = STEP - 10;
  const t = M.enter(T, s + 0.1, 0.4);
  const last = s + BEAT * (1 + (rows.length - 1) * 0.5) + 0.3;
  const cnt = M.pop(T, last + 0.1, 0.4);

  if (t > 0) {
    g.save();
    g.globalAlpha = t;
    textLine(g, { text: 'LE PROGRAMME', f: font(600, 20, PROMPT), lh: 30, color: '#fff', x: 0, w: W, top: 318 + OY + (1 - t) * 12, align: 'center', ls: 6 });
    g.restore();
  }
  const vs = vsBox(g, 46), sideW = (W - 100 - 24 - 92 - 30 - vs.w) / 2;
  rows.forEach(({ m, time }, i) => {
    const at = s + BEAT * (1 + i * 0.5);
    const k = M.pop(T, at - 0.08, 0.4);
    if (k <= 0) return;
    const f = M.draw(T, last + 0.1 + i * 0.06, 0.25); // tous les joueurs du club passent à la couleur du club, en cascade
    const x = 50 + (1 - k) * (i % 2 ? 120 : -120), y = 356 + OY + i * STEP;
    withAlpha(g, clamp(k * 2, 0, 1), (g) => {
      g.save();
      shadow(g, pal.shadeA(0.3), 28, 0, 12);
      fillRR(g, x, y, W - 100, RH, 18, m.derby ? pal.derbyRow : '#fff');
      g.restore();
      const pf = font(700, 19, PROMPT);
      g.font = pf;
      const pw = measure(g, time) + 28, ph = 19 * LH + 4, cx = x + 12;
      fillRR(g, cx + (92 - pw) / 2, y + (RH - ph) / 2, pw, ph, ph / 2, pal.red);
      textLine(g, { text: time, f: pf, lh: 19 * LH, color: '#fff', x: cx + (92 - pw) / 2 + 14, w: pw - 28, top: y + (RH - ph) / 2 + 2 });
      const ax = cx + 92 + 10, vx = ax + sideW + 10, bx = vx + vs.w + 10;
      recapSide(g, m.a, 'right', f, pal, ax, y, RH, sideW);
      drawVS(g, vs.f, vs.fs, vx, y + (RH - vs.h) / 2, pal.red);
      recapSide(g, m.b, 'left', f, pal, bx, y, RH, sideW);
    });
  });

  if (homeCount > 0 && cnt > 0) {
    const tf = font(700, 20, PROMPT), text = `${homeCount} ${homeCount > 1 ? 'JOUEURS' : 'JOUEUR'} DU CLUB EN LICE`;
    g.font = tf;
    const tw = measure(g, text, 2.4), lead = assets.logo ? 8 + 30 + 12 : 22, pw = lead + tw + 22;
    const top = 356 + OY + rows.length * STEP + 6, x = (W - pw) / 2;
    g.save();
    around(g, W / 2, top + 19, () => g.scale(0.6 + 0.4 * cnt, 0.6 + 0.4 * cnt));
    withAlpha(g, clamp(cnt * 2, 0, 1), (g) => {
      fillRR(g, x, top, pw, 38, 19, '#fff');
      if (assets.logo) drawContain(g, assets.logo, x + 8, top + 4, 30, 30);
      textLine(g, { text, f: tf, lh: 30, color: pal.red, x: x + lead, w: tw, top: top + 4, ls: 2.4 });
    });
    g.restore();
  }
}

/** Dessine l'instant `T` de l'animation dans `g`, à l'échelle de sa transformation courante. */
export function renderFrame(g: Ctx2D, tl: Timeline, T: number, pal: AnimPalette, texts: AnimationTexts, assets: FrameAssets) {
  const ctx: Ctx = { tl, T, pal, texts, assets };
  const { cues, total, W, H } = tl;
  const out = M.draw(T, cues.Outro, total - cues.Outro - 0.05);
  const kick = tl.impacts.reduce((a, i) => a + decay(T, i.t, 9) * (i.big ? 1.6 : 1), 0)
    + tl.slots.reduce((a, sl) => a + (sl.derby ? decay(T, cues[sl.cue] + 0.27, 8) * 1.5 : 0), 0);
  const camS = 1 + 0.03 * (T / total) + 0.03 * kick;
  const camY = Math.sin(T * 1.3) * 3;
  const flash = tl.impacts.reduce((a, i) => Math.max(a, decay(T, i.t, 14)), 0)
    + tl.slots.reduce((a, sl) => Math.max(a, sl.derby ? decay(T, cues[sl.cue] + 0.27, 10) : 0), 0);

  g.save();
  g.imageSmoothingQuality = 'high';
  clipRect(g, 0, 0, W, H);
  background(g, ctx);

  g.save();
  around(g, W / 2, H * 0.62, () => {
    g.translate(0, camY);
    g.scale(camS, camS);
  });
  derbyTitle(g, ctx);
  for (const c of tl.cards) card(g, c, ctx);
  recap(g, ctx);
  impactFX(g, ctx);
  g.restore();

  g.save();
  g.translate(0, camY * 0.4);
  header(g, ctx);
  tabs(g, ctx);
  g.restore();

  wipes(g, ctx);
  partners(g, ctx);
  if (flash > 0.001) {
    g.globalAlpha = Math.min(1, 0.28 * flash);
    g.fillStyle = '#fff';
    g.fillRect(0, 0, W, H);
  }
  // fondu de sortie vers le fond (boucle)
  if (out > 0) {
    g.globalAlpha = out;
    g.fillStyle = pal.dark;
    g.fillRect(0, 0, W, H);
  }
  g.restore();
}
