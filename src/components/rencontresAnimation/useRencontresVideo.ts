// Moteur de la story « Prochaines rencontres » (MP4 1080 × 1920) : polices, logos, détection de
// l'encodeur, export avec progression et annulation. Partagé par la section de /medias
// (`RencontresAnimationSection`, avec lecteur et publication Facebook) et par l'étape « Vos
// affiches » des premiers pas (SaaS S7b, téléchargement seul) : une seule implémentation.
import { useEffect, useMemo, useRef, useState } from 'react';
import type { TeamMatch } from '../../types';
import { toBitmap } from '../programmeAnimation/bitmaps';
import { ExportCancelled, exportMp4, pickEncoderConfig } from '../programmeAnimation/exportMp4';
import { loadAnimationFonts } from '../programmeAnimation/fonts';
import { animationPalette } from '../programmeAnimation/palette';
import type { FrameAssets } from '../programmeAnimation/renderFrame';
import { buildRencontresStoryParts, buildRencontresTimeline, type RencontresTimeline } from './timeline';

export type RencontresVideoInput = {
  /** Rencontres de l'affiche, par date croissante. */
  matches: TeamMatch[];
  /** Logos déjà tirés pour l'affiche ; vide si les partenaires y sont masqués. */
  partnerLogos: string[];
  color: string;
  logo: string;
  logoInverse: string;
  clubName: string;
  /** Nom posé dans le bloc du club sur chaque carte (la ville du club). */
  homeName: string;
};

const TITLE = 'Prochaines rencontres';

export function useRencontresVideo({ matches, partnerLogos, color, logo, logoInverse, clubName, homeName }: RencontresVideoInput) {
  const [assets, setAssets] = useState<FrameAssets | null>(null);
  const [fontsReady, setFontsReady] = useState(false);
  const [encoderOk, setEncoderOk] = useState<boolean | null>(null);
  const [exporting, setExporting] = useState(false);
  const [progress, setProgress] = useState<{ frame: number; frames: number } | null>(null);
  const [exportError, setExportError] = useState('');
  const cancelRef = useRef(false);

  const tl = useMemo(() => buildRencontresTimeline(matches), [matches]);
  // Story Facebook : 30 s au plus par story, au-delà la vidéo part en plusieurs parties.
  const storyParts = useMemo(() => buildRencontresStoryParts(matches), [matches]);
  const palette = useMemo(() => animationPalette(color), [color]);
  const texts = useMemo(
    () => ({ kicker: clubName.toLocaleUpperCase('fr-FR'), title: TITLE, homeName: homeName.toLocaleUpperCase('fr-FR') }),
    [clubName, homeName],
  );

  useEffect(() => {
    // Polices en échec : on dessine quand même, en police de repli.
    loadAnimationFonts().finally(() => setFontsReady(true));
  }, []);

  const partnersKey = partnerLogos.join('\n');
  useEffect(() => {
    let alive = true;
    (async () => {
      const [l, li, ...partners] = await Promise.all([toBitmap(logo), toBitmap(logoInverse), ...partnersKey.split('\n').filter(Boolean).map(toBitmap)]);
      if (alive) setAssets({ logo: l, logoOnDark: li, partners: partners.filter((p): p is ImageBitmap => !!p) });
    })();
    return () => {
      alive = false;
    };
  }, [logo, logoInverse, partnersKey]);

  useEffect(() => {
    let alive = true;
    pickEncoderConfig(tl.W, tl.H).then((c) => alive && setEncoderOk(!!c));
    return () => {
      alive = false;
    };
  }, [tl.W, tl.H]);

  /** Encode une timeline (la vidéo entière ou une partie de story) ; progression effacée à la fin. */
  function encode(timeline: RencontresTimeline, kickerSuffix = ''): Promise<Blob> {
    setProgress({ frame: 0, frames: Math.round(timeline.total * 30) });
    return exportMp4(
      { kind: 'rencontres', tl: timeline, color: palette.red, texts: { ...texts, kicker: texts.kicker + kickerSuffix }, assets: assets! },
      (frame, frames) => setProgress({ frame, frames }),
      () => cancelRef.current,
    ).finally(() => setProgress(null));
  }

  /** Encadre un export : état « en cours », annulation remise à zéro. */
  async function run(task: () => Promise<void>) {
    cancelRef.current = false;
    setExporting(true);
    try {
      await task();
    } finally {
      setExporting(false);
    }
  }

  /** Génère la vidéo entière et la télécharge sous `<fileName>.mp4`. */
  async function download(fileName: string) {
    if (!assets || !fontsReady) return;
    setExportError('');
    await run(async () => {
      try {
        const blob = await encode(tl);
        const url = URL.createObjectURL(blob);
        const link = document.createElement('a');
        link.href = url;
        link.download = `${fileName}.mp4`;
        link.click();
        setTimeout(() => URL.revokeObjectURL(url), 60_000);
      } catch (e) {
        if (!(e instanceof ExportCancelled)) setExportError(e instanceof Error ? e.message : 'La génération de la vidéo a échoué.');
      }
    });
  }

  return {
    tl, storyParts, palette, texts, assets, fontsReady, encoderOk,
    exporting, progress, exportError, setExportError,
    canExport: !!assets && fontsReady && encoderOk === true && !exporting,
    encode, run, download,
    cancel: () => { cancelRef.current = true; },
  };
}
