// Vitrine — dérivation de l'accent depuis `brand.color` (web_site_brief.md §4).
//
// PÉRIMÈTRE : ce module ne pilote que les tokens de MARQUE (les trois d'origine et leurs trois
// variantes « lisibles »). Les autres (`--bg`, `--card`,
// `--text`, `--radius`, `--shadow`…) sont des constantes de la direction « conviviale » et
// vivent dans `index.css` — un club ne les configure pas.
//
// `src/lib/theme.ts` (BO + PWA) n'est pas réutilisable tel quel : son JEU DE TOKENS est celui
// des apps internes, la vitrine a le sien. La conversion hex → HSL et le calcul de contraste
// WCAG (`luminance`, `ratio`) en reprennent la forme — recopiés plutôt qu'extraits dans
// `shared/` : quelques lignes, et les extraire obligerait à modifier le BO et la PWA.
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

/** Arrondi au dixième — la précision de `css()`, pour que le contraste soit mesuré sur ce qui
 *  est réellement écrit dans la feuille de style. */
const round = ({ h, s, l }: Hsl): Hsl => ({
  h: Math.round(h * 10) / 10,
  s: Math.round(s * 10) / 10,
  l: Math.round(l * 10) / 10,
});

function hslToRgb({ h, s, l }: Hsl): [number, number, number] {
  const sat = s / 100;
  const light = l / 100;
  const k = (n: number) => (n + h / 30) % 12;
  const a = sat * Math.min(light, 1 - light);
  const f = (n: number) => light - a * Math.max(-1, Math.min(k(n) - 3, 9 - k(n), 1));
  return [f(0), f(8), f(4)];
}

/** Luminance relative WCAG (même formule que `src/lib/theme.ts`). */
function luminance(color: Hsl): number {
  const linear = (v: number) => (v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4);
  const [r, g, b] = hslToRgb(color).map(linear);
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

const ratio = (a: Hsl, b: Hsl) => {
  const [la, lb] = [luminance(a), luminance(b)];
  return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05);
};

/** WCAG AA, texte normal. */
const AA = 4.5;
const WHITE: Hsl = { h: 0, s: 0, l: 100 };
/** Miroirs de `--text` et `--bg` d'`index.css` — constantes de la direction, pas du club. */
const INK = round(hexToHsl('#2a201f')!);
const BG = round(hexToHsl('#f7f2ec')!);

/** Assombrit `color` point de luminosité par point jusqu'à `ratio(…, against) ≥ 4,5`. Le pas
 *  le plus fin possible : la couleur obtenue reste la plus proche de celle du club. */
function darkenUntil(color: Hsl, against: Hsl): Hsl {
  let current = color;
  while (current.l > 0 && ratio(current, against) < AA) {
    current = round({ ...current, l: Math.max(0, current.l - 1) });
  }
  return current;
}

const css = ({ h, s, l }: Hsl, alpha?: number) =>
  alpha === undefined
    ? `hsl(${h.toFixed(1)} ${s.toFixed(1)}% ${l.toFixed(1)}%)`
    : `hsl(${h.toFixed(1)} ${s.toFixed(1)}% ${l.toFixed(1)}% / ${alpha})`;

/**
 * Les tokens de marque. `color` vide ou illisible → le fallback du brief.
 *
 * `--brand` : la couleur du club telle quelle — usages DÉCORATIFS sans texte (filets, halos,
 * icônes, bordures).
 * `--brand-fill` : fond des éléments qui PORTENT du texte (boutons, pastilles, bloc école).
 * `--brand` si le blanc ou l'encre y atteint 4,5:1, sinon `--brand` assombri jusqu'à ce que
 * le blanc passe — une couleur moyenne (ni le blanc ni l'encre ne passent) reste reconnaissable.
 * `--brand-foreground` : texte posé sur `--brand-fill` — blanc ou encre `--text`, le meilleur
 * des deux (même règle que `readableOn` du BO).
 * `--brand-text` : la couleur du club écrite COMME TEXTE sur `--bg` / `--card`, assombrie
 * jusqu'à 4,5:1 sur `--bg` (le plus foncé des deux fonds : `--card` passe alors aussi).
 * `--brand-dark` : hover de `--brand-fill`, −16 % de luminosité, entendu comme une baisse
 * RELATIVE (`l × 0.84`) et non comme 16 points de moins. Sur une couleur déjà sombre,
 * retrancher 16 points l'écraserait en noir ; le hover doit rester la même couleur, en plus dense.
 * `--brand-soft` : la même teinte à 10 % d'opacité — fonds doux et badges.
 *
 * Sur le rouge du CAC, le blanc passe (4,67:1) : `--brand-fill` = `--brand`, le rendu des
 * boutons ne change pas.
 */
export function brandTokens(color: string | undefined): Record<string, string> {
  const brand = round((color && hexToHsl(color)) || hexToHsl(BRAND_FALLBACK)!);
  const best = (background: Hsl) => (ratio(background, WHITE) >= ratio(background, INK) ? WHITE : INK);
  const fill = ratio(brand, best(brand)) >= AA ? brand : darkenUntil(brand, WHITE);
  return {
    '--brand': css(brand),
    '--brand-fill': css(fill),
    '--brand-foreground': css(best(fill)),
    '--brand-text': css(darkenUntil(brand, BG)),
    '--brand-dark': css({ ...fill, l: fill.l * 0.84 }),
    '--brand-soft': css(brand, 0.1),
  };
}

/** Pose les tokens de marque sur `<html>`. */
export function applyBrandTokens(root: HTMLElement, color: string | undefined): void {
  for (const [name, value] of Object.entries(brandTokens(color))) {
    root.style.setProperty(name, value);
  }
}
