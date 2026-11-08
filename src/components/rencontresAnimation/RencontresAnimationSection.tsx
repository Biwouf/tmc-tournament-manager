// Section « Animation vidéo » du type « Matches par équipe » de /medias : lecteur de la story
// « Prochaines rencontres » et export MP4 dans le navigateur, sur le modèle de la vidéo du
// programme de tournoi (`ProgrammeAnimationSection`, même worker d'export). La vidéo reprend
// EXACTEMENT l'affiche générée (rencontres, partenaires tirés) : le panneau ne la rend
// disponible qu'une fois l'affiche générée avec la sélection courante (`ready`).
import { useEffect, useEffectEvent, useLayoutEffect, useMemo, useRef, useState } from 'react';
import type { TeamMatch } from '../../types';
import { toBitmap } from '../programmeAnimation/bitmaps';
import { ExportCancelled, exportMp4, pickEncoderConfig } from '../programmeAnimation/exportMp4';
import { loadAnimationFonts } from '../programmeAnimation/fonts';
import { animationPalette } from '../programmeAnimation/palette';
import type { FrameAssets } from '../programmeAnimation/renderFrame';
import { renderRencontresFrame } from './renderFrame';
import { buildRencontresTimeline } from './timeline';

type Props = {
  ready: boolean;
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
  /** Nom du fichier téléchargé, sans extension. */
  fileName: string;
  /** Incrémenté par le panneau pour lancer l'export dès que la section est prête
   *  (case « Générer aussi la vidéo » du bouton de l'affiche). */
  exportRequest: number;
};

const TITLE = 'Prochaines rencontres';
const PREVIEW_H = 560;

export default function RencontresAnimationSection({
  ready, matches, partnerLogos, color, logo, logoInverse, clubName, homeName, fileName, exportRequest,
}: Props) {
  const [T, setT] = useState(0);
  const [playing, setPlaying] = useState(() => !window.matchMedia('(prefers-reduced-motion: reduce)').matches);
  const [assets, setAssets] = useState<FrameAssets | null>(null);
  const [fontsReady, setFontsReady] = useState(false);
  const [encoderOk, setEncoderOk] = useState<boolean | null>(null);
  const [exporting, setExporting] = useState(false);
  const [progress, setProgress] = useState<{ frame: number; frames: number } | null>(null);
  const [exportError, setExportError] = useState('');
  const cancelRef = useRef(false);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const rootRef = useRef<HTMLDivElement>(null);
  /** Dernière demande d'export traitée : celle présente au montage ne déclenche rien. */
  const handledRequest = useRef(exportRequest);

  const tl = useMemo(() => buildRencontresTimeline(matches), [matches]);
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

  // Lecteur : `T` avance en temps réel et boucle ; en pause pendant un export.
  useEffect(() => {
    if (!playing || exporting) return;
    let raf = 0, last = performance.now();
    const tick = (now: number) => {
      setT((t) => (t + (now - last) / 1000) % tl.total);
      last = now;
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [playing, exporting, tl.total]);

  // Une nouvelle sélection peut raccourcir la vidéo : on ne laisse pas le curseur au-delà.
  useEffect(() => setT((t) => (t > tl.total ? 0 : t)), [tl.total]);

  // Lecteur : la même fonction de rendu que l'export, dans un canvas à la résolution de l'écran.
  const previewW = Math.round((tl.W * PREVIEW_H) / tl.H);
  useLayoutEffect(() => {
    const c = canvasRef.current;
    if (!c || !assets || !fontsReady) return;
    const dpr = window.devicePixelRatio || 1;
    const w = Math.round(previewW * dpr), h = Math.round(PREVIEW_H * dpr);
    if (c.width !== w || c.height !== h) Object.assign(c, { width: w, height: h });
    const g = c.getContext('2d')!;
    g.setTransform(w / tl.W, 0, 0, h / tl.H, 0, 0);
    renderRencontresFrame(g, tl, T, palette, texts, assets);
  }, [T, tl, palette, texts, assets, fontsReady, previewW, ready]);

  async function handleExport() {
    if (!assets || !fontsReady) return;
    setExportError('');
    cancelRef.current = false;
    setProgress({ frame: 0, frames: Math.round(tl.total * 30) });
    setExporting(true);
    try {
      const blob = await exportMp4({ kind: 'rencontres', tl, color: palette.red, texts, assets }, (frame, frames) => setProgress({ frame, frames }), () => cancelRef.current);
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = `${fileName}.mp4`;
      link.click();
      setTimeout(() => URL.revokeObjectURL(url), 60_000);
    } catch (e) {
      if (!(e instanceof ExportCancelled)) setExportError(e instanceof Error ? e.message : 'La génération de la vidéo a échoué.');
    } finally {
      setExporting(false);
      setProgress(null);
    }
  }

  // Export demandé par le panneau : on attend l'affiche, les polices, les images et la détection de
  // l'encodeur, puis on le lance une fois (ou le message « navigateur non compatible » s'affiche).
  const settled = ready && !!assets && fontsReady && encoderOk !== null && !exporting;
  const runRequestedExport = useEffectEvent(() => {
    handledRequest.current = exportRequest;
    if (!encoderOk) return;
    rootRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    void handleExport();
  });
  useEffect(() => {
    if (settled && exportRequest !== handledRequest.current) runRequestedExport();
  }, [settled, exportRequest]);

  if (!ready) {
    return (
      <div className="rounded-xl border border-border bg-card p-5 space-y-2">
        <h2 className="text-lg font-semibold">Animation vidéo</h2>
        <p className="text-sm text-muted-foreground">
          Générez d’abord l’affiche : la story reprend exactement ses rencontres et ses partenaires.
          Si vous modifiez la sélection, il faut régénérer l’affiche.
        </p>
      </div>
    );
  }

  const canExport = !!assets && fontsReady && encoderOk === true && !exporting;

  return (
    <div ref={rootRef} className="rounded-xl border border-border bg-card p-5 space-y-4">
      <div>
        <h2 className="text-lg font-semibold">Animation vidéo</h2>
        <p className="text-sm text-muted-foreground">Story 1080 × 1920 : une date par jour, 3 rencontres au plus par écran, récap si elles en occupent plusieurs.</p>
      </div>

      <div className="flex flex-col items-start gap-3">
        <canvas ref={canvasRef} className="rounded-lg shadow-xl" style={{ width: previewW, height: PREVIEW_H, background: palette.dark }}
          role="img" aria-label="Aperçu de la story des rencontres" />
        <div className="flex w-full max-w-xl items-center gap-3 text-sm">
          <button type="button" onClick={() => setPlaying((p) => !p)} disabled={exporting}
            className="rounded-lg border border-border px-3 py-1.5 font-medium disabled:opacity-40">
            {playing ? 'Pause' : 'Lecture'}
          </button>
          <input type="range" aria-label="Position dans l’animation" min={0} max={tl.total} step={0.01} value={T} disabled={exporting}
            onChange={(e) => { setPlaying(false); setT(+e.target.value); }} className="min-w-0 flex-1" />
          <span className="w-24 text-right tabular-nums text-muted-foreground">{T.toFixed(1)} / {tl.total.toFixed(1)} s</span>
        </div>
      </div>

      <div className="space-y-2">
        <div className="flex flex-wrap items-center gap-3">
          <button type="button" onClick={handleExport} disabled={!canExport}
            className="rounded-lg bg-primary px-5 py-2 text-sm font-semibold text-primary-foreground transition hover:opacity-90 disabled:opacity-40">
            {exporting ? 'Génération de la vidéo…' : 'Télécharger la vidéo (MP4)'}
          </button>
          {exporting && (
            <button type="button" onClick={() => { cancelRef.current = true; }} className="text-sm underline">Annuler</button>
          )}
        </div>
        {progress && (
          <div className="max-w-xl space-y-1">
            <progress className="w-full" value={progress.frame} max={progress.frames} />
            <p className="text-xs text-muted-foreground">
              Image {progress.frame} / {progress.frames}. Vous pouvez changer d’onglet, la génération continue ; ne fermez pas cette page.
            </p>
          </div>
        )}
        {!exporting && encoderOk === false && (
          <p className="text-sm text-destructive">Ce navigateur ne sait pas générer de vidéo. Utilisez une version récente de Chrome, Edge ou Safari.</p>
        )}
        {!exporting && encoderOk && (
          <p className="text-xs text-muted-foreground">La vidéo est générée dans votre navigateur : comptez de quelques secondes à une minute selon l’ordinateur.</p>
        )}
        {exportError && <p className="text-sm text-destructive">{exportError}</p>}
      </div>
    </div>
  );
}
