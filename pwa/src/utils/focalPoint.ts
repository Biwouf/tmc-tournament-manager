import type { CSSProperties } from 'react';
import type { ActuFocalPoint } from '../types';

export function focalPointStyle(
  fp: ActuFocalPoint | null | undefined
): CSSProperties {
  if (!fp) return { objectPosition: '50% 50%' };
  return { objectPosition: `${fp.x}% ${fp.y}%` };
}
