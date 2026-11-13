// SaaS S7 — fond de l'affiche des rencontres « Aux couleurs du club », dessiné dans le navigateur.
//
// `TeamMatchImagePreview` n'écrit ni titre ni logo : c'est le fond qui porte l'en-tête. Gabarit
// 1414 × 2000 (celui de `clubConfigWrite.ts` › `team_match_backgrounds`) :
//   - 0 → 245 px : en-tête (logo ou initiales, « Les rencontres du week-end », nom du club) ;
//   - 245 → 1720 px, marges de 60 px : les cartes des rencontres — rien de lisible ici ;
//   - à partir de 1760 px : les partenaires posés par l'app — rien de lisible non plus.
// Le reste est un décor sans texte (dégradé et lignes d'un court), pour que le fond ne soit pas
// un aplat uni (règle PR7, commentaire de `postersSchema`).
//
// Couleurs : les tokens partagés de `shared/` (`brandTokens`), mêmes règles de contraste que la
// vitrine et les premiers pas : en-tête sur `--brand-fill`, texte en `--brand-foreground`.
//
// Réutilisable hors des premiers pas (S8 : « Créer un fond aux couleurs du club »).
import '@fontsource-variable/manrope';
import { brandTokens } from '../../shared/brandTokens.mjs';

export const CLUB_BACKGROUND_NAME = 'Aux couleurs du club';
export const CLUB_BACKGROUND_TITLE = 'Les rencontres du week-end';

export const BACKGROUND_W = 1414;
export const BACKGROUND_H = 2000;
/** Fin de l'en-tête = début des cartes (`TeamMatchImagePreview`, CONTENT_TOP). */
export const BACKGROUND_HEADER_H = 245;
const PAD_X = 60;

const FONT = "'Manrope Variable', Manrope, system-ui, sans-serif";
const LOGO_SIZE = 150;
const TITLE_X = PAD_X + LOGO_SIZE + 36;
const TEXT_RIGHT = BACKGROUND_W - PAD_X;

export type ClubBackgroundBrand = { name: string; color?: string | null; logo?: string | null };

type Hsl = { h: number; s: number; l: number };

function parseHsl(css: string): Hsl {
  const [h, s, l] = (css.match(/[\d.]+/g) ?? ['0', '0', '0']).map(Number);
  return { h, s, l };
}
const hsl = ({ h, s, l }: Hsl, alpha?: number) =>
  alpha === undefined ? `hsl(${h} ${s}% ${l}%)` : `hsl(${h} ${s}% ${l}% / ${alpha})`;

/** Couleurs du fond, dérivées de `brand.color` par les tokens partagés. */
export function clubBackgroundPalette(color?: string | null) {
  const tokens = brandTokens(color ?? undefined);
  const fill = parseHsl(tokens['--brand-fill']);
  return {
    /** En-tête et haut du fond : porte le texte. */
    fill: tokens['--brand-fill'],
    /** Texte de l'en-tête : blanc ou encre, ≥ 4,5:1 sur `fill`. */
    ink: tokens['--brand-foreground'],
    /** Bas du dégradé : la même teinte, plus dense (sans texte). */
    deep: hsl({ ...fill, l: Math.round(fill.l * 0.78 * 10) / 10 }),
  };
}

const STOP_WORDS = new Set(['de', 'du', 'des', 'la', 'le', 'les', 'l', 'd', 'et', 'en', 'à', 'au', 'aux']);

/** « TC Saint-Aubin » → « TSA » : premières lettres des trois premiers mots porteurs. */
export function clubInitials(name: string): string {
  const words = name
    .split(/[\s\-'’]+/)
    .filter((w) => w && !STOP_WORDS.has(w.toLowerCase()));
  return words.slice(0, 3).map((w) => w.charAt(0).toUpperCase()).join('') || '?';
}

/** Ce que le dessin attend d'un contexte 2D : rien de plus, pour être testable sans navigateur. */
export type BackgroundContext = Pick<
  CanvasRenderingContext2D,
  | 'fillStyle' | 'strokeStyle' | 'lineWidth' | 'font' | 'textAlign' | 'textBaseline' | 'globalAlpha'
  | 'fillRect' | 'strokeRect' | 'fillText' | 'measureText' | 'beginPath' | 'moveTo' | 'lineTo'
  | 'arc' | 'fill' | 'stroke' | 'save' | 'restore' | 'clip' | 'drawImage' | 'createLinearGradient'
>;

type LogoImage = CanvasImageSource & { width: number; height: number };

/** Plus grande taille de police (pas de 2 px) qui tient dans `maxWidth`. */
function fitFont(ctx: BackgroundContext, text: string, weight: number, size: number, min: number, maxWidth: number): number {
  let current = size;
  ctx.font = `${weight} ${current}px ${FONT}`;
  while (current > min && ctx.measureText(text).width > maxWidth) {
    current -= 2;
    ctx.font = `${weight} ${current}px ${FONT}`;
  }
  return current;
}

/** Coupe avec « … » ce qui dépasse encore à la taille minimale. */
function ellipsize(ctx: BackgroundContext, text: string, maxWidth: number): string {
  if (ctx.measureText(text).width <= maxWidth) return text;
  let cut = text;
  while (cut.length > 1 && ctx.measureText(`${cut}…`).width > maxWidth) cut = cut.slice(0, -1);
  return `${cut.trimEnd()}…`;
}

/**
 * Lignes d'un court de double vu de dessus, centré sous les cartes : un décor discret qui ne se
 * lit pas comme un contenu (pas de texte, opacité faible).
 */
function drawCourt(ctx: BackgroundContext, ink: string) {
  const h = 1640;
  const w = Math.round(h * (10.97 / 23.77));
  const x = Math.round((BACKGROUND_W - w) / 2);
  const y = 290;
  const alley = (1.37 / 10.97) * w;
  const service = (6.4 / 23.77) * h;
  const net = y + h / 2;
  ctx.save();
  ctx.strokeStyle = ink;
  ctx.globalAlpha = 0.09;
  ctx.lineWidth = 8;
  ctx.strokeRect(x, y, w, h);
  ctx.beginPath();
  // Couloirs de simple
  ctx.moveTo(x + alley, y); ctx.lineTo(x + alley, y + h);
  ctx.moveTo(x + w - alley, y); ctx.lineTo(x + w - alley, y + h);
  // Lignes de service et ligne médiane
  ctx.moveTo(x + alley, net - service); ctx.lineTo(x + w - alley, net - service);
  ctx.moveTo(x + alley, net + service); ctx.lineTo(x + w - alley, net + service);
  ctx.moveTo(x + w / 2, net - service); ctx.lineTo(x + w / 2, net + service);
  // Marques centrales des fonds de court
  ctx.moveTo(x + w / 2, y); ctx.lineTo(x + w / 2, y + 24);
  ctx.moveTo(x + w / 2, y + h); ctx.lineTo(x + w / 2, y + h - 24);
  ctx.stroke();
  // Filet, débordant du court comme les poteaux
  ctx.lineWidth = 12;
  ctx.beginPath();
  ctx.moveTo(x - 40, net); ctx.lineTo(x + w + 40, net);
  ctx.stroke();
  ctx.restore();
}

function drawBadge(ctx: BackgroundContext, ink: string, logo: LogoImage | null, initials: string) {
  const r = LOGO_SIZE / 2;
  const cx = PAD_X + r;
  const cy = BACKGROUND_HEADER_H / 2;
  ctx.save();
  if (logo && logo.width > 0 && logo.height > 0) {
    // Pastille blanche : un logo foncé ou transparent reste lisible quelle que soit la couleur.
    ctx.fillStyle = '#ffffff';
    ctx.beginPath();
    ctx.arc(cx, cy, r, 0, Math.PI * 2);
    ctx.fill();
    ctx.clip();
    const box = LOGO_SIZE * 0.72;
    const scale = Math.min(box / logo.width, box / logo.height);
    const w = logo.width * scale;
    const h = logo.height * scale;
    ctx.drawImage(logo, cx - w / 2, cy - h / 2, w, h);
  } else {
    ctx.strokeStyle = ink;
    ctx.lineWidth = 6;
    ctx.beginPath();
    ctx.arc(cx, cy, r - 3, 0, Math.PI * 2);
    ctx.stroke();
    ctx.fillStyle = ink;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    fitFont(ctx, initials, 800, 56, 30, LOGO_SIZE - 36);
    ctx.fillText(initials, cx, cy + 2);
  }
  ctx.restore();
}

/** Dessine le fond complet. `logo` : image déjà chargée, ou null pour les initiales. */
export function drawClubPosterBackground(
  ctx: BackgroundContext,
  { name, color, logo }: { name: string; color?: string | null; logo: LogoImage | null },
) {
  const palette = clubBackgroundPalette(color);

  // 1. En-tête uni (le texte y est mesuré contre `fill`), puis dégradé vers une teinte plus dense.
  ctx.fillStyle = palette.fill;
  ctx.fillRect(0, 0, BACKGROUND_W, BACKGROUND_H);
  const gradient = ctx.createLinearGradient(0, BACKGROUND_HEADER_H, 0, BACKGROUND_H);
  gradient.addColorStop(0, palette.fill);
  gradient.addColorStop(1, palette.deep);
  ctx.fillStyle = gradient;
  ctx.fillRect(0, BACKGROUND_HEADER_H, BACKGROUND_W, BACKGROUND_H - BACKGROUND_HEADER_H);

  // 2. Décor sans texte sous les cartes.
  drawCourt(ctx, palette.ink);

  // 3. En-tête : pastille, titre, nom du club, filet.
  drawBadge(ctx, palette.ink, logo, clubInitials(name));
  ctx.save();
  ctx.fillStyle = palette.ink;
  ctx.textAlign = 'left';
  ctx.textBaseline = 'alphabetic';
  const maxWidth = TEXT_RIGHT - TITLE_X;
  fitFont(ctx, CLUB_BACKGROUND_TITLE, 800, 74, 48, maxWidth);
  ctx.fillText(CLUB_BACKGROUND_TITLE, TITLE_X, 120);
  fitFont(ctx, name, 700, 40, 28, maxWidth);
  ctx.fillText(ellipsize(ctx, name, maxWidth), TITLE_X, 178);
  ctx.restore();

  ctx.save();
  ctx.strokeStyle = palette.ink;
  ctx.globalAlpha = 0.3;
  ctx.lineWidth = 3;
  ctx.beginPath();
  ctx.moveTo(PAD_X, 226);
  ctx.lineTo(TEXT_RIGHT, 226);
  ctx.stroke();
  ctx.restore();
}

function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    // Logo servi par le Storage (autre origine) : sans CORS, le canvas serait « sali » et
    // `toBlob` refuserait l'export. Un logo illisible ne bloque rien : on prend les initiales.
    img.crossOrigin = 'anonymous';
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error(`Logo illisible : ${src}`));
    img.src = src;
  });
}

/** Le fond en PNG 1414 × 2000, prêt à téléverser. */
export async function renderClubPosterBackground(brand: ClubBackgroundBrand): Promise<Blob> {
  const canvas = document.createElement('canvas');
  canvas.width = BACKGROUND_W;
  canvas.height = BACKGROUND_H;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('Dessin du fond impossible dans ce navigateur.');
  // La police doit être chargée avant `fillText`, sinon le canvas écrit dans la police de repli.
  await Promise.all([
    document.fonts?.load(`800 74px ${FONT}`),
    document.fonts?.load(`700 40px ${FONT}`),
  ]).catch(() => undefined);
  const logo = brand.logo ? await loadImage(brand.logo).catch(() => null) : null;
  drawClubPosterBackground(ctx, { name: brand.name, color: brand.color, logo });
  return new Promise((resolve, reject) =>
    canvas.toBlob((blob) => (blob ? resolve(blob) : reject(new Error('Export du fond impossible.'))), 'image/png'),
  );
}
