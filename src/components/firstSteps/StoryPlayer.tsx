import { useEffect, useEffectEvent, useLayoutEffect, useRef, useState, type CSSProperties } from 'react';
import type { AnimPalette } from '../programmeAnimation/palette';
import type { FrameAssets } from '../programmeAnimation/renderFrame';
import { renderRencontresFrame, type RencontresTexts } from '../rencontresAnimation/renderFrame';
import type { RencontresTimeline } from '../rencontresAnimation/timeline';

// W1 — aperçu animé de la story dans « Vos affiches » : la fonction de rendu de l'export
// (`renderRencontresFrame`) dessinée en temps réel dans un canvas, comme le lecteur de /medias.
// Muet (il n'y a pas de son : aucun contrôle de volume), en boucle, Pause/Lire au clavier
// (WCAG 2.2.2). `prefers-reduced-motion` : image fixe de l'écran final et bouton Lire.

/** Durée d'aperçu (visible, onglet au premier plan) qui valide l'étape. */
export const PREVIEW_SEEN_MS = 3000;

type Props = {
  tl: RencontresTimeline;
  palette: AnimPalette;
  texts: RencontresTexts;
  assets: FrameAssets | null;
  fontsReady: boolean;
  /** Encodage en cours : l'aperçu se fige sous l'anneau de progression. */
  encoding: { percent: number; remaining: number } | null;
  /** Appelé une fois, après `PREVIEW_SEEN_MS` d'aperçu affiché. */
  onSeen: () => void;
};

const reducedMotion = () => window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false;

export default function StoryPlayer({ tl, palette, texts, assets, fontsReady, encoding, onSeen }: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  // Image fixe : l'écran final (logo, « Venez nous encourager ! »), avant le fondu de sortie.
  const still = tl.end + 2.5;
  const [playing, setPlaying] = useState(() => !reducedMotion());
  const [T, setT] = useState(() => (reducedMotion() ? still : 0));
  const [size, setSize] = useState({ w: 0, h: 0 });
  const ready = !!assets && fontsReady;
  const frozen = !!encoding;
  // Une autre sélection peut raccourcir la vidéo : on reste dans sa durée.
  const at = T > tl.total ? tl.total : T;

  useEffect(() => {
    if (!playing || frozen || !ready) return;
    let raf = 0, last = performance.now();
    const tick = (now: number) => {
      setT((t) => (t + (now - last) / 1000) % tl.total);
      last = now;
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [playing, frozen, ready, tl.total]);


  useEffect(() => {
    const c = canvasRef.current;
    if (!c || typeof ResizeObserver === 'undefined') return;
    const measure = () => setSize({ w: c.clientWidth, h: c.clientHeight });
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(c);
    return () => observer.disconnect();
  }, []);

  useLayoutEffect(() => {
    const c = canvasRef.current;
    if (!c || !ready || !size.w) return;
    const dpr = window.devicePixelRatio || 1;
    const w = Math.round(size.w * dpr), h = Math.round(size.h * dpr);
    if (c.width !== w || c.height !== h) Object.assign(c, { width: w, height: h });
    const g = c.getContext('2d');
    if (!g) return;
    g.setTransform(w / tl.W, 0, 0, h / tl.H, 0, 0);
    renderRencontresFrame(g, tl, at, palette, texts, assets!);
  }, [at, tl, palette, texts, assets, ready, size]);

  // Étape validée après 3 s d'aperçu affiché, onglet visible (pause comprise : l'image est vue).
  const seen = useEffectEvent(onSeen);
  useEffect(() => {
    if (!ready) return;
    let shown = 0;
    const id = setInterval(() => {
      if (document.visibilityState !== 'hidden') shown += 250;
      if (shown >= PREVIEW_SEEN_MS) { clearInterval(id); seen(); }
    }, 250);
    return () => clearInterval(id);
  }, [ready]);

  return (
    <div className="fs-story" style={{ background: palette.dark }}>
      <canvas ref={canvasRef} className="fs-story-canvas" role="img" aria-label="Aperçu animé de la story des rencontres, sans son" />
      {!ready && <span className="fs-story-wait"><span className="fs-spin" aria-hidden="true" /></span>}
      <span className="fs-story-badge"><span aria-hidden="true" className="fs-story-live" />Aperçu</span>
      {!encoding && (
        <button type="button" className="fs-story-play" aria-pressed={!playing} disabled={!ready} onClick={() => setPlaying((p) => !p)}>
          <span aria-hidden="true">{playing ? '❚❚' : '▶'}</span>{playing ? 'Pause' : 'Lire'}
        </button>
      )}
      <span aria-hidden="true" className="fs-story-time"><span style={{ width: `${(at / tl.total) * 100}%` }} /></span>
      {encoding && (
        <div className="fs-story-encoding" role="status">
          <span className="fs-ring" style={{ '--p': encoding.percent } as CSSProperties}><span>{encoding.percent} %</span></span>
          <strong>On prépare votre vidéo…</strong>
          <span>Encore {encoding.remaining} seconde{encoding.remaining > 1 ? 's' : ''} environ. Restez sur cette page.</span>
        </div>
      )}
    </div>
  );
}
