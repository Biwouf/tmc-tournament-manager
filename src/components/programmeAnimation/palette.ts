// Couleurs de l'animation, dérivées de `brand.color` par la même méthode que l'affiche
// (`clubTint` de lib/theme) : avec #c8102e, elles redonnent les teintes codées en dur dans la skill.
import { clubTint, hexToHsl } from '../../lib/theme';

/** Repli si `brand.color` est vide ou illisible : le rouge historique de l'animation. */
const FALLBACK_COLOR = '#c8102e';

export type AnimPalette = {
  red: string;
  dark: string;
  /** Centre lumineux du dégradé de fond. */
  glow: string;
  /** Voile assombrissant du mode derby. */
  derbyShade: string;
  derbyRow: string;
  redA: (a: number) => string;
  /** Halo clair des pulsations et impacts. */
  lightA: (a: number) => string;
  /** Teinte très sombre des ombres et du vignettage. */
  shadeA: (a: number, lightness?: number) => string;
};

export function animationPalette(color: string): AnimPalette {
  const red = hexToHsl(color) ? color : FALLBACK_COLOR;
  const base = hexToHsl(red)!;
  return {
    red,
    dark: clubTint(red, 86, 30)!,
    glow: clubTint(red, undefined, Math.min(base.l + 7, 60))!,
    derbyShade: clubTint(red, 100, 11)!,
    derbyRow: clubTint(red, 100, 98)!,
    redA: (a) => clubTint(red, undefined, undefined, a)!,
    lightA: (a) => clubTint(red, 100, 68, a)!,
    shadeA: (a, l = 10) => clubTint(red, 100, l, a)!,
  };
}

