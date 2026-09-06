// Vitrine — dérivation de l'accent depuis `brand.color` (web_site_brief.md §4).
//
// PÉRIMÈTRE : ce module ne pilote que les TROIS tokens de marque. Les autres (`--bg`, `--card`,
// `--text`, `--radius`, `--shadow`…) sont des constantes de la direction « conviviale » et
// vivent dans `index.css` — un club ne les configure pas.
//
// `src/lib/theme.ts` (BO + PWA) n'est pas réutilisable tel quel : son JEU DE TOKENS est celui
// des apps internes, la vitrine a le sien. Seule la conversion hex → HSL en reprend la forme.
//
// La vitrine n'utilise QUE `brand.color`. `color_secondary` et `color_accent` existent au
// contrat mais servent au thème du BO et de la PWA : aucun usage n'est inventé ici.

/** Seule couleur en dur tolérée — elle vient du brief §4, pas d'un club. */
export const BRAND_FALLBACK = '#e51828';

type Hsl = { h: number; s: number; l: number };

/** `#rgb` ou `#rrggbb` → HSL. `null` si ce n'est pas un hex : on ignore, on ne refuse pas. */
function hexToHsl(hex: string): Hsl | null {
  const match = /^#([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(hex.trim());
  if (!match) return null;
  const digits = match[1].length === 3 ? match[1].replace(/./g, (c) => c + c) : match[1];
  const r = parseInt(digits.slice(0, 2), 16) / 255;
  const g = parseInt(digits.slice(2, 4), 16) / 255;
  const b = parseInt(digits.slice(4, 6), 16) / 255;

  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const l = (max + min) / 2;
  const delta = max - min;
  if (delta === 0) return { h: 0, s: 0, l: l * 100 };

  const h =
    max === r ? (g - b) / delta + (g < b ? 6 : 0)
    : max === g ? (b - r) / delta + 2
    : (r - g) / delta + 4;

  return { h: h * 60, s: (delta / (1 - Math.abs(2 * l - 1))) * 100, l: l * 100 };
}

const css = ({ h, s, l }: Hsl, alpha?: number) =>
  alpha === undefined
    ? `hsl(${h.toFixed(1)} ${s.toFixed(1)}% ${l.toFixed(1)}%)`
    : `hsl(${h.toFixed(1)} ${s.toFixed(1)}% ${l.toFixed(1)}% / ${alpha})`;

/**
 * Les trois tokens de marque. `color` vide ou illisible → le fallback du brief.
 *
 * `--brand-dark` : −16 % de luminosité, entendu comme une baisse RELATIVE (`l × 0.84`) et non
 * comme 16 points de moins. Sur une couleur déjà sombre, retrancher 16 points l'écraserait en
 * noir ; le hover doit rester la même couleur, en plus dense.
 * `--brand-soft` : la même teinte à 10 % d'opacité — fonds doux et badges.
 */
export function brandTokens(color: string | undefined): Record<string, string> {
  const brand = (color && hexToHsl(color)) || hexToHsl(BRAND_FALLBACK)!;
  return {
    '--brand': css(brand),
    '--brand-dark': css({ ...brand, l: brand.l * 0.84 }),
    '--brand-soft': css(brand, 0.1),
  };
}

/** Pose les tokens de marque sur `<html>`. */
export function applyBrandTokens(root: HTMLElement, color: string | undefined): void {
  for (const [name, value] of Object.entries(brandTokens(color))) {
    root.style.setProperty(name, value);
  }
}
