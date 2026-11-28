import { useId, useRef, useState, type KeyboardEvent, type PointerEvent } from 'react';
import { createPortal } from 'react-dom';
import { ACCOUNT_COPY as T } from '../../../../shared/accountCopy.mjs';
import { MAX_ZOOM, clampCrop, cropSide, initialCrop, type Crop, type OpenedPhoto } from '../../lib/avatar';
import { useModalDialog } from '../../hooks/useModalDialog';

const ZOOM_STEP = 0.25;

/** La photo placée dans un carré (le cercle, ou un aperçu) : tout en pourcentages, rien à mesurer. */
function Framed({ photo, crop }: { photo: OpenedPhoto; crop: Crop }) {
  const side = cropSide(photo, crop);
  const pct = (value: number) => `${(value / side) * 100}%`;
  return <img src={photo.url} alt="" draggable={false}
    className="pointer-events-none absolute max-w-none select-none"
    style={{ left: pct(side / 2 - crop.x), top: pct(side / 2 - crop.y), width: pct(photo.width), height: pct(photo.height) }} />;
}

function Preview({ photo, crop, size, label }: { photo: OpenedPhoto; crop: Crop; size: number; label: string }) {
  return (
    <figure className="flex flex-col items-center gap-1.5">
      <span className="relative block overflow-hidden rounded-full bg-white/10" style={{ width: size, height: size }}><Framed photo={photo} crop={crop} /></span>
      <figcaption className="text-[13px] text-white/80">{label}</figcaption>
    </figure>
  );
}

/**
 * Recadrage rond plein écran (`compte-04`) : glisser, pincer, boutons −/+ et curseur, flèches du
 * clavier (WCAG 2.5.7) ; aperçu aux tailles réelles. `onUse` exporte puis envoie ; message en retour si échec.
 */
export default function PhotoCrop({ photo, onUse, onCancel }: {
  photo: OpenedPhoto;
  onUse: (crop: Crop) => Promise<string | null>;
  onCancel: () => void;
}) {
  const ref = useModalDialog();
  const titleId = useId();
  const helpId = useId();
  const circle = useRef<HTMLDivElement>(null);
  const [crop, setCrop] = useState(() => initialCrop(photo));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const pointers = useRef(new Map<number, { x: number; y: number }>());

  const update = (next: (old: Crop) => Crop) => setCrop(old => clampCrop(photo, next(old)));
  const zoomBy = (delta: number) => update(old => ({ ...old, zoom: old.zoom + delta }));
  /** Pixels d'écran → pixels de la photo. */
  const scale = () => cropSide(photo, crop) / (circle.current?.clientWidth || 1);

  function spread() {
    const [a, b] = [...pointers.current.values()];
    return b ? { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2, distance: Math.hypot(a.x - b.x, a.y - b.y) } : { ...a, distance: 0 };
  }
  function down(event: PointerEvent) {
    event.currentTarget.setPointerCapture?.(event.pointerId);
    pointers.current.set(event.pointerId, { x: event.clientX, y: event.clientY });
  }
  function move(event: PointerEvent) {
    if (!pointers.current.has(event.pointerId)) return;
    const before = spread();
    pointers.current.set(event.pointerId, { x: event.clientX, y: event.clientY });
    const after = spread();
    const ratio = before.distance && after.distance ? after.distance / before.distance : 1;
    const factor = scale();
    update(old => ({ x: old.x - (after.x - before.x) * factor, y: old.y - (after.y - before.y) * factor, zoom: old.zoom * ratio }));
  }
  const up = (event: PointerEvent) => { pointers.current.delete(event.pointerId); };

  function key(event: KeyboardEvent) {
    const step = cropSide(photo, crop) * (event.shiftKey ? 0.2 : 0.05);
    const moves: Record<string, [number, number]> = { ArrowLeft: [-step, 0], ArrowRight: [step, 0], ArrowUp: [0, -step], ArrowDown: [0, step] };
    if (moves[event.key]) {
      const [dx, dy] = moves[event.key];
      update(old => ({ ...old, x: old.x + dx, y: old.y + dy }));
    } else if (event.key === '+' || event.key === '=') zoomBy(ZOOM_STEP);
    else if (event.key === '-' || event.key === '−') zoomBy(-ZOOM_STEP);
    else return;
    event.preventDefault();
  }

  async function use() {
    if (busy) return;
    setBusy(true);
    setError('');
    const failure = await onUse(crop);
    // Succès : la fenêtre est déjà fermée par le parent.
    if (failure) { setError(failure); setBusy(false); }
  }

  const round = 'flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-white/15 text-2xl font-bold active:bg-white/25';
  return createPortal(
    <dialog ref={ref} aria-labelledby={titleId}
      onCancel={event => { event.preventDefault(); if (!busy) onCancel(); }}
      className="fixed inset-0 m-0 h-full max-h-none w-full max-w-none flex-col open:flex bg-[#111] p-0 text-white backdrop:bg-black"
      style={{ paddingTop: 'env(safe-area-inset-top)', paddingBottom: 'env(safe-area-inset-bottom)' }}>
      <header className="flex min-h-14 items-center justify-between px-2">
        <button type="button" disabled={busy} onClick={onCancel} className="min-h-11 px-3 text-[17px] font-semibold disabled:opacity-60">{T.cancel}</button>
        <h2 id={titleId} className="text-[17px] font-bold">{T.cropTitle}</h2>
        <button type="button" disabled={busy} onClick={() => void use()} className="min-h-11 px-3 text-[17px] font-bold text-amber-300 disabled:opacity-60">{T.cropUse}</button>
      </header>

      <div tabIndex={0} role="application" aria-label={T.cropArea} aria-describedby={helpId}
        onPointerDown={down} onPointerMove={move} onPointerUp={up} onPointerCancel={up} onKeyDown={key}
        className="relative flex min-h-0 flex-1 touch-none items-center justify-center overflow-hidden bg-[#222] outline-none focus-visible:ring-4 focus-visible:ring-inset focus-visible:ring-amber-300">
        <div ref={circle} className="relative aspect-square" style={{ width: 'min(78vw, 46dvh, 360px)' }}>
          <Framed photo={photo} crop={crop} />
          {/* Assombrit tout ce qui sort du cercle ; grille des tiers dedans. */}
          <div aria-hidden="true" className="pointer-events-none absolute inset-0 overflow-hidden rounded-full border-2 border-white shadow-[0_0_0_100vmax_rgba(0,0,0,0.55)]">
            <div className="absolute inset-y-0 left-1/3 right-1/3 border-x border-white/30" />
            <div className="absolute inset-x-0 bottom-1/3 top-1/3 border-y border-white/30" />
          </div>
        </div>
      </div>

      <div className="mx-auto w-full max-w-md space-y-4 px-5 pb-5 pt-4">
        <p id={helpId} className="text-center text-[15px] text-white/80">{T.cropHelp}</p>
        <div className="flex items-center gap-3">
          <button type="button" aria-label={T.cropZoomOut} disabled={crop.zoom <= 1} onClick={() => zoomBy(-ZOOM_STEP)} className={`${round} disabled:opacity-40`}>−</button>
          <input type="range" min={1} max={MAX_ZOOM} step={0.05} value={crop.zoom} aria-label={T.cropZoom}
            aria-valuetext={`${Math.round(crop.zoom * 100)} %`}
            onChange={event => update(old => ({ ...old, zoom: Number(event.target.value) }))}
            className="h-11 min-w-0 flex-1 accent-white" />
          <button type="button" aria-label={T.cropZoomIn} disabled={crop.zoom >= MAX_ZOOM} onClick={() => zoomBy(ZOOM_STEP)} className={`${round} disabled:opacity-40`}>+</button>
        </div>
        <div aria-hidden="true" className="flex items-end justify-center gap-6">
          <Preview photo={photo} crop={crop} size={88} label={T.cropPreviewProfile} />
          <Preview photo={photo} crop={crop} size={36} label={T.cropPreviewCompo} />
          <Preview photo={photo} crop={crop} size={26} label={T.cropPreviewList} />
        </div>
        {error && <p role="alert" className="rounded-lg bg-red-950 px-3 py-2 text-sm text-red-100">{error}</p>}
      </div>
    </dialog>,
    document.body,
  );
}
