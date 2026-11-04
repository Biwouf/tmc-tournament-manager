// Worker d'export MP4 : reçoit un `ExportJob` (timeline, couleur, textes, images déjà décodées
// en ImageBitmap par la page — un worker ne sait pas décoder un SVG), charge les polices dans
// son propre `FontFaceSet`, puis rend et encode la vidéo (`encodeAnimation`). Répond
// `unsupported` si OffscreenCanvas, VideoEncoder ou les polices manquent : la page refait alors
// l'export sur son thread.
import { addAnimationFonts } from './fonts';
import { encodeAnimation, pickEncoderConfig, type ExportJob, type WorkerReply } from './encodeAnimation';

const scope = self as unknown as {
  fonts?: FontFaceSet;
  onmessage: ((e: MessageEvent<ExportJob>) => void) | null;
  postMessage: (msg: WorkerReply, transfer?: Transferable[]) => void;
};

async function run(job: ExportJob) {
  if (typeof OffscreenCanvas === 'undefined' || !new OffscreenCanvas(1, 1).getContext('2d'))
    return scope.postMessage({ type: 'unsupported', reason: 'OffscreenCanvas 2D absent du worker' });
  if (!scope.fonts) return scope.postMessage({ type: 'unsupported', reason: 'polices indisponibles dans le worker' });
  if (!(await pickEncoderConfig(job.tl.W, job.tl.H))) return scope.postMessage({ type: 'unsupported', reason: 'VideoEncoder H.264 absent du worker' });
  try {
    await addAnimationFonts(scope.fonts);
  } catch (e) {
    return scope.postMessage({ type: 'unsupported', reason: `polices non chargées : ${e}` });
  }
  try {
    const buffer = await encodeAnimation(job, (frame, frames) => scope.postMessage({ type: 'progress', frame, frames }));
    scope.postMessage({ type: 'done', buffer }, [buffer]);
  } catch (e) {
    scope.postMessage({ type: 'error', message: e instanceof Error ? e.message : String(e) });
  }
}

scope.onmessage = (e) => void run(e.data);
