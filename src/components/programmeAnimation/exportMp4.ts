// Export MP4 entièrement dans le navigateur : on pose `T` image par image, `html-to-image`
// rastérise la scène, `VideoEncoder` (WebCodecs) encode en H.264 et `mp4-muxer` assemble le
// fichier. Aucun serveur : les Edge Functions ne font tourner ni Chromium ni ffmpeg.
// Prototype du 16/10/2026 (M1 Pro) : story de 20 s en ~90 s, carré de 23 s en ~95 s ; le coût
// est tout entier dans la rastérisation, l'encodage est quasi gratuit.
import { toCanvas } from 'html-to-image';
import { ArrayBufferTarget, Muxer } from 'mp4-muxer';

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

type ExportOptions = {
  node: HTMLElement;
  width: number;
  height: number;
  total: number;
  /** Pose l'instant `t` et rend la scène de façon SYNCHRONE (flushSync). */
  setT: (t: number) => void;
  fontEmbedCSS: string;
  onProgress: (frame: number, frames: number) => void;
  isCancelled: () => boolean;
};

// Dans un onglet caché, Chrome bride la page : une image peut alors prendre plus de 10 s
// (constaté au prototype). On met l'export en pause jusqu'au retour de l'onglet.
function whenVisible(): Promise<void> {
  if (!document.hidden) return Promise.resolve();
  return new Promise((resolve) => {
    const onChange = () => {
      if (document.hidden) return;
      document.removeEventListener('visibilitychange', onChange);
      resolve();
    };
    document.addEventListener('visibilitychange', onChange);
  });
}

export async function exportMp4({ node, width, height, total, setT, fontEmbedCSS, onProgress, isCancelled }: ExportOptions): Promise<Blob> {
  const config = await pickEncoderConfig(width, height);
  if (!config) throw new Error('Ce navigateur ne sait pas encoder de vidéo H.264.');

  const muxer = new Muxer({ target: new ArrayBufferTarget(), video: { codec: 'avc', width, height, frameRate: FPS }, fastStart: 'in-memory' });
  let encoderError: unknown = null;
  const encoder = new VideoEncoder({
    output: (chunk, meta) => muxer.addVideoChunk(chunk, meta),
    error: (e) => {
      encoderError = e;
    },
  });
  encoder.configure(config);

  const frames = Math.round(total * FPS);
  try {
    for (let i = 0; i < frames; i++) {
      if (isCancelled()) throw new ExportCancelled();
      await whenVisible();
      setT(i / FPS);
      const canvas = await toCanvas(node, { width, height, pixelRatio: 1, fontEmbedCSS, cacheBust: false });
      const frame = new VideoFrame(canvas, { timestamp: Math.round((i * 1e6) / FPS), duration: Math.round(1e6 / FPS) });
      encoder.encode(frame, { keyFrame: i % (FPS * 2) === 0 });
      frame.close();
      while (encoder.encodeQueueSize > 4) await new Promise((r) => setTimeout(r, 1));
      if (encoderError) throw encoderError;
      onProgress(i + 1, frames);
    }
    await encoder.flush();
  } finally {
    if (encoder.state !== 'closed') encoder.close();
  }
  muxer.finalize();
  return new Blob([muxer.target.buffer], { type: 'video/mp4' });
}
