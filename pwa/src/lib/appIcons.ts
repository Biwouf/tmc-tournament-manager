// Icônes d'installation tirées du logo du club (PR5 du brief UX, 14/11/2026).
// Un logo de club est rarement carré et n'a pas de marge : posé tel quel, Android le
// rogne en icône « maskable » et iOS l'étire ou le pose sur fond noir. On dessine donc,
// côté navigateur, des PNG carrés sur fond blanc : le logo entier, centré, avec la marge
// voulue par chaque usage. Rien n'est envoyé ni stocké : les images vivent en data URL
// dans le manifest et le lien apple-touch-icon.
//
// W3 (onboarding, brief SAAS_11 §13.4) : quand le club utilise le logo retouché à l'inscription
// (`brand.logo` = sa variante `clean-1024`), les icônes viennent de `brand.logo_variants`, déjà
// détourées et calibrées (badge rond à 0,78 dans la zone sûre maskable) : rien n'est dessiné.
// Sinon (original choisi, logo changé depuis, club sans variantes comme le CAC) : le dessin ci-dessous.

export type LogoVariants = Record<'clean-1024' | 'avatar-256' | 'maskable-512' | 'maskable-192' | 'any-512' | 'apple-180' | 'email-128', string>;
export type ManifestIcon = { src: string; sizes: string; type: string; purpose: 'any' | 'maskable' };

/** Les variantes ne valent que pour le logo dont elles sont tirées. */
export function variantsFor(logo: string | undefined, variants: LogoVariants | undefined): LogoVariants | null {
  return logo && variants && variants['clean-1024'] === logo ? variants : null;
}

/** Entrées du manifest et icône iOS, tirées des variantes du logo retouché. */
export function iconsFromVariants(variants: LogoVariants): { icons: ManifestIcon[]; apple180: string } {
  return {
    icons: [
      { src: variants['any-512'], sizes: '512x512', type: 'image/png', purpose: 'any' },
      { src: variants['maskable-192'], sizes: '192x192', type: 'image/png', purpose: 'maskable' },
      { src: variants['maskable-512'], sizes: '512x512', type: 'image/png', purpose: 'maskable' },
    ],
    apple180: variants['apple-180'],
  };
}

export interface AppIcons {
  /** 192 et 512 px, `purpose: any` : logo sur 84 % de la largeur. */
  any192: string;
  any512: string;
  /** 512 px, `purpose: maskable` : logo dans la zone sûre (cercle de 80 %). */
  maskable512: string;
  /** 180 px, écran d'accueil iOS (fond opaque obligatoire). */
  apple180: string;
}

// Un carré inscrit dans le cercle de 80 % de la zone sûre a un côté de 0,8 / √2 ≈ 0,566.
const ANY_SCALE = 0.84;
const MASKABLE_SCALE = 0.56;
const APPLE_SCALE = 0.8;

function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    // Sans CORS, le canvas serait « souillé » et toDataURL lèverait une SecurityError.
    img.crossOrigin = 'anonymous';
    img.decoding = 'async';
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error(`Logo illisible : ${src}`));
    img.src = src;
  });
}

function draw(img: HTMLImageElement, size: number, scale: number): string {
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('Canvas indisponible');
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, size, size);
  // Un SVG sans dimensions intrinsèques se lit en 0×0 dans certains navigateurs : carré par défaut.
  const w = img.naturalWidth || size;
  const h = img.naturalHeight || size;
  const box = size * scale;
  const ratio = Math.min(box / w, box / h);
  const dw = w * ratio;
  const dh = h * ratio;
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(img, (size - dw) / 2, (size - dh) / 2, dw, dh);
  return canvas.toDataURL('image/png');
}

/** `null` si le logo ne peut pas être lu ou rasterisé (CORS, format) : garder l'URL du logo. */
export async function buildAppIcons(logoUrl: string): Promise<AppIcons | null> {
  try {
    const img = await loadImage(logoUrl);
    return {
      any192: draw(img, 192, ANY_SCALE),
      any512: draw(img, 512, ANY_SCALE),
      maskable512: draw(img, 512, MASKABLE_SCALE),
      apple180: draw(img, 180, APPLE_SCALE),
    };
  } catch (err) {
    console.warn('[pwa] icônes d’installation non générées', err);
    return null;
  }
}
