// Multi-tenant — thème du club : les couleurs saisies dans le BO (`brand.color`,
// `brand.color_secondary`, `brand.color_accent`) deviennent les tokens CSS du BO et de la PWA.
//
// Duplication assumée avec `src/lib/theme.ts` (même patron que `ClubContext.tsx` et
// `liveScoreRules.ts`) : garder les deux copies synchronisées si la logique change.
//
// PÉRIMÈTRE — ce module ne touche QUE les tokens de marque. Restent littéraux dans les
// feuilles de style, et c'est volontaire :
//   - `--destructive` et les classes `red-*` de Tailwind : ce sont des couleurs de SENS
//     (erreur de saisie, bouton Supprimer). Un club en vert ne doit pas voir « Supprimer »
//     virer au vert.
//   - les états de score `win` / `loss` / `draw` / `wo` et l'en-tête de finale : mêmes
//     raisons. Seuls `todo` / `next` / `na`, qui sont des teintes de la marque, suivent le
//     thème — via `@theme inline`, pas via ce module.

export type ClubColors = {
  primary?: string;
  secondary?: string;
  accent?: string;
};

type Hsl = { h: number; s: number; l: number };

const WHITE: Hsl = { h: 0, s: 0, l: 100 };

/**
 * `#rgb` ou `#rrggbb` → HSL. `null` si la chaîne n'est pas un hex — même forme que le
 * validateur `color` de `clubConfigWrite.ts`, qui est le seul à pouvoir refuser une saisie.
 * Ici on ne refuse pas, on ignore : une config illisible laisse la feuille de style intacte
 * plutôt que de rendre l'app monochrome.
 */
export function hexToHsl(hex: string): Hsl | null {
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

function hslToRgb({ h, s, l }: Hsl): [number, number, number] {
  const sat = s / 100;
  const lum = l / 100;
  const c = (1 - Math.abs(2 * lum - 1)) * sat;
  const sector = (((h % 360) + 360) % 360) / 60;
  const x = c * (1 - Math.abs((sector % 2) - 1));
  const [r, g, b] =
    sector < 1 ? [c, x, 0]
    : sector < 2 ? [x, c, 0]
    : sector < 3 ? [0, c, x]
    : sector < 4 ? [0, x, c]
    : sector < 5 ? [x, 0, c]
    : [c, 0, x];
  const m = lum - c / 2;
  return [r + m, g + m, b + m];
}

/** Luminance relative WCAG — sert à choisir la couleur de texte, pas à noter le contraste. */
function luminance(color: Hsl): number {
  const linear = (v: number) => (v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4);
  const [r, g, b] = hslToRgb(color).map(linear);
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

const ratio = (a: number, b: number) => (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);

/**
 * Blanc ou l'encre du thème, selon celui des deux qui se lit le mieux sur `background`.
 *
 * Sans ce calcul, un club en jaune pâle hériterait du `--primary-foreground: 0 0% 100%` écrit
 * en dur aujourd'hui, soit du blanc sur du jaune. Sur le rouge du CAC, le blanc gagne — la
 * valeur produite est donc celle d'aujourd'hui.
 */
function readableOn(background: Hsl, ink: Hsl): Hsl {
  const bg = luminance(background);
  return ratio(bg, luminance(WHITE)) >= ratio(bg, luminance(ink)) ? WHITE : ink;
}

/**
 * Les neutres du thème ne sont PAS gris : ils portent une pointe de la couleur principale —
 * c'est ce que fait la teinte 355 répétée dans les deux `index.css`. On ne remplace donc que
 * la TEINTE, en gardant la saturation et la luminosité d'origine de chaque token.
 *
 * La saturation est plafonnée par celle de la couleur principale : sans ce plafond, un club
 * qui choisit un gris (`#333333`, saturation nulle, teinte arbitrairement 0) récolterait des
 * bordures rosées.
 */
const NEUTRALS: Record<string, [saturation: number, lightness: number]> = {
  '--foreground': [20, 15],
  '--card-foreground': [20, 15],
  '--popover-foreground': [20, 15],
  '--muted': [70, 94],
  '--muted-foreground': [20, 45],
  '--border': [50, 88],
  '--input': [50, 88],
  // Bas du dégradé de `body` (BO uniquement) — la PWA reçoit le token sans l'utiliser.
  '--background-tint': [60, 97],
};

/** Tous les tokens que ce module pilote, pour pouvoir aussi les RETIRER (config vidée). */
export const THEMED_TOKENS = [
  '--primary',
  '--primary-foreground',
  '--secondary',
  '--secondary-foreground',
  '--accent',
  '--accent-foreground',
  '--ring',
  ...Object.keys(NEUTRALS),
];

/** Format attendu par `hsl(var(--token))` dans les feuilles de style : `H S% L%`. */
const format = ({ h, s, l }: Hsl) => `${Math.round(h)} ${Math.round(s)}% ${Math.round(l)}%`;

const tint = (hue: number, saturation: number, lightness: number, cap: number): Hsl => ({
  h: hue,
  s: Math.min(saturation, cap),
  l: lightness,
});

/**
 * Les trois couleurs saisies → la table complète des tokens. Objet VIDE si la couleur
 * principale est absente ou illisible : sans elle, il n'y a pas de teinte d'où dériver le
 * reste, et la feuille de style garde ses valeurs.
 *
 * Les couleurs secondaire et d'accent sont facultatives : laissées vides, elles sont dérivées
 * de la principale aux mêmes saturation/luminosité que les tokens actuels. Avec
 * `#e51828` seul, la sortie reproduit donc `index.css` à l'identique.
 */
export function clubThemeTokens(colors: ClubColors): Record<string, string> {
  const primary = colors.primary ? hexToHsl(colors.primary) : null;
  if (!primary) return {};

  const cap = primary.s;
  const secondary = (colors.secondary && hexToHsl(colors.secondary)) || tint(primary.h, 80, 73, cap);
  const accent = (colors.accent && hexToHsl(colors.accent)) || tint(primary.h, 75, 88, cap);
  const ink = tint(primary.h, 20, 15, cap);

  const tokens: Record<string, string> = {
    '--primary': format(primary),
    '--primary-foreground': format(readableOn(primary, ink)),
    '--secondary': format(secondary),
    '--secondary-foreground': format(readableOn(secondary, ink)),
    '--accent': format(accent),
    // Encre de l'accent : dérivée de l'ACCENT et non de la principale, l'accent étant un fond
    // pâle sur lequel une version foncée de lui-même est ce qui se lit le mieux.
    '--accent-foreground': format(tint(accent.h, 60, 35, accent.s)),
    '--ring': format(primary),
  };
  for (const [name, [saturation, lightness]] of Object.entries(NEUTRALS)) {
    tokens[name] = format(tint(primary.h, saturation, lightness, cap));
  }
  return tokens;
}

/** Pose (ou retire) les tokens du club sur `<html>`. */
export function applyClubTheme(root: HTMLElement, colors: ClubColors): void {
  const tokens = clubThemeTokens(colors);
  for (const name of THEMED_TOKENS) {
    const value = tokens[name];
    if (value) root.style.setProperty(name, value);
    else root.style.removeProperty(name);
  }
}
