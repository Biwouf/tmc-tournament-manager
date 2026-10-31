// Polices de l'animation, embarquées (et non lues sur Google Fonts) : `html-to-image` ne sait pas
// lire une feuille de style d'une autre origine, et l'export sortirait alors en police de repli
// sans la moindre erreur (constaté au prototype du 16/10/2026). On ne garde que les
// sous-ensembles latin et latin-ext, inlinés en data URL (~140 Ko) : la même chaîne sert à
// enregistrer les polices dans le document (aperçu) et au `fontEmbedCSS` de l'export.
import prompt600 from '@fontsource/prompt/files/prompt-latin-600-normal.woff2?url';
import prompt600x from '@fontsource/prompt/files/prompt-latin-ext-600-normal.woff2?url';
import prompt700 from '@fontsource/prompt/files/prompt-latin-700-normal.woff2?url';
import prompt700x from '@fontsource/prompt/files/prompt-latin-ext-700-normal.woff2?url';
import prompt800 from '@fontsource/prompt/files/prompt-latin-800-normal.woff2?url';
import prompt800x from '@fontsource/prompt/files/prompt-latin-ext-800-normal.woff2?url';
import manrope600 from '@fontsource/manrope/files/manrope-latin-600-normal.woff2?url';
import manrope600x from '@fontsource/manrope/files/manrope-latin-ext-600-normal.woff2?url';
import manrope800 from '@fontsource/manrope/files/manrope-latin-800-normal.woff2?url';
import manrope800x from '@fontsource/manrope/files/manrope-latin-ext-800-normal.woff2?url';

// Noms propres à l'animation : le BO charge déjà « Prompt » depuis Google Fonts, et deux
// déclarations du même nom se mélangeraient.
export const PROMPT = '"Anim Prompt", sans-serif';
export const MANROPE = '"Anim Manrope", sans-serif';

const LATIN = 'U+0000-00FF,U+0131,U+0152-0153,U+02BB-02BC,U+02C6,U+02DA,U+02DC,U+0304,U+0308,U+0329,U+2000-206F,U+20AC,U+2122,U+2191,U+2193,U+2212,U+2215,U+FEFF,U+FFFD';
const LATIN_EXT = 'U+0100-02BA,U+02BD-02C5,U+02C7-02CC,U+02CE-02D7,U+02DD-02FF,U+0304,U+0308,U+0329,U+1D00-1DBF,U+1E00-1E9F,U+1EF2-1EFF,U+2020,U+20A0-20AB,U+20AD-20C0,U+2113,U+2C60-2C7F,U+A720-A7FF';

const FACES: { family: string; weight: number; url: string; range: string }[] = [
  { family: 'Anim Prompt', weight: 600, url: prompt600, range: LATIN },
  { family: 'Anim Prompt', weight: 600, url: prompt600x, range: LATIN_EXT },
  { family: 'Anim Prompt', weight: 700, url: prompt700, range: LATIN },
  { family: 'Anim Prompt', weight: 700, url: prompt700x, range: LATIN_EXT },
  { family: 'Anim Prompt', weight: 800, url: prompt800, range: LATIN },
  { family: 'Anim Prompt', weight: 800, url: prompt800x, range: LATIN_EXT },
  { family: 'Anim Manrope', weight: 600, url: manrope600, range: LATIN },
  { family: 'Anim Manrope', weight: 600, url: manrope600x, range: LATIN_EXT },
  { family: 'Anim Manrope', weight: 800, url: manrope800, range: LATIN },
  { family: 'Anim Manrope', weight: 800, url: manrope800x, range: LATIN_EXT },
];

export function blobToDataUrl(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result as string);
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(blob);
  });
}

let pending: Promise<string> | null = null;

/** Charge les polices une seule fois et renvoie le CSS `@font-face` à passer en `fontEmbedCSS`. */
export function loadAnimationFonts(): Promise<string> {
  pending ??= (async () => {
    const rules = await Promise.all(
      FACES.map(async (f) => {
        const data = await blobToDataUrl(await (await fetch(f.url)).blob());
        const face = new FontFace(f.family, `url(${data}) format('woff2')`, { weight: String(f.weight), unicodeRange: f.range });
        document.fonts.add(await face.load());
        return `@font-face{font-family:'${f.family}';font-style:normal;font-weight:${f.weight};src:url(${data}) format('woff2');unicode-range:${f.range};}`;
      }),
    );
    return rules.join('\n');
  })();
  pending.catch(() => {
    pending = null;
  });
  return pending;
}
