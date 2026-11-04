// Section « Animation vidéo » de /programmation-image : lecteur de l'animation du programme du
// jour (story ou carré) et export MP4 dans le navigateur. La vidéo reprend EXACTEMENT les
// réglages de l'affiche générée (matchs, club mis en valeur, partenaires tirés) : la page ne la
// rend disponible qu'une fois l'affiche téléchargée avec les réglages courants (`ready`).
import { useEffect, useEffectEvent, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { loadAnimationFonts } from './fonts';
import { ExportCancelled, exportMp4, pickEncoderConfig } from './exportMp4';
import { animationPalette } from './palette';
import { renderFrame, type FrameAssets } from './renderFrame';
import { MAX_RECAP_ROWS, buildTimeline, formatDateLabel, type AnimationFormat, type ProgrammeMatch } from './timeline';

type Props = {
  ready: boolean;
  /** Matchs affichés sur l'affiche, dans son ordre (WO exclus). */
  matches: ProgrammeMatch[];
  date: string;
  highlightedClub: string | null;
  /** Logos déjà tirés pour l'affiche ; vide si les partenaires y sont masqués. */
  partnerLogos: string[];
  color: string;
  logo: string;
  logoInverse: string;
  clubName: string;
  clubSlug: string;
  defaultTitle: string;
  /** Incrémenté par la page pour lancer l'export dès que la section est prête
   *  (case « Générer aussi la vidéo » du bouton de l'affiche). */
  exportRequest: number;
};

const FORMATS: { value: AnimationFormat; label: string }[] = [
  { value: 'story', label: 'Story (1080 × 1920)' },
  { value: 'carre', label: 'Carré (1080 × 1080)' },
];
const PREVIEW_H = 560;

// Images décodées une fois en ImageBitmap, transférables au worker d'export. Elles passent par un
// <img> et un canvas : un worker (et `createImageBitmap(blob)`) ne sait pas décoder un SVG. Côté
// le plus long ramené à 512 px au plus (un SVG y est rastérisé) : le plus grand logo de la vidéo
// fait ~160 px.
const BITMAP_MAX = 512;
async function toBitmap(url: string): Promise<ImageBitmap | null> {
  if (!url) return null;
  let src = '';
  try {
    const res = await fetch(url, { mode: 'cors' });
    if (!res.ok) return null;
    const blob = await res.blob();
    src = URL.createObjectURL(blob);
    const img = new Image();
    img.src = src;
    await img.decode();
    const nw = img.naturalWidth || BITMAP_MAX, nh = img.naturalHeight || BITMAP_MAX;
    const s = blob.type.includes('svg') ? BITMAP_MAX / Math.max(nw, nh) : Math.min(1, BITMAP_MAX / Math.max(nw, nh));
    const c = Object.assign(document.createElement('canvas'), { width: Math.max(1, Math.round(nw * s)), height: Math.max(1, Math.round(nh * s)) });
    const g = c.getContext('2d')!;
    g.imageSmoothingQuality = 'high';
    g.drawImage(img, 0, 0, c.width, c.height);
    return await createImageBitmap(c);
  } catch {
    return null;
  } finally {
    if (src) URL.revokeObjectURL(src);
  }
}

export default function ProgrammeAnimationSection({
  ready, matches, date, highlightedClub, partnerLogos, color, logo, logoInverse, clubName, clubSlug, defaultTitle, exportRequest,
}: Props) {
  const [format, setFormat] = useState<AnimationFormat>('story');
  // Titre prérempli par l'événement choisi sur la page, tant que l'admin ne l'a pas modifié.
  const [editedTitle, setTitle] = useState<string | null>(null);
  const title = editedTitle ?? defaultTitle;
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

  const tl = useMemo(() => buildTimeline(matches, highlightedClub, format), [matches, highlightedClub, format]);
  const palette = useMemo(() => animationPalette(color), [color]);
  const texts = useMemo(
    () => ({ title: title.trim(), kicker: clubName.toUpperCase(), datePrefix: 'Programme du ', dateLabel: date ? formatDateLabel(date) : '' }),
    [title, clubName, date],
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

  // Lecteur : la même `renderFrame` que l'export, dans un canvas à la résolution de l'écran.
  const previewW = Math.round((tl.W * PREVIEW_H) / tl.H);
  useLayoutEffect(() => {
    const c = canvasRef.current;
    if (!c || !assets || !fontsReady) return;
    const dpr = window.devicePixelRatio || 1;
    const w = Math.round(previewW * dpr), h = Math.round(PREVIEW_H * dpr);
    if (c.width !== w || c.height !== h) Object.assign(c, { width: w, height: h });
    const g = c.getContext('2d')!;
    g.setTransform(w / tl.W, 0, 0, h / tl.H, 0, 0);
    renderFrame(g, tl, T, palette, texts, assets);
  }, [T, tl, palette, texts, assets, fontsReady, previewW]);

  async function handleExport() {
    if (!assets || !fontsReady) return;
    setExportError('');
    cancelRef.current = false;
    setProgress({ frame: 0, frames: Math.round(tl.total * 30) });
    setExporting(true);
    try {
      const blob = await exportMp4({ tl, color: palette.red, texts, assets }, (frame, frames) => setProgress({ frame, frames }), () => cancelRef.current);
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = `programme-${clubSlug}-${date}-${format}.mp4`;
      link.click();
      setTimeout(() => URL.revokeObjectURL(url), 60_000);
    } catch (e) {
      if (!(e instanceof ExportCancelled)) setExportError(e instanceof Error ? e.message : 'La génération de la vidéo a échoué.');
    } finally {
      setExporting(false);
      setProgress(null);
    }
  }

  // Export demandé par la page : on attend que l'affiche, les polices, les images et la détection
  // de l'encodeur soient prêtes, puis on le lance une fois (ou on explique pourquoi on ne peut pas).
  const settled = ready && !!assets && fontsReady && encoderOk !== null && !exporting;
  const runRequestedExport = useEffectEvent(() => {
    handledRequest.current = exportRequest;
    if (!encoderOk) return; // le message « navigateur non compatible » est déjà affiché
    if (!title.trim()) {
      setExportError('Ajoutez un titre, puis cliquez sur « Télécharger la vidéo ».');
      return;
    }
    rootRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    void handleExport();
  });
  useEffect(() => {
    if (settled && exportRequest !== handledRequest.current) runRequestedExport();
  }, [settled, exportRequest]);

  if (!ready) {
    return (
      <div className="rounded-xl border border-border bg-card p-6 space-y-2">
        <h2 className="text-lg font-semibold">Animation vidéo</h2>
        <p className="text-sm text-muted-foreground">
          Téléchargez d’abord l’affiche : la vidéo reprend exactement ses réglages (matchs, club mis en valeur, partenaires).
          Si vous modifiez un réglage, il faut régénérer l’affiche.
        </p>
      </div>
    );
  }

  const tooManyRows = tl.nRows > MAX_RECAP_ROWS[format];
  const canExport = !!assets && fontsReady && encoderOk === true && !!title.trim() && !exporting;

  return (
    <div ref={rootRef} className="rounded-xl border border-border bg-card p-6 space-y-4">
      <h2 className="text-lg font-semibold">Animation vidéo</h2>

      <div className="flex flex-wrap gap-6">
        <fieldset className="space-y-1">
          <legend className="text-sm font-medium">Format</legend>
          {FORMATS.map((f) => (
            <label key={f.value} className="flex items-center gap-2 text-sm">
              <input type="radio" name="animation-format" value={f.value} checked={format === f.value} disabled={exporting}
                onChange={() => { setFormat(f.value); setT(0); }} />
              {f.label}
            </label>
          ))}
        </fieldset>
        <label className="block min-w-64 flex-1 text-sm font-medium">
          Titre
          <input value={title} onChange={(e) => setTitle(e.target.value)} disabled={exporting} maxLength={40} placeholder="Ex. Tournoi d’automne"
            className="mt-1 block w-full rounded-lg border border-border bg-background px-3 py-2 text-sm font-normal" />
          <span className="mt-1 block text-xs font-normal text-muted-foreground">Une vingtaine de caractères au plus pour qu’il tienne sur une ligne.</span>
        </label>
      </div>

      {!highlightedClub && (
        <p className="text-sm text-muted-foreground">Aucun club mis en valeur sur l’affiche : la vidéo n’aura ni bandeau « joueur du club » ni derby.</p>
      )}
      {tooManyRows && (
        <p className="text-sm text-destructive">
          {tl.nRows} matchs : le récapitulatif final n’en affiche correctement que {MAX_RECAP_ROWS[format]} au plus, la fin de la vidéo débordera.
        </p>
      )}

      <div className="flex flex-col items-start gap-3">
        <canvas ref={canvasRef} className="rounded-lg shadow-xl" style={{ width: previewW, height: PREVIEW_H, background: palette.dark }}
          role="img" aria-label="Aperçu de l’animation" />
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
