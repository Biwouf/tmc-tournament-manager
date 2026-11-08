// Rendu Canvas 2D de la story « Prochaines rencontres » (matches par équipes), image par image.
// Même scène que le gabarit HTML de la skill `rencontres-equipes-animation`, réécrite en Canvas
// comme l'animation du programme de tournoi (`programmeAnimation/renderFrame.ts`, dont on reprend
// les primitives : calques d'opacité, texte, ombres, court, grain). Fonction pure de `T`, sans
// DOM : elle tourne telle quelle dans le worker d'export et dans le lecteur.
import type { AnimPalette } from '../programmeAnimation/palette';
import { MANROPE, PROMPT } from '../programmeAnimation/fonts';
import { Easing, M, clamp, decay } from '../programmeAnimation/timeline';
import {
  COURTS, INK, RAD, around, baseline, clipRR, clipRect, drawContain, ellipseGradient, ellipsize, fillRR, fillRun,
  font, grain, measure, rr, shadow, shine, textLine, withAlpha,
  type Ctx2D, type FrameAssets,
} from '../programmeAnimation/renderFrame';
import { BEAT, type AnimDay, type RencontreCard, type RencontresTimeline } from './timeline';

export type RencontresTexts = {
  /** Surtitre : nom du club en majuscules. */
  kicker: string;
  title: string;
  /** Nom posé dans le bloc du club sur chaque carte : la ville, en majuscules. */
  homeName: string;
};

const MUTED = '#6b6164';
const HOUSE = 'M3 10.6 12 3l9 7.6V21a1 1 0 0 1-1 1h-5.5v-6.5h-5V22H4a1 1 0 0 1-1-1z';
const PLANE = 'M21 16v-2l-8-5V3.5c0-.83-.67-1.5-1.5-1.5S10 2.67 10 3.5V9l-8 5v2l8-2.5V19l-2 1.5V22l3.5-1 3.5 1v-1.5L13 19v-5.5l8 2.5z';
const paths = new Map<string, Path2D>();
/** Icône vectorielle 24 × 24 (maison ou avion), jamais d'emoji. */
function icon(g: Ctx2D, d: string, x: number, y: number, size: number, color: string) {
  let p = paths.get(d);
  if (!p) paths.set(d, (p = new Path2D(d)));
  g.save();
  g.translate(x, y);
  g.scale(size / 24, size / 24);
  g.fillStyle = color;
  g.fill(p);
  g.restore();
}

type Ctx = { tl: RencontresTimeline; T: number; pal: AnimPalette; texts: RencontresTexts; assets: FrameAssets };

/** Logo du club : tel quel sur fond clair ; sur fond foncé, le logo inversé, sinon le logo dans un disque blanc. */
function clubLogo(g: Ctx2D, { assets, texts, pal }: Ctx, x: number, y: number, size: number, onDark: boolean) {
  if (!onDark && assets.logo) return drawContain(g, assets.logo, x, y, size, size);
  if (onDark && assets.logoOnDark) return drawContain(g, assets.logoOnDark, x, y, size, size);
  g.beginPath();
  g.arc(x + size / 2, y + size / 2, size / 2, 0, Math.PI * 2);
  g.fillStyle = '#fff';
  g.fill();
  if (assets.logo) return drawContain(g, assets.logo, x + size * 0.13, y + size * 0.13, size * 0.74, size * 0.74);
  const initials = texts.kicker.split(/\s+/).filter(Boolean).slice(0, 2).map((w) => w[0]).join('');
  const fs = size * 0.26;
  textLine(g, { text: initials, f: font(800, fs, PROMPT), lh: fs * 1.5, color: pal.red, x, w: size, top: y + (size - fs * 1.5) / 2, align: 'center' });
}

/* ---------- Fond : court en perspective, lueur, pulsation, grain ---------- */
function background(g: Ctx2D, { tl, T, pal }: Ctx) {
  const { W, H, total } = tl;
  const prog = T / total, t0 = tl.days[0]?.start ?? 0.9;
  const beatT = T >= t0 ? t0 + Math.floor((T - t0) / BEAT) * BEAT : -9;
  const pulse = decay(T, beatT, 7) * (T >= t0 ? 1 : 0);
  const hit = tl.impacts.reduce((a, i) => Math.max(a, decay(T, i.t, 6)), 0);
  const frame = Math.floor(T * 30), gx = (frame * 73) % 256, gy = (frame * 151) % 256;

  g.fillStyle = pal.dark;
  g.fillRect(0, 0, W, H);
  const bx = -60, by = -60, bw = W + 120, bh = H + 120;
  g.save();
  around(g, bx + bw / 2, by + bh * 0.6, () => {
    g.scale(1.04 + 0.06 * prog, 1.04 + 0.06 * prog);
    g.translate(0, -24 * prog);
  });
  const box: [number, number, number, number] = [bx, by, bw, bh];
  ellipseGradient(g, bx + bw / 2, by + bh * 0.42, bw * 0.75, bh * 0.65, [[0, pal.glow], [0.42, pal.red], [1, pal.dark]], box);
  const a = 0.16 * pulse + 0.35 * hit;
  if (a > 0.001) {
    const R = Math.hypot(bw / 2, bh / 2);
    ellipseGradient(g, bx + bw / 2, by + bh / 2, R, R, [[0, pal.lightA(a)], [0.55, pal.lightA(0)]], box);
  }
  g.strokeStyle = '#fff';
  g.lineCap = 'round';
  COURTS.story.forEach((l, i) => {
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

/* ---------- En-tête : logo, surtitre, titre ---------- */
function header(g: Ctx2D, ctx: Ctx) {
  const { tl, T, pal, texts } = ctx;
  const { OY, W } = tl;
  const lg = M.pop(T, 0.0, 0.45), rule = M.draw(T, 0.25, 0.35), ti = M.pop(T, 0.38, 0.4);
  const by = T < 0.3 ? -Math.abs(Math.sin((T / 0.3) * Math.PI)) * 40 * (1 - T / 0.3) : -Math.abs(Math.sin(((T - 0.3) / 0.25) * Math.PI)) * 14 * clamp(1 - (T - 0.3) / 0.25, 0, 1);

  if (lg > 0) {
    const lx = 494, ly = 20 + OY;
    g.save();
    around(g, lx + 46, ly + 46, () => {
      g.translate(0, by);
      g.rotate((1 - lg) * -300 * RAD);
      g.scale(lg, lg);
    });
    withAlpha(g, clamp(lg * 1.5, 0, 1), (g) => clubLogo(g, ctx, lx, ly, 92, true));
    g.restore();
  }

  // Surtitre lettre par lettre, entre deux filets
  const kf = font(600, 22, PROMPT), ky = 124 + OY, ls = 6.6;
  g.font = kf;
  const chars = Array.from(texts.kicker), cws = chars.map((ch) => g.measureText(ch).width + ls);
  const kw = cws.reduce((a, b) => a + b, 0), rw = 70 * rule;
  let kx = (W - (rw * 2 + 44 + kw)) / 2;
  g.fillStyle = '#fff';
  g.fillRect(kx, ky + 15.5, rw, 2);
  g.fillRect(kx + rw + 44 + kw, ky + 15.5, rw, 2);
  kx += rw + 22;
  const kb = baseline(g, kf, ky, 33);
  g.save();
  chars.forEach((ch, i) => {
    const a = M.enter(T, 0.2 + i * 0.012, 0.22);
    if (a > 0) {
      g.globalAlpha = a;
      g.fillText(ch, kx, kb + (1 - a) * 14);
    }
    kx += cws[i];
  });
  g.restore();

  if (texts.title) {
    const tf = font(800, 78, PROMPT), tlh = 78 * 1.22, top = 156 + OY;
    const ts = 1 + 0.06 * decay(T, 0.5, 10);
    g.save();
    clipRect(g, 0, top, W, 100);
    around(g, W / 2, top + tlh / 2, () => {
      g.translate(0, (1 - ti) * 100);
      g.scale(ts, ts);
    });
    shadow(g, pal.shadeA(0.35, 12), 24, 0, 6);
    textLine(g, { text: texts.title, f: tf, lh: tlh, color: '#fff', x: 30, w: W - 60, top, align: 'center', ls: -2.34, ell: true });
    g.restore();
  }
}

/* ---------- Grosse date de chaque jour, puis version compacte sous le titre ---------- */
function bigDate(g: Ctx2D, d: AnimDay, { tl, T, pal }: Ctx) {
  if (T < d.start - 0.05 || T > d.compact + 0.6) return;
  const { W } = tl;
  const day = M.enter(T, d.start, 0.35);
  const fall = clamp((T - (d.hit - 0.2)) / 0.2, 0, 1);
  const numS = T < d.hit ? 3 - 2 * Easing.easeInQuad(fall) : 1 + 0.12 * Math.exp(-(T - d.hit) * 8) * Math.cos((T - d.hit) * 30);
  const mon = M.enter(T, d.hit + 0.15, 0.35), hr = M.pop(T, d.hit + 0.45, 0.4), sub = M.enter(T, d.hit + 0.75, 0.4);
  const away = M.draw(T, d.compact, 0.45);
  const n = d.matches.length, nh = d.matches.filter((m) => m.home).length;
  const subTxt = n === 1 ? (nh ? '1 RENCONTRE AU CLUB' : '1 RENCONTRE EN DÉPLACEMENT') : `${n} RENCONTRES`;
  const isSup = /er$/.test(d.num), base = isSup ? d.num.slice(0, -2) : d.num;
  // Colonne centrée posée en y = 640 : jour (78), numéro (330 × 0,95), mois (78), pastille, sous-titre
  const top0 = 640, numTop = top0 + 78 + 4, monTop = numTop + 313.5, pillTop = monTop + 78 + 34, subTop = pillTop + 100 + 34;

  g.save();
  around(g, W / 2, top0, () => {
    g.translate(0, -330 * away);
    g.scale(1 - 0.7 * away, 1 - 0.7 * away);
  });
  withAlpha(g, 1 - away, (g) => {
    const big = font(800, 78, PROMPT);
    g.save();
    g.globalAlpha = day;
    textLine(g, { text: d.day, f: big, lh: 78, color: '#fff', x: 0, w: W, top: top0 + (1 - day) * -40, align: 'center', ls: 6.24 });
    g.restore();

    const nf = font(800, 330, PROMPT), sf = font(800, 120, PROMPT), nls = -16.5;
    g.font = nf;
    const bw = measure(g, base, nls);
    g.font = sf;
    const ew = isSup ? 8 + measure(g, 'er') : 0;
    const nx = (W - bw - ew) / 2, nb = baseline(g, nf, numTop, 313.5), eb = baseline(g, sf, numTop, 132);
    g.save();
    g.globalAlpha = clamp(fall * 2, 0, 1);
    around(g, W / 2, numTop + 156, () => g.scale(numS, numS));
    for (const [dy, color] of [[14, pal.shadeA(0.3, 12)], [0, '#fff']] as const) {
      g.fillStyle = color;
      g.font = nf;
      fillRun(g, base, nx, nb + dy, nls);
      if (isSup) {
        g.font = sf;
        g.fillText('er', nx + bw + 8, eb + dy);
      }
    }
    g.restore();

    g.save();
    g.globalAlpha = mon;
    textLine(g, { text: d.month, f: big, lh: 78, color: '#fff', x: 0, w: W, top: monTop + (1 - mon) * 40, align: 'center', ls: 6.24 });
    g.restore();

    if (d.hours && hr > 0) {
      const pf = font(800, 64, PROMPT);
      g.font = pf;
      const pw = measure(g, d.hours) + 92, px = (W - pw) / 2;
      g.save();
      around(g, W / 2, pillTop + 50, () => g.scale(hr, hr));
      fillRR(g, px, pillTop, pw, 100, 50, '#fff');
      textLine(g, { text: d.hours, f: pf, lh: 96, color: pal.red, x: px + 46, w: pw - 92, top: pillTop + 2 });
      g.restore();
    }

    g.save();
    g.globalAlpha = sub;
    textLine(g, { text: subTxt, f: font(600, 30, PROMPT), lh: 45, color: '#fff', x: 0, w: W, top: subTop + (1 - sub) * 16, align: 'center', ls: 9 });
    g.restore();
  });
  g.restore();
}

function compactDate(g: Ctx2D, d: AnimDay, { tl, T, pal }: Ctx) {
  const k = M.enter(T, d.compact + 0.25, 0.4), out = M.draw(T, d.end - 0.35, 0.3);
  if (k <= 0 || out >= 1) return;
  const lf = font(700, 38, PROMPT), pf = font(800, 32, PROMPT);
  g.font = lf;
  const lw = measure(g, d.label);
  g.font = pf;
  const pw = d.hours ? measure(g, d.hours) + 44 : 0;
  const total = lw + (pw ? 18 + pw : 0), x = (tl.W - total) / 2, top = 268 + tl.OY + (1 - k) * 20;
  withAlpha(g, k * (1 - out), (g) => {
    textLine(g, { text: d.label, f: lf, lh: 57, color: '#fff', x, w: lw + 1, top });
    if (!pw) return;
    const px = x + lw + 18, py = top + 4.5;
    fillRR(g, px, py, pw, 48, 24, '#fff');
    textLine(g, { text: d.hours, f: pf, lh: 48, color: pal.red, x: px + 22, w: pw - 44, top: py });
  });
}

/* ---------- Carte de rencontre ---------- */
type Block = { s: number; side: 'L' | 'R'; name: string; sub: string; home: boolean; flip: number; compact: boolean };

function blockInner(g: Ctx2D, ctx: Ctx, b: Block, onRed: boolean, r: number, x: number, y: number, w: number, h: number) {
  const { pal, assets } = ctx;
  const ls = b.home && (assets.logo || assets.logoOnDark) ? (b.compact ? 42 : 54) : 0;
  const ns = Math.min(52, 360 / (Math.max(1, b.name.length) * 0.68)), nlh = ns * 1.05;
  const contentH = (ls ? ls + 6 : 0) + nlh + 6 + 30;
  let top = y + (h - contentH) / 2;
  if (ls) {
    g.save();
    g.globalAlpha = r;
    clubLogo(g, ctx, x + (w - ls) / 2, top, ls, onRed);
    g.restore();
    top += ls + 6;
  }
  textLine(g, { text: b.name, f: font(800, ns, PROMPT), lh: nlh, color: onRed ? '#fff' : INK, x: x + 14, w: w - 28, top, align: 'center', ls: -0.01 * ns, ell: true });
  top += nlh + 6;
  if (!b.sub) return;
  g.save();
  g.globalAlpha = r;
  textLine(g, { text: b.sub, f: font(700, 20, PROMPT), lh: 30, color: onRed ? '#fff' : b.home ? pal.red : MUTED, x: x + 14, w: w - 28, top, align: 'center', ls: 3.6, ell: true });
  g.restore();
}

function teamBlock(g: Ctx2D, ctx: Ctx, b: Block, x: number, y: number, w: number, h: number) {
  const { T, pal } = ctx;
  const k = M.enter(T, b.s, 0.45), r = M.enter(T, b.s + 0.3, 0.35);
  // bloc du club : il se remplit de la couleur du club (de bas en haut), puis un reflet le traverse
  const f = b.home ? M.draw(T, b.flip, 0.35) : 0;
  const sh = b.home ? clamp((T - b.flip - 0.3) / 0.45, 0, 1) : 0;
  const sc = 1 + 0.05 * (b.home ? decay(T, b.flip + 0.3, 8) : 0);
  g.save();
  around(g, x + w / 2, y + h / 2, () => {
    g.translate((1 - k) * (b.side === 'L' ? -160 : 160), 0);
    g.scale(sc, sc);
  });
  withAlpha(g, k, (g) => {
    fillRR(g, x, y, w, h, 20, b.home ? pal.redA(0.08) : '#f4f0f1');
    blockInner(g, ctx, b, false, r, x, y, w, h);
    if (f <= 0) return;
    g.save();
    clipRR(g, x, y, w, h, 20);
    clipRect(g, x, y + (1 - f) * h, w, f * h);
    g.fillStyle = pal.red;
    g.fillRect(x, y, w, h);
    g.beginPath(); // ombre intérieure `inset 0 -6px 0`
    rr(g, x, y, w, h, 20);
    rr(g, x, y - 6, w, h, 20);
    g.fillStyle = 'rgba(0,0,0,0.12)';
    g.fill('evenodd');
    blockInner(g, ctx, b, true, r, x, y, w, h);
    shine(g, sh, x, y, h, 90, 420);
    g.restore();
  });
  g.restore();
}

function card(g: Ctx2D, c: RencontreCard, ctx: Ctx) {
  const { T, pal, texts } = ctx;
  const { m, s, impact, flip, top, side, CH } = c;
  const out = M.draw(T, c.out, 0.4);
  if (T < s - 0.05 || out >= 1) return;
  const compact = CH < 380;
  const k = M.enter(T, s, 0.5);
  const fall = clamp((T - (impact - 0.18)) / 0.18, 0, 1);
  const vsS = T < impact ? 3 - 2 * Easing.easeInQuad(fall) : 1 + 0.18 * Math.exp(-(T - impact) * 9) * Math.cos((T - impact) * 38);
  const vsO = T < impact - 0.18 ? 0 : clamp(fall * 1.6, 0, 1);
  const shake = T > impact && T < impact + 0.3 ? Math.sin((T - impact) * 90) * 7 * (1 - (T - impact) / 0.3) : 0;
  const flash = decay(T, impact, 16);
  const head = M.enter(T, s + 0.15, 0.4), tag = M.pop(T, s + 0.1, 0.35);
  const bn = M.draw(T, flip + 0.15, 0.4), bnSh = clamp((T - flip - 0.6) / 0.5, 0, 1);
  const ic = M.pop(T, flip + 0.35, 0.4);
  const dir = side === 'L' ? -1 : 1;
  const L = 50, CW = 980;

  g.save();
  around(g, L + CW / 2, top + CH / 2, () => {
    g.translate((1 - k) * dir * 260 + out * -dir * 320 + shake * 0.4, (1 - k) * 60);
    g.scale(0.94 + 0.06 * k, 0.94 + 0.06 * k);
  });
  withAlpha(g, k * (1 - out), (g) => {
    fillRR(g, L - 10, top - 10, CW + 20, CH + 20, 38, 'rgba(255,255,255,0.12)');
    g.save();
    shadow(g, pal.shadeA(0.4, 10), 54, 0, 24);
    fillRR(g, L, top, CW, CH, 28, '#fff');
    g.restore();

    g.save();
    clipRR(g, L, top, CW, CH, 28);
    // En-tête : pastille horaire, catégorie, compétition
    const padX = compact ? 28 : 30, rowTop = top + (compact ? 18 : 24), ph = 33.5;
    let x = L + padX;
    if (m.time) {
      const tf = font(800, 21, PROMPT);
      g.font = tf;
      const tw = measure(g, m.time) + 32;
      g.save();
      around(g, x + tw / 2, rowTop + ph / 2, () => g.scale(tag, tag));
      fillRR(g, x, rowTop, tw, ph, ph / 2, pal.red);
      textLine(g, { text: m.time, f: tf, lh: 31.5, color: '#fff', x: x + 16, w: tw - 32, top: rowTop + 1 });
      g.restore();
      x += tw + 12;
    }
    const gf = font(700, 17, PROMPT);
    g.font = gf;
    const gw = Math.min(measure(g, m.tag, 2.38) + 32, L + CW - padX - x);
    g.save();
    around(g, x, rowTop + ph / 2, () => g.scale(tag, tag));
    g.beginPath();
    rr(g, x + 1, rowTop + 1, gw - 2, ph - 2, ph / 2 - 1);
    g.strokeStyle = pal.red;
    g.lineWidth = 2;
    g.stroke();
    textLine(g, { text: m.tag, f: gf, lh: 25.5, color: pal.red, x: x + 16, w: gw - 32, top: rowTop + 4, ls: 2.38, ell: true });
    g.restore();
    const cs = m.comp.length > 30 ? 29 : 34, clh = cs * 1.15, ctop = rowTop + ph + 8;
    g.save();
    g.globalAlpha = head;
    textLine(g, { text: m.comp, f: font(700, cs, PROMPT), lh: clh, color: INK, x: L + padX, w: CW - 2 * padX, top: ctop + (1 - head) * 14, ell: true });
    g.restore();

    // Club (toujours à gauche) VS adversaire
    const bannerH = compact ? 48 : 54, midTop = ctop + clh, midH = top + CH - bannerH - midTop;
    const pT = compact ? 10 : 14, pB = compact ? 14 : 18;
    const bw = (CW - 48 - 104) / 2, bx = L + 24, by = midTop + pT, bh = midH - pT - pB;
    teamBlock(g, ctx, { s: s + 0.08, side: 'L', name: texts.homeName, sub: m.team, home: true, flip, compact }, bx, by, bw, bh);
    if (vsO > 0) {
      const size = compact ? 56 : 64, vf = font(800, size, PROMPT, true), vls = -0.04 * size;
      g.font = vf;
      const vw = measure(g, 'VS', vls), vx = bx + bw + (104 - vw) / 2, vtop = by + (bh - size) / 2;
      g.save();
      g.globalAlpha = vsO;
      around(g, vx + vw / 2, vtop + size / 2, () => {
        g.translate(shake, 0);
        g.scale(vsS, vsS);
        g.rotate((1 - fall) * -12 * RAD);
      });
      textLine(g, { text: 'VS', f: vf, lh: size, color: pal.red, x: vx, w: vw + 1, top: vtop, ls: vls });
      g.restore();
    }
    teamBlock(g, ctx, { s: s + 0.08, side: 'R', name: m.opp.name, sub: m.opp.sub, home: false, flip, compact }, bx + bw + 104, by, bw, bh);

    // Bandeau domicile / déplacement, déployé depuis le centre
    if (bn > 0) {
      const bt = top + CH - bannerH, text = m.home ? 'À DOMICILE · AU CLUB' : 'DÉPLACEMENT', bf = font(700, 20, PROMPT);
      g.save();
      clipRect(g, L + ((1 - bn) * CW) / 2, bt, bn * CW, bannerH);
      g.fillStyle = m.home ? pal.dark : INK;
      g.fillRect(L, bt, CW, bannerH);
      g.font = bf;
      const tw = measure(g, text, 6), cx = L + (CW - (26 + 14 + tw)) / 2;
      if (ic > 0) {
        g.save();
        around(g, cx + 13, bt + bannerH / 2, () => g.scale(ic, ic));
        icon(g, m.home ? HOUSE : PLANE, cx, bt + (bannerH - 26) / 2, 26, '#fff');
        g.restore();
      }
      textLine(g, { text, f: bf, lh: 30, color: '#fff', x: cx + 40, w: tw + 1, top: bt + (bannerH - 30) / 2, ls: 6 });
      shine(g, bnSh, L, bt, bannerH, 110, 980);
      g.restore();
    }
    if (flash > 0.01) {
      g.globalAlpha = 0.85 * flash;
      g.fillStyle = '#fff';
      g.fillRect(L, top, CW, CH);
      g.globalAlpha = 1;
    }
    g.restore();

    g.beginPath();
    rr(g, L - 8, top - 8, CW + 16, CH + 16, 36);
    g.strokeStyle = '#fff';
    g.lineWidth = 4;
    g.stroke();
  });
  g.restore();
}

/* ---------- Récap (plusieurs écrans) ---------- */
function recap(g: Ctx2D, { tl, T, pal }: Ctx) {
  const R = tl.recap;
  if (!R || T < R.start - 0.05 || T > R.end + 0.1) return;
  const out = M.draw(T, R.end - 0.4, 0.4), ti = M.enter(T, R.start + 0.1, 0.4);
  const { W, OY } = tl, RH = R.rowH;
  withAlpha(g, 1 - out, (g) => {
    g.save();
    g.globalAlpha = ti;
    textLine(g, { text: 'LE RÉCAP', f: font(700, 30, PROMPT), lh: 45, color: '#fff', x: 0, w: W, top: 268 + OY + (1 - ti) * 16, align: 'center', ls: 10.5 });
    g.restore();
    for (const it of R.items) {
      if (it.type === 'head') {
        const k = M.enter(T, it.at, 0.4);
        withAlpha(g, k, (g) => {
          const hf = font(800, 34, PROMPT), label = it.day.label.toLocaleUpperCase('fr-FR'), x = 60 + (1 - k) * -60;
          g.font = hf;
          const lw = measure(g, label, 1.36);
          textLine(g, { text: label, f: hf, lh: 54, color: '#fff', x, w: lw + 1, top: it.y, ls: 1.36 });
          g.fillStyle = 'rgba(255,255,255,0.5)';
          g.fillRect(x + lw + 16, it.y + 26, Math.max(0, W - 60 - (x + lw + 16)), 2);
        });
        continue;
      }
      const { m, i, y } = it;
      const k = M.pop(T, R.rows0 + i * 0.2, 0.4);
      if (k <= 0) continue;
      const b = M.pop(T, R.badges + i * 0.08, 0.4), hl = M.draw(T, R.badges + i * 0.08, 0.3);
      const x = 50 + (1 - k) * (i % 2 ? 120 : -120);
      withAlpha(g, clamp(k * 2, 0, 1), (g) => {
        g.save();
        shadow(g, pal.shadeA(0.3, 10), 28, 0, 12);
        fillRR(g, x, y, 980, RH, 20, '#fff');
        g.restore();
        // horaire
        if (m.time) {
          const tf = font(800, 22, PROMPT);
          g.font = tf;
          const pw = measure(g, m.time) + 28, px = x + 18 + (74 - pw) / 2, py = y + (RH - 35) / 2;
          fillRR(g, px, py, pw, 35, 17.5, pal.red);
          textLine(g, { text: m.time, f: tf, lh: 33, color: '#fff', x: px + 14, w: pw - 28, top: py + 1 });
        }
        // badge AU CLUB / EXT., qui se colore en cascade
        const bt = m.home ? 'AU CLUB' : 'EXT.', bf = font(700, 18, PROMPT);
        g.font = bf;
        const btw = measure(g, bt, 1.44), bw = 12 + 24 + 10 + btw + 16, bh = 43, bx = x + 980 - 18 - bw, by = y + (RH - bh) / 2;
        if (b > 0) {
          const fg = hl > 0.5 ? '#fff' : m.home ? pal.red : INK;
          g.save();
          g.globalAlpha = clamp(b * 2, 0, 1);
          around(g, bx + bw / 2, by + bh / 2, () => g.scale(0.4 + 0.6 * b, 0.4 + 0.6 * b));
          if (hl > 0) fillRR(g, bx, by, bw, bh, bh / 2, m.home ? pal.redA(hl) : `rgba(26,20,22,${hl})`);
          icon(g, m.home ? HOUSE : PLANE, bx + 12, by + (bh - 24) / 2, 24, fg);
          textLine(g, { text: bt, f: bf, lh: 27, color: fg, x: bx + 46, w: btw + 1, top: by + 8, ls: 1.44 });
          g.restore();
        }
        // équipe VS adversaire, puis compétition · catégorie
        const mx = x + 18 + 74 + 18, mw = bx - 18 - mx, top = y + (RH - 72.5) / 2;
        const teamF = font(800, 22, PROMPT), vsF = font(800, 22, PROMPT, true), oppF = font(800, 30, PROMPT);
        const bl = baseline(g, oppF, top, 45);
        let cx = mx;
        g.font = teamF;
        g.fillStyle = pal.red;
        fillRun(g, m.team, cx, bl, 2.2);
        cx += measure(g, m.team, 2.2) + 12;
        g.font = vsF;
        g.fillStyle = '#b9adb0';
        g.fillText('VS', cx, bl);
        cx += measure(g, 'VS') + 12;
        g.font = oppF;
        g.fillStyle = INK;
        const opp = `${m.opp.name} ${m.opp.sub.replace('TENNIS CLUB', 'TC')}`.trim();
        if (mx + mw - cx > 20) g.fillText(ellipsize(g, opp, mx + mw - cx), cx, bl);
        const tagCap = m.tag.charAt(0) + m.tag.slice(1).toLocaleLowerCase('fr-FR');
        textLine(g, { text: `${m.comp} · ${tagCap}`, f: font(600, 17, MANROPE), lh: 25.5, color: MUTED, x: mx, w: mw, top: top + 47, ell: true });
      });
    }
  });
}

/* ---------- Écran final ---------- */
function cta(g: Ctx2D, ctx: Ctx) {
  const { tl, T, pal } = ctx;
  const s = tl.end;
  if (T < s - 0.05) return;
  const W = tl.W;
  const lg = M.pop(T, s + 0.1, 0.5);
  const hit = s + 0.55, fall = clamp((T - (hit - 0.2)) / 0.2, 0, 1);
  const tS = T < hit ? 2.6 - 1.6 * Easing.easeInQuad(fall) : 1 + 0.08 * Math.exp(-(T - hit) * 9) * Math.cos((T - hit) * 34);
  const p1 = M.pop(T, s + 1.0, 0.45), p2 = M.pop(T, s + 1.2, 0.45);
  const bob = Math.sin((T - s) * 3) * 6;

  if (lg > 0) {
    g.save();
    around(g, W / 2, 685, () => {
      g.translate(0, bob);
      g.scale(lg, lg);
    });
    g.save();
    shadow(g, pal.shadeA(0.4, 10), 50, 0, 20);
    g.beginPath();
    g.arc(W / 2, 685, 85, 0, Math.PI * 2);
    g.fillStyle = '#fff';
    g.fill();
    g.restore();
    clubLogo(g, ctx, W / 2 - 70, 615, 140, false);
    g.restore();
  }

  const a = clamp(fall * 2, 0, 1);
  if (a > 0) {
    const f = font(800, 112, PROMPT, true), ls = -3.36, top = 810;
    g.save();
    g.globalAlpha = a;
    around(g, W / 2, top + 112, () => g.scale(tS, tS));
    for (const [dy, color] of [[10, pal.shadeA(0.3, 12)], [0, '#fff']] as const)
      ['VENEZ NOUS', 'ENCOURAGER !'].forEach((line, i) => textLine(g, { text: line, f, lh: 112, color, x: 0, w: W, top: top + i * 112 + dy, align: 'center', ls }));
    g.restore();
  }

  const pills = [
    tl.nHome > 0 && { k: p1, d: HOUSE, text: `${tl.nHome} au club`, dark: false },
    tl.nAway > 0 && { k: p2, d: PLANE, text: `${tl.nAway} en déplacement`, dark: true },
  ].filter((p): p is { k: number; d: string; text: string; dark: boolean } => !!p);
  const pf = font(700, 32, PROMPT);
  g.font = pf;
  const ws = pills.map((p) => 22 + 30 + 14 + measure(g, p.text) + 30);
  let x = (W - ws.reduce((a, b) => a + b, 0) - 20 * (pills.length - 1)) / 2;
  const top = 1078, h = 68;
  pills.forEach((p, i) => {
    const w = ws[i];
    if (p.k > 0) {
      g.save();
      around(g, x + w / 2, top + h / 2, () => g.scale(p.k, p.k));
      g.save();
      shadow(g, pal.shadeA(0.35, 10), 30, 0, 14);
      fillRR(g, x, top, w, h, h / 2, p.dark ? INK : '#fff');
      g.restore();
      const fg = p.dark ? '#fff' : pal.red;
      icon(g, p.d, x + 22, top + (h - 30) / 2, 30, fg);
      textLine(g, { text: p.text, f: pf, lh: 48, color: fg, x: x + 66, w: w - 96, top: top + 10 });
      g.restore();
    }
    x += w + 20;
  });
}

/** Partenaires : uniquement sur l'écran final, panneau blanc, logos révélés colonne par colonne. */
function partners(g: Ctx2D, { tl, T, assets, pal }: Ctx) {
  const logos = assets.partners;
  if (logos.length === 0) return;
  const k = M.enter(T, tl.partners, 0.45);
  if (k <= 0) return;
  const half = Math.ceil(logos.length / 2);
  const rows = logos.length > 5 ? [logos.slice(0, half), logos.slice(half)] : [logos];
  const contentH = rows.length > 1 ? 130 : 90, rowH = (contentH - 10 * (rows.length - 1)) / rows.length;
  const panelH = contentH + 36, top = tl.H - 270 - panelH + (1 - k) * 120;
  withAlpha(g, clamp(k * 1.5, 0, 1), (g) => {
    g.save();
    shadow(g, pal.shadeA(0.3, 10), 36, 0, 16);
    fillRR(g, 50, top, tl.W - 100, panelH, 24, '#fff');
    g.restore();
    rows.forEach((row, r) => {
      const n = row.length, full = n * 160 + (n - 1) * 24, w = 880;
      const iw = full > w ? 160 - (full - w) / n : 160;
      let ix = 100 + (w - (n * iw + (n - 1) * 24)) / 2;
      row.forEach((img, j) => {
        const p = M.pop(T, tl.partners + 0.1 + j * 0.15, 0.4), y = top + 18 + r * (rowH + 10);
        if (p > 0) {
          const x0 = ix;
          withAlpha(g, clamp(p * 1.5, 0, 1), (g) => {
            g.save();
            around(g, x0 + iw / 2, y + rowH / 2, () => {
              g.translate(0, (1 - p) * 30);
              g.scale(0.6 + 0.4 * p, 0.6 + 0.4 * p);
            });
            drawContain(g, img, x0, y, iw, rowH);
            g.restore();
          });
        }
        ix += iw + 24;
      });
    });
  });
}

/* ---------- Impacts, balayages ---------- */
const SHARDS = Array.from({ length: 16 }, (_, i) => ({
  a: (i / 16) * Math.PI * 2 + ((i * 37) % 10) / 20, v: 520 + ((i * 53) % 7) * 70, s: 6 + (i % 4) * 3, red: i % 3 === 0, spin: ((i * 29) % 11) - 5,
}));
function impactFX(g: Ctx2D, { tl, T, pal }: Ctx) {
  for (const im of tl.impacts) {
    const dt = T - im.t;
    if (dt < 0 || dt > 0.7) continue;
    const r = Easing.easeOutCubic(clamp(dt / 0.55, 0, 1)), R = im.big ? 1.4 : 1, r2 = clamp(dt / 0.4, 0, 1);
    g.save();
    g.beginPath();
    g.arc(im.x, im.y, (40 + 480 * r) * R, 0, Math.PI * 2);
    g.globalAlpha = 0.75 * (1 - r);
    g.strokeStyle = '#fff';
    g.lineWidth = 22 * (1 - r) + 1;
    g.stroke();
    g.beginPath();
    g.arc(im.x, im.y, (20 + 300 * Easing.easeOutCubic(r2)) * R, 0, Math.PI * 2);
    g.globalAlpha = 0.5 * (1 - r2);
    g.strokeStyle = im.big ? '#fff' : pal.red;
    g.lineWidth = 8;
    g.stroke();
    g.globalAlpha = clamp(1 - dt / 0.65, 0, 1);
    for (const sh of SHARDS) {
      const d = sh.v * R * dt * (1 - dt * 0.6);
      const x = im.x + Math.cos(sh.a) * d, y = im.y + Math.sin(sh.a) * d + 420 * dt * dt;
      g.save();
      g.translate(x, y);
      g.rotate(sh.spin * dt * 120 * RAD);
      g.fillStyle = sh.red && !im.big ? pal.red : '#fff';
      g.fillRect(-sh.s / 2, -sh.s / 2, sh.s, sh.s * 0.55);
      g.restore();
    }
    g.restore();
  }
}

function wipes(g: Ctx2D, { tl, T, pal }: Ctx) {
  const ww = 1200, top = -200, h = tl.H + 400;
  for (const cue of tl.wipes) {
    const p = clamp((T - (cue - 0.42)) / 0.5, 0, 1);
    if (p <= 0 || p >= 1) continue;
    g.save();
    around(g, ww / 2, top + h / 2, () => {
      g.translate(-2100 + Easing.easeInOutCubic(p) * 4200, 0);
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

/** Dessine l'instant `T` de la story dans `g`, à l'échelle de sa transformation courante. */
export function renderRencontresFrame(g: Ctx2D, tl: RencontresTimeline, T: number, pal: AnimPalette, texts: RencontresTexts, assets: FrameAssets) {
  const ctx: Ctx = { tl, T, pal, texts, assets };
  const { W, H, total, outro } = tl;
  const out = M.draw(T, outro, total - outro - 0.05);
  const kick = tl.impacts.reduce((a, i) => a + decay(T, i.t, 9) * (i.big ? 1.5 : 1), 0);
  const camS = 1 + 0.025 * (T / total) + 0.03 * kick, camY = Math.sin(T * 1.3) * 3;
  const flash = tl.impacts.reduce((a, i) => Math.max(a, decay(T, i.t, 14)), 0);

  g.save();
  g.imageSmoothingQuality = 'high';
  clipRect(g, 0, 0, W, H);
  background(g, ctx);

  g.save();
  around(g, W / 2, H * 0.55, () => {
    g.translate(0, camY);
    g.scale(camS, camS);
  });
  for (const d of tl.days) bigDate(g, d, ctx);
  for (const c of tl.cards) card(g, c, ctx);
  recap(g, ctx);
  cta(g, ctx);
  impactFX(g, ctx);
  g.restore();

  g.save();
  g.translate(0, camY * 0.4);
  header(g, ctx);
  for (const d of tl.days) compactDate(g, d, ctx);
  g.restore();

  wipes(g, ctx);
  partners(g, ctx);
  if (flash > 0.001) {
    g.globalAlpha = Math.min(1, 0.25 * flash);
    g.fillStyle = '#fff';
    g.fillRect(0, 0, W, H);
  }
  if (out > 0) { // fondu de sortie vers le fond
    g.globalAlpha = out;
    g.fillStyle = pal.dark;
    g.fillRect(0, 0, W, H);
  }
  g.restore();
}
