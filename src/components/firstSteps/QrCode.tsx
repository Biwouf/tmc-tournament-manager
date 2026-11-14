import { useMemo } from 'react';
import { encode } from 'uqr';

/** QR code réel, en SVG : modules sombres sur fond blanc quelle que soit la couleur du club, pour
 *  rester lisible par un téléphone. La marge blanche fait partie du code (`border`). Partagé par
 *  l'écran final des premiers pas (S5) et la checklist du tableau de bord (S8). */
export function QrCode({ value, className = 'fs-qr' }: { value: string; className?: string }) {
  const { path, size } = useMemo(() => {
    const qr = encode(value, { ecc: 'M', border: 3 });
    let d = '';
    qr.data.forEach((row, y) => row.forEach((dark, x) => { if (dark) d += `M${x} ${y}h1v1h-1z`; }));
    return { path: d, size: qr.size };
  }, [value]);
  return (
    <svg role="img" aria-label="QR code vers l'app" viewBox={`0 0 ${size} ${size}`} shapeRendering="crispEdges" className={className}>
      <rect width={size} height={size} fill="#fff" />
      <path d={path} fill="#2a201f" />
    </svg>
  );
}
