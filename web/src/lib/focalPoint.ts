// ⚠️ COPIE de `pwa/src/utils/focalPoint.ts`, synchronisée MANUELLEMENT — 3ᵉ exemplaire du geste,
// même patron que `web/src/lib/clubConfig.ts`. Le corps est identique au caractère près, et doit
// le rester : seul le TYPE diffère, la vitrine n'ayant pas de `types.ts`. Elle lit le point
// d'intérêt d'une IMAGE DE CONFIG (`ClubConfigFocalPoint`), la PWA celui d'une ACTU
// (`ActuFocalPoint`) — deux `{ x, y }` en pourcentages, et c'est précisément pour ça que la
// fonction se recopie telle quelle plutôt que de se paramétrer.
import type { CSSProperties } from 'react';
import type { ClubConfigFocalPoint } from './clubConfig';

export function focalPointStyle(
  fp: ClubConfigFocalPoint | null | undefined
): CSSProperties {
  if (!fp) return { objectPosition: '50% 50%' };
  return { objectPosition: `${fp.x}% ${fp.y}%` };
}
