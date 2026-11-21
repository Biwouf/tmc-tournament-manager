import { supabase } from './supabase';
import type { LiveMatch, LiveMatchWinner } from '../types';
import type { RecapSet } from '../../../shared/liveRecapCore.ts';

export type LiveRecap = {
  messages: number;
  photos: number;
  polls: number;
  reactions: number;
  top_reactions: { emoji: string; count: number }[];
  /** null tant que le live n'a pas dépassé 10 spectateurs uniques. */
  viewers: number | null;
  /** Instantanés du score pendant le live, du démarrage à la fin. */
  score: RecapSnapshot[];
  /** Les 5 commentaires ou photos les plus réagis, dans l'ordre du fil. */
  moments: RecapPost[];
  /** Les 6 photos les plus réagies, de la plus réagie à la moins réagie. */
  photos_top: RecapPost[];
};
export type RecapSnapshot = Partial<LiveMatch> & { at: string };
export type RecapPost = {
  id: string;
  kind: 'message' | 'photo';
  body: string;
  image_path: string | null;
  author_name: string;
  created_at: string;
  score: Partial<LiveMatch>;
  reactions: number;
  emoji: string | null;
};

/** null si le match n'est pas (ou plus) terminé. */
export async function readRecap(
  match: string,
  club: string,
): Promise<LiveRecap | null> {
  const { data, error } = await supabase
    .rpc('live_match_recap', { p_match: match, p_club: club })
    .abortSignal(AbortSignal.timeout(15000));
  if (error) throw new Error(error.message);
  return data as LiveRecap | null;
}

const VIEWER_KEY = 'live_viewer';
const VIEWED_KEY = 'live_viewed';
// Repli sans stockage (navigation privée) : une clé par session, pas par ouverture.
let sessionViewer: string | null = null;
const sessionViewed = new Set<string>();

/**
 * Compte cet appareil parmi les spectateurs d'un live en cours : un appel par
 * appareil et par match, identifiant aléatoire sans donnée personnelle.
 */
export function countLiveView(match: string) {
  let viewer = sessionViewer;
  let viewed: string[] = [...sessionViewed];
  try {
    viewer = localStorage.getItem(VIEWER_KEY) ?? viewer;
    viewed = JSON.parse(localStorage.getItem(VIEWED_KEY) ?? '[]');
  } catch {
    // stockage indisponible : la mémoire de session suffit
  }
  if (viewed.includes(match)) return;
  viewer ??= crypto.randomUUID();
  sessionViewer = viewer;
  sessionViewed.add(match);
  try {
    localStorage.setItem(VIEWER_KEY, viewer);
    localStorage.setItem(
      VIEWED_KEY,
      JSON.stringify([...viewed, match].slice(-50)),
    );
  } catch {
    // idem
  }
  // Statistique non critique : un échec n'est ni affiché ni rejoué.
  void supabase
    .rpc('live_match_view', { p_match: match, p_viewer: viewer })
    .then(() => {});
}

/**
 * Score d'un set lu du côté du vainqueur du match, qui est toujours cité en
 * premier : 4–6 6–3 10–6. Sans vainqueur (match non conclu), j1 d'abord.
 */
export function winnerFirst(score: [number, number], winner: LiveMatchWinner | null) {
  return winner === 'j2' ? [score[1], score[0]] : score;
}

export {
  recapSets,
  replayFrames,
  matchHighlight,
} from '../../../shared/liveRecapCore.ts';
export type {
  RecapGame,
  RecapSet,
  ReplayFrame,
  RecapHighlight,
} from '../../../shared/liveRecapCore.ts';
/** Série de jeux consécutifs à partir de laquelle la courbe la met en scène. */
export const STREAK = 4;
/** Largeur d'un super tie-break sur la courbe, en jeux. */
const SUPER_TB_WIDTH = 4;
/** Jeux de chaque joueur dans le set après `x` jeux du match ; known: ordre du segment qui y mène. */
export type ProgressPoint = { x: number; games: [number, number]; known: boolean };
export type ProgressSet = { set: RecapSet; from: number; to: number; points: ProgressPoint[] };
export type ProgressEvent =
  | { kind: 'streak'; id: string; x: number; side: LiveMatchWinner; from: number; to: number }
  | { kind: 'set'; id: string; x: number; side: LiveMatchWinner | null; set: RecapSet };

/**
 * Progression du match, set par set : les jeux de chaque joueur ne font que
 * monter dans un set et repartent de 0 au suivant. Les jeux d'ordre inconnu (et
 * les sets sans historique) forment un seul segment `known: false` ; un super
 * tie-break (points, ordre inconnu) occupe SUPER_TB_WIDTH jeux. Événements :
 * séries d'au moins STREAK jeux connus (au-delà des fins de set) et fins de
 * set, `x` étant le moment où la courbe les atteint.
 */
export function progression(sets: RecapSet[]) {
  const out: ProgressSet[] = [];
  const events: ProgressEvent[] = [];
  let x = 0;
  type Run = { side: LiveMatchWinner; from: number; length: number };
  let run = null as Run | null;
  const close = (run: Run | null) => {
    if (run && run.length >= STREAK)
      events.push({
        kind: 'streak',
        id: `streak${run.from}`,
        x: run.from + STREAK,
        side: run.side,
        from: run.from,
        to: run.from + run.length,
      });
  };
  for (const s of sets) {
    const from = x;
    const points: ProgressPoint[] = [{ x, games: [0, 0], known: true }];
    if (s.superTiebreak || !s.games) {
      close(run);
      run = null;
      x += s.superTiebreak ? SUPER_TB_WIDTH : s.score[0] + s.score[1];
      points.push({ x, games: s.score, known: false });
    } else {
      const games: [number, number] = [0, 0];
      let unknown = false;
      for (const g of s.games) {
        if (g.known && unknown) points.push({ x, games: [...games], known: false });
        unknown = !g.known;
        x++;
        games[g.side === 'j1' ? 0 : 1]++;
        if (!g.known) {
          close(run);
          run = null;
          continue;
        }
        points.push({ x, games: [...games], known: true });
        if (run?.side === g.side) run.length++;
        else {
          close(run);
          run = { side: g.side, from: x - 1, length: 1 };
        }
      }
      if (unknown) points.push({ x, games: [...games], known: false });
    }
    out.push({ set: s, from, to: x, points });
    events.push({
      kind: 'set',
      id: `set${s.set}`,
      x,
      side: s.score[0] === s.score[1] ? null : s.score[0] > s.score[1] ? 'j1' : 'j2',
      set: s,
    });
  }
  close(run);
  return { sets: out, total: x, events: events.sort((a, b) => a.x - b.x) };
}
