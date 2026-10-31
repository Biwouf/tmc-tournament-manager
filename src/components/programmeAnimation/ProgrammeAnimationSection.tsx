// Section « Animation vidéo » de /programmation-image : lecteur de l'animation du programme du
// jour (story ou carré) et export MP4 dans le navigateur. La vidéo reprend EXACTEMENT les
// réglages de l'affiche générée (matchs, club mis en valeur, partenaires tirés) : la page ne la
// rend disponible qu'une fois l'affiche téléchargée avec les réglages courants (`ready`).
import { useEffect, useEffectEvent, useMemo, useRef, useState } from 'react';
import { flushSync } from 'react-dom';
import { blobToDataUrl, loadAnimationFonts } from './fonts';
import { ExportCancelled, exportMp4, pickEncoderConfig } from './exportMp4';
import ProgrammeAnimationScene, { type AnimationAssets } from './ProgrammeAnimationScene';
import { animationPalette } from './palette';
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

// Images converties en data URL une fois : l'export n'a plus à les recharger à chaque image,
// et une image d'une autre origine ne peut plus sortir vide du rendu.
async function toDataUrl(url: string): Promise<string | null> {
  if (!url) return null;
  try {
    const res = await fetch(url, { mode: 'cors' });
    if (!res.ok) return null;
    return await blobToDataUrl(await res.blob());
  } catch {
    return null;
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
  const [assets, setAssets] = useState<AnimationAssets | null>(null);
  const [fontCSS, setFontCSS] = useState<string | null>(null);
  const [encoderOk, setEncoderOk] = useState<boolean | null>(null);
  const [exportT, setExportT] = useState<number | null>(null);
  const [progress, setProgress] = useState<{ frame: number; frames: number } | null>(null);
  const [exportError, setExportError] = useState('');
  const cancelRef = useRef(false);
  const exportNodeRef = useRef<HTMLDivElement>(null);
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
    loadAnimationFonts().then(setFontCSS, () => setFontCSS(''));
  }, []);

  const partnersKey = partnerLogos.join('\n');
  useEffect(() => {
    let alive = true;
    (async () => {
      const [l, li, ...partners] = await Promise.all([toDataUrl(logo), toDataUrl(logoInverse), ...partnersKey.split('\n').filter(Boolean).map(toDataUrl)]);
      if (alive) setAssets({ logo: l, logoOnDark: li, partners: partners.filter((p): p is string => !!p) });
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
  const exporting = exportT !== null;
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

  async function handleExport() {
    if (!assets || fontCSS === null) return;
    setExportError('');
    cancelRef.current = false;
    setProgress({ frame: 0, frames: Math.round(tl.total * 30) });
    setExportT(0);
    try {
      // Le nœud d'export se monte au rendu qui suit `setExportT(0)` : lancé depuis un effet
      // (export demandé par la page), ce rendu peut arriver après la prochaine image.
      for (let i = 0; !exportNodeRef.current && i < 100; i++) await new Promise((r) => setTimeout(r, 20));
      if (!exportNodeRef.current) throw new Error('La scène de la vidéo n’a pas pu être préparée.');
      const blob = await exportMp4({
        node: exportNodeRef.current,
        width: tl.W,
        height: tl.H,
        total: tl.total,
        setT: (t) => flushSync(() => setExportT(t)),
        fontEmbedCSS: fontCSS,
        onProgress: (frame, frames) => setProgress({ frame, frames }),
        isCancelled: () => cancelRef.current,
      });
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = `programme-${clubSlug}-${date}-${format}.mp4`;
      link.click();
      setTimeout(() => URL.revokeObjectURL(url), 60_000);
    } catch (e) {
      if (!(e instanceof ExportCancelled)) setExportError(e instanceof Error ? e.message : 'La génération de la vidéo a échoué.');
    } finally {
      setExportT(null);
      setProgress(null);
    }
  }

  // Export demandé par la page : on attend que l'affiche, les polices, les images et la détection
  // de l'encodeur soient prêtes, puis on le lance une fois (ou on explique pourquoi on ne peut pas).
  const settled = ready && !!assets && fontCSS !== null && encoderOk !== null && !exporting;
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

  const scale = PREVIEW_H / tl.H;
  const tooManyRows = tl.nRows > MAX_RECAP_ROWS[format];
  const canExport = !!assets && fontCSS !== null && encoderOk === true && !!title.trim() && !exporting;

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
        <div className="overflow-hidden rounded-lg shadow-xl" style={{ width: tl.W * scale, height: PREVIEW_H }}>
          <div style={{ width: tl.W, height: tl.H, transform: `scale(${scale})`, transformOrigin: '0 0' }}>
            {assets && <ProgrammeAnimationScene tl={tl} T={T} palette={palette} texts={texts} assets={assets} />}
          </div>
        </div>
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
              Image {progress.frame} / {progress.frames}. Gardez cet onglet ouvert et visible : la génération se met en pause s’il passe en arrière-plan.
            </p>
          </div>
        )}
        {!exporting && encoderOk === false && (
          <p className="text-sm text-destructive">Ce navigateur ne sait pas générer de vidéo. Utilisez une version récente de Chrome, Edge ou Safari.</p>
        )}
        {!exporting && encoderOk && (
          <p className="text-xs text-muted-foreground">La vidéo est générée dans votre navigateur : comptez une à trois minutes selon l’ordinateur.</p>
        )}
        {exportError && <p className="text-sm text-destructive">{exportError}</p>}
      </div>

      {/* Nœud d'export à taille réelle, hors écran, monté le temps de la génération seulement. */}
      {exporting && assets && (
        <div style={{ position: 'fixed', left: -20000, top: 0 }} aria-hidden="true">
          <div ref={exportNodeRef} style={{ width: tl.W, height: tl.H }}>
            <ProgrammeAnimationScene tl={tl} T={exportT} palette={palette} texts={texts} assets={assets} />
          </div>
        </div>
      )}
    </div>
  );
}
