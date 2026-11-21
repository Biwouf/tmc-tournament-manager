// W1 — partage de la story depuis les premiers pas : partage natif sur mobile
// (`navigator.share({ files })`), téléchargement ailleurs. Aucun dépôt du MP4 (W1b abandonné).
// Brief `SAAS_11_onboarding_tenup` §13.2.
import type { TeamMatch } from '../../types';

export type ShareMode = 'share' | 'download';

type ShareNavigator = Pick<Navigator, 'share' | 'canShare'>;

const mp4 = (blob: Blob, fileName: string) => new File([blob], `${fileName}.mp4`, { type: 'video/mp4' });

/** Partage natif sur un écran tactile qui sait partager un MP4 ; téléchargement sur ordinateur. */
export function shareModeFor(nav: Partial<ShareNavigator>, coarsePointer: boolean): ShareMode {
  if (!coarsePointer || typeof nav.share !== 'function' || typeof nav.canShare !== 'function') return 'download';
  try {
    return nav.canShare({ files: [mp4(new Blob([], { type: 'video/mp4' }), 'story')] }) ? 'share' : 'download';
  } catch {
    return 'download';
  }
}

/** Télécharge le fichier par un lien temporaire. */
export function downloadBlob(blob: Blob, fileName: string): void {
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = `${fileName}.mp4`;
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 60_000);
}

/**
 * Ouvre la feuille de partage avec la vidéo. `'shared'` si l'utilisateur a choisi une app,
 * `'aborted'` s'il a fermé la feuille, `'blocked'` si le navigateur exige un nouveau geste
 * (l'encodage a duré trop longtemps après le clic) : il suffit de toucher « Partager » à nouveau.
 * Toute autre erreur est relancée.
 */
export async function shareVideo(nav: ShareNavigator, blob: Blob, fileName: string): Promise<'shared' | 'aborted' | 'blocked'> {
  const files = [mp4(blob, fileName)];
  if (!nav.canShare({ files })) throw new Error('partage de fichier refusé');
  try {
    await nav.share({ files });
    return 'shared';
  } catch (e) {
    const name = e instanceof Error ? e.name : '';
    if (name === 'AbortError') return 'aborted';
    if (name === 'NotAllowedError') return 'blocked';
    throw e;
  }
}

/** Secondes restantes estimées d'après le rythme déjà mesuré ; avant la première mesure,
 *  ~1 s d'encodage par seconde de vidéo (mesure du 19/11). */
export function remainingSeconds(elapsedMs: number, frame: number, frames: number, videoSeconds: number): number {
  if (frame < Math.min(15, frames) || elapsedMs <= 0) return Math.max(1, Math.round(videoSeconds));
  return Math.max(1, Math.round(((elapsedMs / frame) * (frames - frame)) / 1000));
}

/** Poids en Mo arrondi (« 7 Mo »). */
export const megabytes = (bytes: number) => `${Math.max(1, Math.round(bytes / 1_000_000))} Mo`;

const dayOf = (iso: string) => { const [y, m, d] = iso.split('-').map(Number); return new Date(y, m - 1, d); };
const joinFr = (items: string[]) => (items.length < 2 ? items.join('') : `${items.slice(0, -1).join(', ')} et ${items[items.length - 1]}`);
const distinctDates = (matches: TeamMatch[]) => [...new Set(matches.map((m) => m.date))];

/** « dimanche », « samedi et dimanche » : les jours des rencontres. */
export function storyDays(matches: TeamMatch[]): string {
  return joinFr(distinctDates(matches).map((d) => dayOf(d).toLocaleDateString('fr-FR', { weekday: 'long' })));
}

/** « dim. 22 novembre », « sam. 21 et dim. 22 novembre ». */
export function storyDates(matches: TeamMatch[]): string {
  const dates = distinctDates(matches).map(dayOf);
  return joinFr(dates.map((d, i) => {
    const sameMonthAsNext = i < dates.length - 1 && dates[i + 1].getMonth() === d.getMonth();
    return d.toLocaleDateString('fr-FR', sameMonthAsNext ? { weekday: 'short', day: 'numeric' } : { weekday: 'short', day: 'numeric', month: 'long' });
  }));
}

