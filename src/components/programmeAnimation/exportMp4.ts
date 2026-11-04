// Export MP4 entièrement dans le navigateur, sans serveur (les Edge Functions ne font tourner ni
// Chromium ni ffmpeg). Le rendu Canvas et l'encodage (`encodeAnimation.ts`) tournent dans un
// worker (`exportWorker.ts`) : la page reste fluide et l'export continue onglet caché.
// Navigateur sans OffscreenCanvas / VideoEncoder / polices en worker : même boucle sur le
// thread principal.
import { ExportCancelled, encodeAnimation, type ExportJob, type WorkerReply } from './encodeAnimation';

export { ExportCancelled, pickEncoderConfig, type ExportJob } from './encodeAnimation';
type Progress = (frame: number, frames: number) => void;

class WorkerUnsupported extends Error {}

function exportInWorker(job: ExportJob, onProgress: Progress, isCancelled: () => boolean): Promise<ArrayBuffer> {
  return new Promise((resolve, reject) => {
    let worker: Worker;
    try {
      worker = new Worker(new URL('./exportWorker.ts', import.meta.url), { type: 'module' });
    } catch (e) {
      return reject(new WorkerUnsupported(String(e)));
    }
    const finish = (fn: () => void) => {
      worker.terminate();
      fn();
    };
    worker.onerror = (e) => finish(() => reject(new WorkerUnsupported(e.message || 'worker indisponible')));
    worker.onmessage = ({ data }: MessageEvent<WorkerReply>) => {
      if (data.type === 'progress') {
        if (isCancelled()) return finish(() => reject(new ExportCancelled()));
        onProgress(data.frame, data.frames);
      } else if (data.type === 'done') finish(() => resolve(data.buffer));
      else if (data.type === 'unsupported') finish(() => reject(new WorkerUnsupported(data.reason)));
      else finish(() => reject(new Error(data.message)));
    };
    worker.postMessage(job);
  });
}

export async function exportMp4(job: ExportJob, onProgress: Progress, isCancelled: () => boolean): Promise<Blob> {
  let buffer: ArrayBuffer;
  try {
    buffer = await exportInWorker(job, onProgress, isCancelled);
  } catch (e) {
    if (!(e instanceof WorkerUnsupported)) throw e;
    console.info('Export vidéo sur le thread principal :', e.message);
    buffer = await encodeAnimation(job, onProgress, isCancelled);
  }
  return new Blob([buffer], { type: 'video/mp4' });
}
