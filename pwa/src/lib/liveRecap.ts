import { supabase } from './supabase';
import type { LiveMatch, LiveMatchWinner } from '../types';

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

export type RecapGame = { side: LiveMatchWinner; known: boolean };
export type RecapSet = {
  set: 1 | 2 | 3;
  score: [number, number];
  tiebreak: [number, number] | null;
  superTiebreak: boolean;
  /** Jeux dans l'ordre ; null sans historique (match terminé avant le récap). */
  games: RecapGame[] | null;
};

/**
 * Déroulé jeu par jeu de chaque set depuis les instantanés du live. Une
 * correction retire le jeu annulé au lieu de l'attribuer à l'adversaire ; les
 * jeux déjà marqués au démarrage, ou ajoutés à plusieurs dans une même saisie
 * des deux côtés, ont un ordre inconnu (`known: false`).
 */
export function recapSets(
  match: LiveMatch,
  snapshots: Partial<LiveMatch>[],
): RecapSet[] {
  const superTiebreak = match.set3_format === 'super_tiebreak';
  return ([1, 2, 3] as const).flatMap((n) => {
    const a = match[`set${n}_j1`];
    const b = match[`set${n}_j2`];
    if (a === null || b === null || (n > 1 && a + b === 0)) return [];
    const tbA = match[`set${n}_tb_j1`];
    const tbB = match[`set${n}_tb_j2`];
    const isSuper = n === 3 && superTiebreak;
    let games: RecapGame[] | null = null;
    if (!isSuper && snapshots.length) {
      games = [];
      for (const [i, s] of [...snapshots, match].entries())
        reconcile(games, s[`set${n}_j1`] ?? 0, s[`set${n}_j2`] ?? 0, i > 0);
    }
    return [
      {
        set: n,
        score: [a, b] as [number, number],
        tiebreak: tbA !== null && tbB !== null ? [tbA, tbB] : null,
        superTiebreak: isSuper,
        games,
      },
    ];
  });
}

function reconcile(games: RecapGame[], a: number, b: number, live: boolean) {
  const count = (side: LiveMatchWinner) =>
    games.filter((g) => g.side === side).length;
  while (count('j1') > a || count('j2') > b) games.pop();
  const known = live && (count('j1') === a || count('j2') === b);
  while (count('j1') < a) games.push({ side: 'j1', known });
  while (count('j2') < b) games.push({ side: 'j2', known });
}

type Games = [number, number][];
export type ReplayFrame = {
  /** Jeux de chaque set (points pour un super tie-break), sets non commencés absents. */
  sets: Games;
  at: string | null;
  /** Jeu que cette étape ajoute, quand il est seul : son vainqueur et s'il s'agit d'un break. */
  game: { side: LiveMatchWinner; set: number; isBreak: boolean | null } | null;
};

function framesSets(s: Partial<LiveMatch>): Games {
  return ([1, 2, 3] as const).flatMap((n) => {
    const a = s[`set${n}_j1`];
    const b = s[`set${n}_j2`];
    return a == null && b == null ? [] : [[a ?? 0, b ?? 0] as [number, number]];
  });
}

const covers = (a: Games, b: Games) =>
  a.every((g, i) => !!b[i] && g[0] <= b[i][0] && g[1] <= b[i][1]);

/**
 * Étapes du replay, du démarrage au score final. Une correction efface les
 * étapes qu'elle annule ; le score final de la ligne fait foi. Le break se
 * déduit du premier serveur (service alterné à chaque jeu, un tie-break compte
 * pour un jeu, comme `getServer`) : null quand il est inconnu.
 */
export function replayFrames(
  match: LiveMatch,
  snapshots: RecapSnapshot[],
): ReplayFrame[] {
  if (!snapshots.length) return [];
  const superTb = match.set3_format === 'super_tiebreak';
  const frames: { sets: Games; at: string | null }[] = [];
  for (const s of [...snapshots, { ...match, at: match.finished_at }]) {
    const sets = framesSets(s);
    while (frames.length && !covers(frames[frames.length - 1].sets, sets))
      frames.pop();
    const last = frames[frames.length - 1];
    if (last && JSON.stringify(last.sets) === JSON.stringify(sets)) continue;
    frames.push({ sets, at: s.at });
  }
  const games = (sets: Games) =>
    sets.reduce((n, [a, b], i) => (superTb && i === 2 ? n : n + a + b), 0);
  return frames.map((f, i) => {
    const before = frames[i - 1];
    if (!before || games(f.sets) - games(before.sets) !== 1)
      return { ...f, game: null };
    const set = f.sets.findIndex(
      (g, k) => !before.sets[k] || g[0] + g[1] !== before.sets[k][0] + before.sets[k][1],
    );
    const prev = before.sets[set] ?? [0, 0];
    const side: LiveMatchWinner = f.sets[set][0] > prev[0] ? 'j1' : 'j2';
    const index = games(before.sets);
    const server = !match.first_server
      ? null
      : index % 2 === 0
        ? match.first_server
        : match.first_server === 'j1'
          ? 'j2'
          : 'j1';
    return { ...f, game: { side, set, isBreak: server && server !== side } };
  });
}

export type RecapHighlight = { title: string; detail: string };

/** Le moment fort du match, ou null s'il n'y en a pas de remarquable. */
export function matchHighlight(
  match: LiveMatch,
  sets: RecapSet[],
  name: (side: LiveMatchWinner) => string,
): RecapHighlight | null {
  const winner = match.winner;
  const label = (s: RecapSet) => (s.superTiebreak ? 'Super tie-break' : `Set ${s.set}`);
  if (winner && !match.retired_player) {
    let best: { deficit: number; at: [number, number]; set: RecapSet } | null = null;
    for (const s of sets) {
      if (!s.games || s.games.some((g) => !g.known)) continue;
      const setWinner = s.score[0] > s.score[1] ? 'j1' : 'j2';
      let a = 0;
      let b = 0;
      for (const g of s.games) {
        if (g.side === 'j1') a++;
        else b++;
        const [mine, theirs] = setWinner === 'j1' ? [a, b] : [b, a];
        if (theirs - mine >= 2 && (!best || theirs - mine > best.deficit))
          best = { deficit: theirs - mine, at: [mine, theirs], set: s };
      }
    }
    if (best) {
      const side = best.set.score[0] > best.set.score[1] ? 'j1' : 'j2';
      const final = side === 'j1' ? best.set.score : [best.set.score[1], best.set.score[0]];
      return {
        title: `Mené ${best.at[0]}–${best.at[1]}, ${name(side)} retourne la situation`,
        detail: `${label(best.set)} remporté ${final[0]}–${final[1]}`,
      };
    }
    const first = sets[0];
    if (sets.length > 1 && first && (first.score[0] > first.score[1] ? 'j1' : 'j2') !== winner)
      return {
        title: `${name(winner)} s'impose après avoir perdu le premier set`,
        detail: `Premier set perdu ${winner === 'j1' ? first.score.join('–') : [...first.score].reverse().join('–')}`,
      };
  }
  let run: { side: LiveMatchWinner; length: number; set: RecapSet } | null = null;
  for (const s of sets) {
    let length = 0;
    let side: LiveMatchWinner | null = null;
    for (const g of s.games ?? []) {
      if (!g.known) {
        side = null;
        length = 0;
        continue;
      }
      length = g.side === side ? length + 1 : 1;
      side = g.side;
      if (length >= 4 && (!run || length > run.length)) run = { side, length, set: s };
    }
  }
  if (run)
    return {
      title: `${run.length} jeux de suite pour ${name(run.side)}`,
      detail: label(run.set),
    };
  const tight = sets.find((s) => s.tiebreak || s.superTiebreak);
  if (tight) {
    const [a, b] = tight.superTiebreak ? tight.score : tight.tiebreak!;
    return {
      title: tight.superTiebreak ? 'Tout s’est joué au super tie-break' : 'Un set arraché au tie-break',
      detail: `${label(tight)} · ${tight.superTiebreak ? '' : 'jeu décisif '}${Math.max(a, b)}–${Math.min(a, b)}`,
    };
  }
  return null;
}
