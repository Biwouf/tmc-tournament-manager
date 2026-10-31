// Scène de l'animation, rendue à taille réelle (1080 × 1920 en story, 1080 × 1080 en carré).
// Portage fidèle des composants de la skill `tournoi-animation-facebook` : tout est une fonction
// pure de `T` — aucun état, aucun `Date.now()` —, condition pour que l'export image par image
// donne exactement l'aperçu. Les couleurs sont dérivées de `brand.color` (`palette.ts`),
// le logo et les partenaires viennent de la config du club, déjà convertis en data URL.
import type { CSSProperties } from 'react';
import { MANROPE, PROMPT } from './fonts';
import type { AnimPalette } from './palette';
import {
  BEAT, CARD_H, DERBY_LEAD, Easing, M, PARTNERS_BOTTOM, PARTNERS_H, TITLE_HIT, clamp, decay, derbyOn,
  type AnimCard, type AnimPlayer, type Timeline,
} from './timeline';

const INK = '#1a1416';
export type AnimationTexts = { title: string; kicker: string; datePrefix: string; dateLabel: string };
export type AnimationAssets = {
  /** Logo pour fond clair (cartes, pastille du récap). */
  logo: string | null;
  /** Logo pour fond foncé (en-tête). Absent : le logo clair est posé dans un disque blanc. */
  logoOnDark: string | null;
  partners: string[];
};

type Ctx = { tl: Timeline; T: number; pal: AnimPalette; texts: AnimationTexts; assets: AnimationAssets };

const ELL: CSSProperties = { whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' };

/* ---------- Grain : tuile de bruit générée une fois (PRNG déterministe) ---------- */
let grainUrl: string | null = null;
function grain(): string {
  if (grainUrl) return grainUrl;
  const c = document.createElement('canvas');
  c.width = c.height = 256;
  const g = c.getContext('2d')!, img = g.createImageData(256, 256);
  let x = 1234567;
  for (let i = 0; i < img.data.length; i += 4) {
    x ^= x << 13; x ^= x >>> 17; x ^= x << 5;
    const v = (x >>> 0) % 256;
    img.data[i] = img.data[i + 1] = img.data[i + 2] = v;
    img.data[i + 3] = 255;
  }
  g.putImageData(img, 0, 0);
  grainUrl = c.toDataURL('image/png');
  return grainUrl;
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
  ].map((l) => ({ ...l, len: Math.hypot(l.b[0] - l.a[0], l.b[1] - l.a[1]) }));
}
const COURTS = { story: court(true), carre: court(false) };

function Background({ tl, T, pal }: Ctx) {
  const { W, H, cues, total } = tl;
  const prog = T / total;
  const beatT = T >= cues.Date ? cues.Date + Math.floor((T - cues.Date) / BEAT) * BEAT : -9;
  const pulse = decay(T, beatT, 7) * (T >= cues.Date ? 1 : 0);
  const hit = tl.impacts.reduce((a, i) => Math.max(a, decay(T, i.t, 6)), 0);
  const dOn = derbyOn(tl, T);
  const frame = Math.floor(T * 30);
  const gx = (frame * 73) % 256, gy = (frame * 151) % 256;
  return (
    <div style={{ position: 'absolute', inset: 0, overflow: 'hidden', background: pal.dark }}>
      <div style={{ position: 'absolute', inset: -60, transform: `scale(${1.04 + 0.06 * prog}) translateY(${-24 * prog}px)`, transformOrigin: '50% 60%' }}>
        <div style={{ position: 'absolute', inset: 0, background: `radial-gradient(ellipse 75% 65% at 50% 42%, ${pal.glow} 0%, ${pal.red} 42%, ${pal.dark} 100%)` }} />
        <div style={{ position: 'absolute', inset: 0, background: pal.derbyShade, opacity: 0.45 * dOn }} />
        <div style={{ position: 'absolute', inset: 0, background: `radial-gradient(circle at 50% 50%, ${pal.lightA(0.16 * pulse + 0.35 * hit)} 0%, ${pal.lightA(0)} 55%)` }} />
        <svg width={W + 120} height={H + 120} viewBox={`-60 -60 ${W + 120} ${H + 120}`} style={{ position: 'absolute', left: 0, top: 0 }}>
          {COURTS[tl.format].map((l, i) => {
            const p = M.draw(T, 0.1 + i * 0.05, 0.7);
            return (
              <line key={i} x1={l.a[0]} y1={l.a[1]} x2={l.b[0]} y2={l.b[1]} stroke="#fff" strokeOpacity={l.net ? 0.22 : 0.15 + 0.06 * pulse} strokeWidth={l.net ? 5 : 3}
                strokeDasharray={l.len} strokeDashoffset={l.len * (1 - p)} strokeLinecap="round" />
            );
          })}
        </svg>
      </div>
      <div style={{ position: 'absolute', inset: 0, background: `radial-gradient(ellipse 80% 80% at 50% 50%, ${pal.shadeA(0, 8)} 55%, ${pal.shadeA(0.55, 8)} 100%)` }} />
      <div style={{ position: 'absolute', inset: 0, backgroundImage: `url(${grain()})`, backgroundPosition: `${gx}px ${gy}px`, opacity: 0.07, mixBlendMode: 'overlay' }} />
    </div>
  );
}

// Même dessin que le VS de l'affiche, à la couleur du club. L'italique déborde à droite de sa
// boîte : `left` le recentre visuellement (sinon il touche le bloc rouge d'un joueur du club).
function VS({ size, color, style }: { size: number; color: string; style?: CSSProperties }) {
  return (
    <div style={{ position: 'relative', left: '-0.08em', fontFamily: '"Arial Black", Impact, sans-serif', fontStyle: 'italic', fontWeight: 900, fontSize: size * 0.8, color, lineHeight: 1, ...style }}>VS</div>
  );
}

// Bande de reflet qui traverse un élément (p de 0 à 1)
function Shine({ p, w = 90, span = 640 }: { p: number; w?: number; span?: number }) {
  if (p <= 0 || p >= 1) return null;
  return (
    <div style={{ position: 'absolute', top: -20, bottom: -20, left: 0, width: w, transform: `translateX(${-w - 40 + p * (span + w + 80)}px) skewX(-20deg)`,
      background: 'linear-gradient(90deg, rgba(255,255,255,0) 0%, rgba(255,255,255,0.55) 50%, rgba(255,255,255,0) 100%)', pointerEvents: 'none' }} />
  );
}

function PlayerLines({ p, r, onRed, pal }: { p: AnimPlayer; r: number; onRed?: boolean; pal: AnimPalette }) {
  return (
    <>
      <div style={{ fontFamily: PROMPT, fontWeight: 600, fontSize: 26, color: onRed ? '#fff' : INK, lineHeight: 1.1, ...ELL }}>{p.first || ' '}</div>
      <div style={{ fontFamily: PROMPT, fontWeight: 700, fontSize: 31, color: onRed ? '#fff' : INK, lineHeight: 1.15, ...ELL }}>{p.last}</div>
      <div style={{ fontFamily: PROMPT, fontWeight: 700, fontSize: 24, lineHeight: 1.3, color: onRed ? '#fff' : pal.red, opacity: r, transform: `translateY(${(1 - r) * 10}px)` }}>{p.rank || ' '}</div>
      <div style={{ fontFamily: MANROPE, fontWeight: p.home ? 800 : 600, fontSize: 14, color: onRed ? '#fff' : p.home ? pal.red : '#5b5355', textTransform: 'uppercase', letterSpacing: '0.02em', marginTop: 2, opacity: r, ...ELL }}>{p.club}</div>
    </>
  );
}

function Player({ p, T, s, side, flipAt, pal }: { p: AnimPlayer; T: number; s: number; side: 'L' | 'R'; flipAt: number; pal: AnimPalette }) {
  const k = M.enter(T, s, 0.45), r = M.enter(T, s + 0.55, 0.35);
  // joueur du club : le bloc se remplit de la couleur du club (de bas en haut) puis un reflet le traverse
  const f = p.home ? M.draw(T, flipAt, 0.35) : 0;
  const sh = p.home ? clamp((T - flipAt - 0.3) / 0.45, 0, 1) : 0;
  const col: CSSProperties = { position: 'absolute', inset: 0, borderRadius: 16, padding: '6px 6px', display: 'flex', flexDirection: 'column', justifyContent: 'center', textAlign: 'center' };
  return (
    <div style={{ flex: 1, minWidth: 0, alignSelf: 'stretch', position: 'relative',
      opacity: k, transform: `translateX(${(1 - k) * (side === 'L' ? -160 : 160)}px) scale(${1 + 0.05 * decay(T, flipAt + 0.3, 8) * (p.home ? 1 : 0)})` }}>
      <div style={{ ...col, background: p.home ? pal.redA(0.08) : 'transparent' }}><PlayerLines p={p} r={r} pal={pal} /></div>
      {p.home && f > 0 && (
        <div style={{ ...col, background: pal.red, overflow: 'hidden', clipPath: `inset(${(1 - f) * 100}% 0 0 0 round 16px)`, boxShadow: 'inset 0 -6px 0 rgba(0,0,0,0.12)' }}>
          <PlayerLines p={p} r={r} onRed pal={pal} />
          <Shine p={sh} span={340} />
        </div>
      )}
    </div>
  );
}

function Card({ c, T, pal, logo }: { c: AnimCard; T: number; pal: AnimPalette; logo: string | null }) {
  const { m, time, s, e, top, impact } = c;
  if (T < s - 0.05 || T > e + 0.5) return null;
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
  // tampon du club : chute en tournant dans le coin de la carte
  const st = M.enter(T, flipAt + 0.05, 0.22);
  const stamp = T < flipAt + 0.05 ? 0 : 1;
  const shadow = `0 22px 50px ${pal.shadeA(0.38)}`;
  return (
    <div style={{ position: 'absolute', left: 50, right: 50, top, height: CARD_H, borderRadius: 26, background: '#fff', overflow: 'hidden',
      outline: m.banner ? '4px solid #fff' : 'none', outlineOffset: 6, boxShadow: m.banner ? `${shadow}, 0 0 0 10px rgba(255,255,255,0.12)` : shadow, display: 'flex', flexDirection: 'column',
      opacity: k * (1 - x), transform: `translate(${-x * 320 + shake * 0.4}px, ${(1 - k) * 160}px) scale(${0.94 + 0.06 * k})` }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 18, padding: '12px 28px 0', position: 'relative' }}>
        <div style={{ background: pal.red, color: '#fff', fontFamily: PROMPT, fontWeight: 700, fontSize: 24, borderRadius: 999, padding: '2px 20px', transform: `scale(${pill})`, flexShrink: 0 }}>{time}</div>
        <div style={{ fontFamily: PROMPT, fontWeight: 600, fontSize: 24, color: pal.red, opacity: M.enter(T, s + 0.2, 0.35), minWidth: 0, paddingRight: hasHome && logo ? 56 : 0, ...ELL }}>{m.cat}</div>
        {hasHome && logo && (
          <img src={logo} alt="" style={{ position: 'absolute', right: 24, top: 8, width: 44, height: 44, objectFit: 'contain',
            opacity: stamp * clamp(st * 3, 0, 1), transform: `rotate(${(1 - st) * -140}deg) scale(${2.4 - 1.4 * st})` }} />
        )}
      </div>
      <div style={{ flex: 1, display: 'flex', alignItems: 'center', gap: 6, padding: '6px 24px 8px', minHeight: 0 }}>
        <Player p={m.a} T={T} s={s + 0.08} side="L" flipAt={flipAt} pal={pal} />
        <div style={{ width: 112, flexShrink: 0, alignSelf: 'stretch', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 8 }}>
          <div style={{ flex: 1, width: 2, background: pal.redA(0.25), transform: `scaleY(${line})`, transformOrigin: 'bottom' }} />
          <VS size={84} color={pal.red} style={{ opacity: vsOp, transform: `translateX(${shake}px) scale(${vsScale}) rotate(${(1 - fall) * -12}deg)` }} />
          <div style={{ flex: 1, width: 2, background: pal.redA(0.25), transform: `scaleY(${line})`, transformOrigin: 'top' }} />
        </div>
        <Player p={m.b} T={T} s={s + 0.08} side="R" flipAt={flipAt + (m.derby ? 0.12 : 0)} pal={pal} />
      </div>
      {m.banner && (
        <div style={{ position: 'relative', overflow: 'hidden', background: pal.dark, color: '#fff', textAlign: 'center', fontFamily: PROMPT, fontWeight: m.derby ? 700 : 600, fontSize: m.derby ? 18 : 16, letterSpacing: '0.3em', padding: '7px 0', flexShrink: 0, clipPath: `inset(0 ${(1 - bn) * 50}% 0 ${(1 - bn) * 50}%)`, ...ELL }}>
          {m.banner}
          <Shine p={bnShine} w={110} span={980} />
        </div>
      )}
      {flash > 0.01 && <div style={{ position: 'absolute', inset: 0, background: '#fff', opacity: 0.85 * flash, pointerEvents: 'none' }} />}
    </div>
  );
}

// Mot DERBY plein écran en ouverture d'un écran derby, puis en filigrane derrière la carte
function DerbyTitle({ tl, T, pal }: Ctx) {
  return tl.slots.map((sl, i) => {
    if (!sl.derby) return null;
    const c = tl.cues[sl.cue], end = tl.slots[i + 1] ? tl.cues[tl.slots[i + 1].cue] : tl.cues.Recap;
    if (T < c - 0.05 || T > end) return null;
    const slam = clamp((T - c - 0.05) / 0.22, 0, 1);
    const sc = T < c + 0.27 ? 2.6 - 1.6 * Easing.easeInQuad(slam) : 1 + 0.06 * Math.exp(-(T - c - 0.27) * 9) * Math.cos((T - c - 0.27) * 36);
    const back = M.draw(T, c + DERBY_LEAD - 0.35, 0.45); // recule en filigrane quand la carte arrive
    const out = M.draw(T, end - 0.45, 0.35);
    const sub = M.enter(T, c + 0.6, 0.35);
    const y = tl.story ? 1040 - 230 * back : 560 - 90 * back;
    return (
      <div key={i} style={{ position: 'absolute', left: 0, right: 0, top: y - 170, height: 340, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', pointerEvents: 'none',
        opacity: clamp(slam * 2, 0, 1) * (1 - out) }}>
        <div style={{ fontFamily: PROMPT, fontWeight: 800, fontSize: 250, lineHeight: 0.9, letterSpacing: '-0.02em', fontStyle: 'italic',
          color: `rgba(255,255,255,${1 - 0.88 * back})`, WebkitTextStroke: `${3 * back}px rgba(255,255,255,0.35)`,
          textShadow: back < 0.5 ? `0 12px 0 ${pal.shadeA(0.35, 12)}` : 'none', transform: `scale(${sc * (1 - 0.25 * back)})` }}>DERBY</div>
        <div style={{ marginTop: 8, maxWidth: 1000, fontFamily: PROMPT, fontWeight: 600, fontSize: 22, letterSpacing: '0.35em', color: '#fff', opacity: sub * (1 - back), transform: `translateY(${(1 - sub) * 16}px)`, ...ELL }}>
          100 % {tl.club.toUpperCase()}
        </div>
      </div>
    );
  });
}

const SHARDS = Array.from({ length: 16 }, (_, i) => {
  const a = (i / 16) * Math.PI * 2 + ((i * 37) % 10) / 20;
  return { a, v: 520 + ((i * 53) % 7) * 70, s: 6 + (i % 4) * 3, red: i % 3 === 0, spin: ((i * 29) % 11) - 5 };
});
function ImpactFX({ tl, T, pal }: Ctx) {
  return tl.impacts.map((im, n) => {
    const dt = T - im.t;
    if (dt < 0 || dt > 0.7) return null;
    const r = Easing.easeOutCubic(clamp(dt / 0.55, 0, 1)), R = im.big ? 1.4 : 1;
    return (
      <svg key={n} width={tl.W} height={tl.H} style={{ position: 'absolute', left: 0, top: 0, pointerEvents: 'none' }}>
        <circle cx={im.x} cy={im.y} r={(40 + 480 * r) * R} fill="none" stroke="#fff" strokeOpacity={0.75 * (1 - r)} strokeWidth={22 * (1 - r) + 1} />
        <circle cx={im.x} cy={im.y} r={(20 + 300 * Easing.easeOutCubic(clamp(dt / 0.4, 0, 1))) * R} fill="none" stroke={pal.red} strokeOpacity={0.6 * (1 - clamp(dt / 0.4, 0, 1))} strokeWidth={8} />
        {SHARDS.map((sh, i) => {
          const d = sh.v * R * dt * (1 - dt * 0.6);
          const x = im.x + Math.cos(sh.a) * d, y = im.y + Math.sin(sh.a) * d + 420 * dt * dt;
          const o = clamp(1 - dt / 0.65, 0, 1);
          return <rect key={i} x={x - sh.s / 2} y={y - sh.s / 2} width={sh.s} height={sh.s * 0.55} fill={sh.red ? pal.red : '#fff'} opacity={o}
            transform={`rotate(${sh.spin * dt * 120} ${x} ${y})`} />;
        })}
      </svg>
    );
  });
}

function Wipes({ tl, T, pal }: Ctx) {
  const cues = [...tl.slots.slice(1).map((sl) => tl.cues[sl.cue]), tl.cues.Recap];
  return cues.map((cue, i) => {
    const p = clamp((T - (cue - 0.42)) / 0.5, 0, 1);
    if (p <= 0 || p >= 1) return null;
    const x = tl.story ? -2100 + Easing.easeInOutCubic(p) * 4200 : -1500 + Easing.easeInOutCubic(p) * 3000;
    return (
      <div key={i} style={{ position: 'absolute', top: -200, height: tl.H + 400, left: 0, width: tl.story ? 1200 : 900, transform: `translateX(${x}px) skewX(-18deg)`, pointerEvents: 'none' }}>
        <div style={{ position: 'absolute', inset: 0, background: pal.dark }} />
        <div style={{ position: 'absolute', top: 0, bottom: 0, left: -40, width: 40, background: '#fff', opacity: 0.9 }} />
        <div style={{ position: 'absolute', top: 0, bottom: 0, right: -14, width: 14, background: '#fff', opacity: 0.5 }} />
      </div>
    );
  });
}

function Header({ tl, T, pal, texts, assets }: Ctx) {
  const { OY, cues } = tl;
  const lg = M.pop(T, 0.0, 0.45), rule = M.draw(T, 0.25, 0.35);
  const ti = M.pop(T, TITLE_HIT - 0.12, 0.4);
  const d = M.enter(T, cues.Date, 0.4), hl = M.draw(T, cues.Date + 0.25, 0.35);
  const by = T < 0.3 ? -Math.abs(Math.sin((T / 0.3) * Math.PI)) * 40 * (1 - T / 0.3) : -Math.abs(Math.sin(((T - 0.3) / 0.25) * Math.PI)) * 14 * clamp(1 - (T - 0.3) / 0.25, 0, 1);
  // Logo pour fond foncé posé tel quel ; sinon logo clair dans un disque blanc ; sinon initiales.
  const initials = texts.kicker.split(/\s+/).filter(Boolean).slice(0, 2).map((w) => w[0]).join('');
  return (
    <>
      <div style={{ position: 'absolute', left: 498, top: 18 + OY, width: 84, height: 84, borderRadius: '50%', background: assets.logoOnDark ? 'transparent' : '#fff', color: pal.red,
        display: 'flex', alignItems: 'center', justifyContent: 'center', fontFamily: PROMPT, fontWeight: 800, fontSize: 22,
        opacity: clamp(lg * 1.5, 0, 1), transform: `translateY(${by}px) rotate(${(1 - lg) * -300}deg) scale(${lg})` }}>
        {assets.logoOnDark ? <img src={assets.logoOnDark} alt="" style={{ width: 84, height: 84, objectFit: 'contain' }} />
          : assets.logo ? <img src={assets.logo} alt="" style={{ width: 62, height: 62, objectFit: 'contain' }} /> : initials}
      </div>
      <div style={{ position: 'absolute', left: 0, right: 0, top: 106 + OY, display: 'flex', justifyContent: 'center', alignItems: 'center', gap: 22 }}>
        <div style={{ width: 70 * rule, height: 2, background: '#fff' }} />
        <div style={{ display: 'flex', fontFamily: PROMPT, fontWeight: 600, fontSize: 20, color: '#fff', letterSpacing: '0.3em' }}>
          {texts.kicker.split('').map((ch, i) => {
            const a = M.enter(T, 0.22 + i * 0.012, 0.22);
            return <span key={i} style={{ opacity: a, transform: `translateY(${(1 - a) * 14}px)`, whiteSpace: 'pre' }}>{ch}</span>;
          })}
        </div>
        <div style={{ width: 70 * rule, height: 2, background: '#fff' }} />
      </div>
      <div style={{ position: 'absolute', left: 30, right: 30, top: 134 + OY, height: 100, overflow: 'hidden' }}>
        <div style={{ textAlign: 'center', fontFamily: PROMPT, fontWeight: 800, fontSize: 86, color: '#fff', letterSpacing: '-0.03em', lineHeight: 1.12, ...ELL,
          textShadow: `0 6px 24px ${pal.shadeA(0.35, 12)}`, transform: `translateY(${(1 - ti) * 100}px) scale(${1 + 0.06 * decay(T, TITLE_HIT, 10)})` }}>{texts.title}</div>
      </div>
      <div style={{ position: 'absolute', left: 0, right: 0, top: 232 + OY, textAlign: 'center', opacity: d, transform: `translateX(${(1 - d) * -140}px)` }}>
        <span style={{ fontFamily: PROMPT, fontWeight: 600, fontSize: 36, color: '#fff', whiteSpace: 'pre' }}>{texts.datePrefix}</span>
        <span style={{ position: 'relative', fontFamily: PROMPT, fontWeight: 700, fontSize: 36, color: '#fff' }}>
          {texts.dateLabel}
          <span style={{ position: 'absolute', left: 0, bottom: -4, height: 4, borderRadius: 2, width: `${hl * 100}%`, background: '#fff' }} />
        </span>
      </div>
    </>
  );
}

// Un onglet par horaire, actif tant que l'un de ses écrans est à l'affiche (la somme des deux
// fondus reste à 1 entre deux écrans du même horaire : l'onglet ne clignote pas).
function Tabs({ tl, T, pal }: Ctx) {
  const k = M.enter(T, tl.cues.Date + 0.3, 0.35);
  const times = [...new Set(tl.slots.map((sl) => sl.time))];
  const hide = M.draw(T, tl.cues.Recap - 0.3, 0.3);
  return (
    <div style={{ position: 'absolute', left: 0, right: 0, top: 319 + tl.OY, display: 'flex', justifyContent: 'center', gap: 14, opacity: k * (1 - hide), transform: `translateY(${(1 - k) * 16}px)` }}>
      {times.map((time, ti) => {
        let on = 0;
        tl.slots.forEach((sl, i) => {
          if (sl.time !== time) return;
          on += M.draw(T, tl.cues[sl.cue] - 0.15, 0.25) * (1 - (tl.slots[i + 1] ? M.draw(T, tl.cues[tl.slots[i + 1].cue] - 0.15, 0.25) : 0));
        });
        on = clamp(on, 0, 1);
        return (
          <div key={ti} style={{ fontFamily: PROMPT, fontWeight: 700, fontSize: 22, padding: '4px 22px', borderRadius: 999, border: '2px solid #fff',
            background: `rgba(255,255,255,${on})`, color: on > 0.5 ? pal.red : '#fff', transform: `scale(${1 + 0.08 * on})` }}>{time}</div>
        );
      })}
    </div>
  );
}

// Logos des partenaires déjà tirés (`drawPosterPartners`) : une rangée jusqu'à 5, deux au-delà.
function PartnerLogos({ logos, width, height, reveal }: { logos: string[]; width: number; height: number; reveal: number }) {
  const rows = logos.length > 5 ? [logos.slice(0, Math.ceil(logos.length / 2)), logos.slice(Math.ceil(logos.length / 2))] : [logos];
  const gap = 10;
  const rowH = (height - gap * (rows.length - 1)) / rows.length;
  return (
    <div style={{ width, height, display: 'flex', flexDirection: 'column', gap, clipPath: `inset(0 ${(1 - reveal) * 100}% 0 0)` }}>
      {rows.map((row, r) => (
        <div key={r} style={{ height: rowH, display: 'flex', justifyContent: 'center', gap: 24 }}>
          {row.map((src, i) => (
            <img key={i} src={src} alt="" style={{ flex: '0 1 160px', minWidth: 0, height: rowH, objectFit: 'contain' }} />
          ))}
        </div>
      ))}
    </div>
  );
}

function Partners({ tl, T, assets, pal }: Ctx) {
  if (assets.partners.length === 0) return null;
  const k = M.enter(T, tl.cues.Date + 0.4, 0.45), w = M.draw(T, tl.cues.Date + 0.55, 0.6);
  if (tl.story) // story : petit panneau blanc flottant, sans titre, au-dessus de la zone « Envoyer un message »
    return (
      <div style={{ position: 'absolute', left: 50, right: 50, bottom: PARTNERS_BOTTOM, height: PARTNERS_H, background: '#fff', borderRadius: 22, boxShadow: `0 16px 36px ${pal.shadeA(0.3)}`,
        display: 'flex', alignItems: 'center', justifyContent: 'center', opacity: clamp(k * 1.5, 0, 1), transform: `translateY(${(1 - k) * 120}px)` }}>
        <PartnerLogos logos={assets.partners} width={880} height={110} reveal={w} />
      </div>
    );
  return (
    <div style={{ position: 'absolute', left: 0, right: 0, bottom: 0, height: 150, background: '#fff', transform: `translateY(${(1 - k) * 160}px)` }}>
      <div style={{ textAlign: 'center', marginTop: 10, fontFamily: PROMPT, fontWeight: 600, fontSize: 18, letterSpacing: '0.3em', color: INK }}>NOS PARTENAIRES</div>
      <div style={{ margin: '6px auto 0', width: 720 }}>
        <PartnerLogos logos={assets.partners} width={720} height={100} reveal={w} />
      </div>
    </div>
  );
}

function RecapSide({ p, align, f, pal }: { p: AnimPlayer; align: 'left' | 'right'; f: number; pal: AnimPalette }) {
  const on = p.home ? f : 0;
  return (
    <div style={{ flex: 1, minWidth: 0, borderRadius: 12, padding: '4px 12px', textAlign: align, position: 'relative', overflow: 'hidden',
      background: p.home ? pal.redA(0.08 + 0.92 * on) : 'transparent' }}>
      <div style={{ fontFamily: PROMPT, fontWeight: 700, fontSize: 22, color: on > 0.5 ? '#fff' : INK, lineHeight: 1.15, ...ELL }}>{p.first} {p.last}</div>
      <div style={{ fontFamily: MANROPE, fontWeight: p.home ? 800 : 600, fontSize: 12, color: on > 0.5 ? '#fff' : p.home ? pal.red : '#5b5355', textTransform: 'uppercase', marginTop: 1, ...ELL }}>
        <span style={{ fontFamily: PROMPT, fontWeight: 700, fontSize: 16, color: on > 0.5 ? '#fff' : pal.red }}>{p.rank}</span>{p.rank && p.club ? '  ·  ' : ''}{p.club}
      </div>
    </div>
  );
}

function Recap({ tl, T, pal, assets }: Ctx) {
  const s = tl.cues.Recap;
  if (T < s - 0.05) return null;
  const { story, OY, homeCount } = tl;
  const rows = tl.slots.flatMap((sl) => sl.matches.map((m) => ({ m, time: sl.time })));
  const STEP = Math.min(story ? 110 : 106, ((homeCount ? 510 : 550) + (story ? 280 : 0)) / rows.length), RH = STEP - 10;
  const t = M.enter(T, s + 0.1, 0.4);
  const last = s + BEAT * (1 + (rows.length - 1) * 0.5) + 0.3;
  const cnt = M.pop(T, last + 0.1, 0.4);
  return (
    <>
      <div style={{ position: 'absolute', left: 0, right: 0, top: 318 + OY, textAlign: 'center', fontFamily: PROMPT, fontWeight: 600, fontSize: 20, letterSpacing: '0.3em', color: '#fff', opacity: t, transform: `translateY(${(1 - t) * 12}px)` }}>LE PROGRAMME</div>
      {rows.map(({ m, time }, i) => {
        const at = s + BEAT * (1 + i * 0.5);
        const k = M.pop(T, at - 0.08, 0.4);
        const f = M.draw(T, last + 0.1 + i * 0.06, 0.25); // tous les joueurs du club passent à la couleur du club, en cascade
        return (
          <div key={i} style={{ position: 'absolute', left: 50, right: 50, top: 356 + OY + i * STEP, height: RH, background: m.derby ? pal.derbyRow : '#fff', borderRadius: 18, display: 'flex', alignItems: 'center', gap: 10, padding: '0 12px', boxShadow: `0 12px 28px ${pal.shadeA(0.3)}`,
            opacity: clamp(k * 2, 0, 1), transform: `translateX(${(1 - k) * (i % 2 ? 120 : -120)}px)` }}>
            <div style={{ width: 92, flexShrink: 0, display: 'flex', justifyContent: 'center' }}>
              <div style={{ background: pal.red, color: '#fff', fontFamily: PROMPT, fontWeight: 700, fontSize: 19, borderRadius: 999, padding: '2px 14px' }}>{time}</div>
            </div>
            <RecapSide p={m.a} align="right" f={f} pal={pal} />
            <VS size={46} color={pal.red} style={{ flexShrink: 0 }} />
            <RecapSide p={m.b} align="left" f={f} pal={pal} />
          </div>
        );
      })}
      {homeCount > 0 && (
        <div style={{ position: 'absolute', left: 0, right: 0, top: 356 + OY + rows.length * STEP + 6, display: 'flex', justifyContent: 'center', opacity: clamp(cnt * 2, 0, 1), transform: `scale(${0.6 + 0.4 * cnt})` }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 12, background: '#fff', color: pal.red, borderRadius: 999, padding: assets.logo ? '4px 22px 4px 8px' : '4px 22px', fontFamily: PROMPT, fontWeight: 700, fontSize: 20, letterSpacing: '0.12em' }}>
            {assets.logo && <img src={assets.logo} alt="" style={{ width: 30, height: 30, objectFit: 'contain' }} />}
            {homeCount} {homeCount > 1 ? 'JOUEURS' : 'JOUEUR'} DU CLUB EN LICE
          </div>
        </div>
      )}
    </>
  );
}

export type SceneProps = { tl: Timeline; T: number; palette: AnimPalette; texts: AnimationTexts; assets: AnimationAssets };

export default function ProgrammeAnimationScene({ tl, T, palette: pal, texts, assets }: SceneProps) {
  const ctx: Ctx = { tl, T, pal, texts, assets };
  const { cues, total } = tl;
  const out = M.draw(T, cues.Outro, total - cues.Outro - 0.05);
  const kick = tl.impacts.reduce((a, i) => a + decay(T, i.t, 9) * (i.big ? 1.6 : 1), 0)
    + tl.slots.reduce((a, sl) => a + (sl.derby ? decay(T, cues[sl.cue] + 0.27, 8) * 1.5 : 0), 0);
  const camS = 1 + 0.03 * (T / total) + 0.03 * kick;
  const camY = Math.sin(T * 1.3) * 3;
  const flash = tl.impacts.reduce((a, i) => Math.max(a, decay(T, i.t, 14)), 0)
    + tl.slots.reduce((a, sl) => Math.max(a, sl.derby ? decay(T, cues[sl.cue] + 0.27, 10) : 0), 0);
  return (
    <div style={{ position: 'relative', width: tl.W, height: tl.H, background: pal.dark, overflow: 'hidden' }}>
      <div style={{ position: 'absolute', inset: 0, opacity: 1 - out }}>
        <Background {...ctx} />
        <div style={{ position: 'absolute', inset: 0, transform: `translateY(${camY}px) scale(${camS})`, transformOrigin: '50% 62%' }}>
          <DerbyTitle {...ctx} />
          {tl.cards.map((c) => <Card key={c.key} c={c} T={T} pal={pal} logo={assets.logo} />)}
          <Recap {...ctx} />
          <ImpactFX {...ctx} />
        </div>
        <div style={{ position: 'absolute', inset: 0, transform: `translateY(${camY * 0.4}px)` }}>
          <Header {...ctx} />
          <Tabs {...ctx} />
        </div>
        <Wipes {...ctx} />
        <Partners {...ctx} />
        <div style={{ position: 'absolute', inset: 0, background: '#fff', opacity: 0.28 * flash, pointerEvents: 'none' }} />
      </div>
    </div>
  );
}
