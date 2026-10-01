import { useState, type PointerEvent } from 'react';
import { photoCrop } from './resultPoster';

interface Props {
  photo: string;
  crop: { x: number; y: number; zoom: number };
  frameHeight: number;
  onChange: (crop: Props['crop']) => void;
}

/** Select the focal point on the unobscured source image, with the exported crop outlined. */
export default function PhotoFocusPicker({ photo, crop, frameHeight, onChange }: Props) {
  const [dimensions, setDimensions] = useState<{ width: number; height: number } | null>(null);
  const [dragging, setDragging] = useState(false);
  const frame = dimensions ? photoCrop(dimensions.width, dimensions.height, 1080, frameHeight, crop.x, crop.y, crop.zoom) : null;
  function point(event: PointerEvent<HTMLDivElement>) {
    const box = event.currentTarget.getBoundingClientRect();
    onChange({ ...crop, x: Math.max(0, Math.min(100, (event.clientX - box.left) / box.width * 100)), y: Math.max(0, Math.min(100, (event.clientY - box.top) / box.height * 100)) });
  }
  return <div className="space-y-2">
    <p id="photo-focus-help" className="text-sm">Cliquez ou faites glisser le point sur la photo pour choisir le focus. Le cadre indique la zone visible. Augmentez le zoom pour déplacer davantage le cadrage.</p>
    <div className="relative mx-auto max-w-md overflow-hidden rounded-lg border" aria-describedby="photo-focus-help" style={{ touchAction: 'none', cursor: dragging ? 'grabbing' : 'crosshair' }}
      onPointerDown={event => { if (event.button !== 0) return; event.currentTarget.setPointerCapture(event.pointerId); setDragging(true); point(event); }}
      onPointerMove={event => { if (dragging) point(event); }}
      onPointerUp={event => { if (dragging) point(event); setDragging(false); }}
      onPointerCancel={() => setDragging(false)} onLostPointerCapture={() => setDragging(false)}>
      <img src={photo} alt="Photo source — utilisez aussi les réglages de focus horizontal et vertical" draggable={false} className="block w-full select-none" onLoad={event => setDimensions({ width: event.currentTarget.naturalWidth, height: event.currentTarget.naturalHeight })} />
      {frame && dimensions && <div aria-hidden style={{ position: 'absolute', pointerEvents: 'none', left: `${frame.sx / dimensions.width * 100}%`, top: `${frame.sy / dimensions.height * 100}%`, width: `${frame.sw / dimensions.width * 100}%`, height: `${frame.sh / dimensions.height * 100}%`, border: '2px solid white', boxShadow: '0 0 0 999px rgba(0,0,0,0.3)' }} />}
      <div aria-hidden style={{ position: 'absolute', pointerEvents: 'none', left: `${crop.x}%`, top: `${crop.y}%`, transform: 'translate(-50%, -50%)', width: 26, height: 26, borderRadius: '50%', border: '3px solid white', background: 'var(--color-primary)', boxShadow: '0 1px 6px rgba(0,0,0,0.5)' }} />
    </div>
    <button type="button" className="rounded-lg border px-3 py-2 text-sm" onClick={() => onChange({ x: 50, y: 50, zoom: 1 })}>Recentrer la photo</button>
  </div>;
}
