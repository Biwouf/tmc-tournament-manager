// Rendu et encodage de la vidéo, image par image : `renderFrame` dessine dans un OffscreenCanvas,
// `VideoEncoder` (WebCodecs) encode en H.264 et `mp4-muxer` assemble le fichier. Sans DOM :
// tourne dans le worker d'export (`exportWorker.ts`) comme sur le thread principal (repli).
import { ArrayBufferTarget, Muxer } from 'mp4-muxer';
import { animationPalette } from './palette';
import { renderFrame, type AnimationTexts, type Ctx2D, type FrameAssets } from './renderFrame';
import type { Timeline } from './timeline';

export const FPS = 30;
const BITRATE = 8_000_000;

/** Première configuration H.264 acceptée par le navigateur, ou `null` s'il ne sait pas encoder. */
export async function pickEncoderConfig(width: number, height: number): Promise<VideoEncoderConfig | null> {
  if (typeof VideoEncoder === 'undefined') return null;
  // High 5.0 d'abord (1080 × 1920 dépasse le niveau 4.0 de certains encodeurs), puis Main et Baseline.
  for (const codec of ['avc1.640032', 'avc1.640028', 'avc1.4d0032', 'avc1.42e032']) {
    for (const hardwareAcceleration of ['prefer-hardware', 'no-preference'] as const) {
      const config: VideoEncoderConfig = { codec, width, height, bitrate: BITRATE, framerate: FPS, hardwareAcceleration, avc: { format: 'avc' } };
      try {
        if ((await VideoEncoder.isConfigSupported(config)).supported) return config;
      } catch {
        // configuration refusée : on essaie la suivante
      }
    }
  }
  return null;
}

export class ExportCancelled extends Error {}

/** Tout ce qu'il faut pour rendre la vidéo ; clonable vers un worker (la palette est recalculée). */
export type ExportJob = { tl: Timeline; color: string; texts: AnimationTexts; assets: FrameAssets };
type Progress = (frame: number, frames: number) => void;

// Rend la main à la boucle d'événements par un message (un `setTimeout` est bridé à 1 s
// onglet caché) : la page peut afficher la progression et traiter « Annuler ».
const yieldTask = () => new Promise<void>((resolve) => {
  const ch = new MessageChannel();
  ch.port1.onmessage = () => resolve();
  ch.port2.postMessage(0);
});

/** Rend et encode toutes les images sur le thread courant (worker ou page). */
export async function encodeAnimation({ tl, color, texts, assets }: ExportJob, onProgress: Progress, isCancelled: () => boolean = () => false): Promise<ArrayBuffer> {
  const { W, H } = tl;
  const config = await pickEncoderConfig(W, H);
  if (!config) throw new Error('Ce navigateur ne sait pas encoder de vidéo H.264.');
  const canvas = typeof OffscreenCanvas !== 'undefined' ? new OffscreenCanvas(W, H) : Object.assign(document.createElement('canvas'), { width: W, height: H });
  const g = canvas.getContext('2d', { alpha: false }) as Ctx2D;
  const pal = animationPalette(color);

  const muxer = new Muxer({ target: new ArrayBufferTarget(), video: { codec: 'avc', width: W, height: H, frameRate: FPS }, fastStart: 'in-memory' });
  let encoderError: unknown = null;
  const encoder = new VideoEncoder({
    output: (chunk, meta) => muxer.addVideoChunk(chunk, meta),
    error: (e) => {
      encoderError = e;
    },
  });
  encoder.configure(config);

  const frames = Math.round(tl.total * FPS);
  try {
    for (let i = 0; i < frames; i++) {
      if (isCancelled()) throw new ExportCancelled();
      renderFrame(g, tl, i / FPS, pal, texts, assets);
      const frame = new VideoFrame(canvas, { timestamp: Math.round((i * 1e6) / FPS), duration: Math.round(1e6 / FPS) });
      encoder.encode(frame, { keyFrame: i % (FPS * 2) === 0 });
      frame.close();
      while (encoder.encodeQueueSize > 4 && !encoderError) await yieldTask();
      if (encoderError) throw encoderError;
      if (i % 5 === 4) await yieldTask();
      onProgress(i + 1, frames);
    }
    await encoder.flush();
  } finally {
    if (encoder.state !== 'closed') encoder.close();
  }
  muxer.finalize();
  return muxer.target.buffer;
}

/** Messages du worker d'export vers la page. */
export type WorkerReply =
  | { type: 'progress'; frame: number; frames: number }
  | { type: 'done'; buffer: ArrayBuffer }
  | { type: 'unsupported'; reason: string }
  | { type: 'error'; message: string };
