// Polices de l'animation, embarquées (et non lues sur Google Fonts) : le rendu Canvas tourne
// aussi dans un worker, qui n'a pas accès aux feuilles de style de la page. On ne garde que les
// sous-ensembles latin et latin-ext (~140 Ko), chargés en `FontFace` dans le document (lecteur)
// et dans le worker d'export.
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

/** Charge les polices dans `set` : `document.fonts` (lecteur) ou `self.fonts` du worker d'export. */
export async function addAnimationFonts(set: FontFaceSet): Promise<void> {
  await Promise.all(
    FACES.map(async (f) => {
      const data = await (await fetch(f.url)).arrayBuffer();
      const face = new FontFace(f.family, data, { weight: String(f.weight), unicodeRange: f.range });
      set.add(await face.load());
    }),
  );
}

let pending: Promise<void> | null = null;

/** Charge les polices dans le document, une seule fois. */
export function loadAnimationFonts(): Promise<void> {
  pending ??= addAnimationFonts(document.fonts);
  pending.catch(() => {
    pending = null;
  });
  return pending;
}
