// Calcul pur de l'animation « programme du jour » : découpage en écrans, cues, durée, placement
// des cartes, règles joueur du club / derby / bandeau. Portage de la skill Claude
// `tournoi-animation-facebook` (template.html, v2 du 11/10/2026) : mêmes séquences, mêmes durées.
// Aucune dépendance au DOM ni à React — testé par `npm run test:programme-animation`.

export type AnimationFormat = 'story' | 'carre';

export type AnimPlayer = { first: string; last: string; rank: string; club: string; home: boolean };
export type AnimMatch = { cat: string; a: AnimPlayer; b: AnimPlayer; derby: boolean; banner: string | null };
export type AnimSlot = { time: string; matches: AnimMatch[]; derby: boolean; cue: string };
export type AnimCard = { key: string; m: AnimMatch; time: string; s: number; e: number; top: number; impact: number };
export type AnimImpact = { t: number; x: number; y: number; big: boolean };

/** Sous-ensemble du `Match` de `/programmation-image` dont l'animation a besoin. */
export type ProgrammeMatch = {
  heure: string;
  type_tournoi: string;
  j1_prenom: string;
  j1_nom: string;
  j1_classement: string;
  j1_club: string;
  j2_prenom: string;
  j2_nom: string;
  j2_classement: string;
  j2_club: string;
};

export type Timeline = {
  format: AnimationFormat;
  story: boolean;
  W: number;
  H: number;
  /** Décalage vertical de l'en-tête : en story, rien d'important dans les 250 px du haut. */
  OY: number;
  slots: AnimSlot[];
  cues: Record<string, number>;
  total: number;
  cards: AnimCard[];
  impacts: AnimImpact[];
  nRows: number;
  homeCount: number;
  club: string;
};

export const BEAT = 0.5;
/** Un écran avec derby s'ouvre sur le mot DERBY plein écran. */
export const DERBY_LEAD = 3 * BEAT;
export const TITLE_HIT = 0.5;
export const CARD_H = 240;
const CARD_GAP = 32;
/** Story : panneau partenaires flottant au-dessus de la zone « Envoyer un message ». */
export const PARTNERS_BOTTOM = 270;
export const PARTNERS_H = 140;
/** Au-delà, le récap déborde sur les partenaires (réduire les polices n'est pas géré). */
export const MAX_RECAP_ROWS: Record<AnimationFormat, number> = { story: 9, carre: 8 };

// Même règle que le cartouche de l'affiche (`FEMININE_RE` de ProgrammationImagePage) :
// simple/double dames ou libellé CSV « Femmes » / « Dames ».
const FEMININE_RE = /\b(SD|DD|SF|dames?|femmes?|f[ée]minin\w*)\b/i;

export const clamp = (v: number, a: number, b: number) => Math.min(b, Math.max(a, v));
export const Easing = {
  easeOutCubic: (t: number) => 1 - Math.pow(1 - t, 3),
  easeInOutCubic: (t: number) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2),
  easeOutBack: (t: number) => {
    const c1 = 1.70158, c3 = c1 + 1;
    return 1 + c3 * Math.pow(t - 1, 3) + c1 * Math.pow(t - 1, 2);
  },
  easeInQuad: (t: number) => t * t,
};
export const M = {
  enter: (T: number, s: number, d = 0.6) => Easing.easeOutCubic(clamp((T - s) / d, 0, 1)),
  pop: (T: number, s: number, d = 0.5) => Easing.easeOutBack(clamp((T - s) / d, 0, 1)),
  draw: (T: number, s: number, d = 0.6) => Easing.easeInOutCubic(clamp((T - s) / d, 0, 1)),
};
export const decay = (T: number, t0: number, rate: number) => (T < t0 ? 0 : Math.exp(-(T - t0) * rate));

/** « 18:00 » → « 18h », « 19:30 » → « 19h30 » (même rendu que l'affiche). */
export function formatHeure(heure: string): string {
  const [h, m] = heure.split(':');
  return m === '00' || !m ? `${parseInt(h)}h` : `${parseInt(h)}h${m}`;
}

/** « 2026-10-13 » → « mardi 13 octobre » (même rendu que l'affiche). */
export function formatDateLabel(dateStr: string): string {
  const date = new Date(dateStr + 'T12:00:00'); // évite les décalages UTC
  const jours = ['dimanche', 'lundi', 'mardi', 'mercredi', 'jeudi', 'vendredi', 'samedi'];
  const mois = ['janvier', 'février', 'mars', 'avril', 'mai', 'juin', 'juillet', 'août', 'septembre', 'octobre', 'novembre', 'décembre'];
  return `${jours[date.getDay()]} ${date.getDate()} ${mois[date.getMonth()]}`;
}

function player(first: string, last: string, rank: string, club: string, homeClub: string | null): AnimPlayer {
  const home = !!homeClub && club.trim().toLowerCase() === homeClub.trim().toLowerCase();
  // Match incomplet (adversaire pas encore connu) : la carte garde sa forme.
  if (!last.trim()) return { first: '', last: 'À DÉTERMINER', rank: '', club: '', home: false };
  return { first: first.trim(), last: last.trim().toUpperCase(), rank: rank.trim(), club: club.trim(), home };
}

function toAnimMatch(m: ProgrammeMatch, homeClub: string | null): AnimMatch {
  const a = player(m.j1_prenom, m.j1_nom, m.j1_classement, m.j1_club, homeClub);
  const b = player(m.j2_prenom, m.j2_nom, m.j2_classement, m.j2_club, homeClub);
  const n = (a.home ? 1 : 0) + (b.home ? 1 : 0);
  const women = FEMININE_RE.test(m.type_tournoi);
  const banner = n === 2 ? 'DERBY · ' + (homeClub ?? '').toUpperCase() : n === 1 ? (women ? 'JOUEUSE DU CLUB' : 'JOUEUR DU CLUB') : null;
  return { cat: m.type_tournoi.trim(), a, b, derby: n === 2, banner };
}

/**
 * Découpage en écrans : les matchs consécutifs d'un même horaire forment un groupe, découpé en
 * écrans de 3 cartes max en story, 2 en carré, à répartition équilibrée
 * (carré : 3 → 2+1, 4 → 2+2, 5 → 2+2+1 ; story : 4 → 2+2, 5 → 3+2).
 */
export function splitScreens<T>(groups: { time: string; matches: T[] }[], maxPerScreen: number) {
  return groups.flatMap((g) => {
    const k = Math.ceil(g.matches.length / maxPerScreen);
    const out: { time: string; matches: T[] }[] = [];
    let i = 0;
    for (let s = 0; s < k; s++) {
      const n = Math.ceil((g.matches.length - i) / (k - s));
      out.push({ time: g.time, matches: g.matches.slice(i, i + n) });
      i += n;
    }
    return out;
  });
}

/**
 * `matches` : les matchs de l'affiche, dans son ordre (WO déjà exclus).
 * `homeClub` : le club mis en valeur sur l'affiche — `null` ⇒ aucun joueur du club, donc ni
 * bandeau ni derby.
 */
export function buildTimeline(matches: ProgrammeMatch[], homeClub: string | null, format: AnimationFormat): Timeline {
  const story = format === 'story';
  const W = 1080, H = story ? 1920 : 1080, OY = story ? 250 : 0;

  const groups: { time: string; matches: AnimMatch[] }[] = [];
  for (const m of matches) {
    const time = formatHeure(m.heure);
    const last = groups[groups.length - 1];
    const am = toAnimMatch(m, homeClub);
    if (last && last.time === time) last.matches.push(am);
    else groups.push({ time, matches: [am] });
  }
  const slots: AnimSlot[] = splitScreens(groups, story ? 3 : 2).map((sl, i) => ({
    ...sl,
    cue: 'Slot' + (i + 1),
    derby: sl.matches.some((m) => m.derby),
  }));

  const nRows = slots.reduce((s, sl) => s + sl.matches.length, 0);
  const homeCount = new Set(
    slots.flatMap((sl) => sl.matches.flatMap((m) => [m.a, m.b])).filter((p) => p.home).map((p) => p.first + ' ' + p.last),
  ).size;

  // Grille rythmique : 1 temps = 0,5 s
  const scenes: [string, number][] = [
    ['Intro', 2 * BEAT],
    ['Date', 2 * BEAT],
    ...slots.map((sl): [string, number] => [sl.cue, (sl.derby ? DERBY_LEAD : 0) + 6 * BEAT + BEAT * sl.matches.length]),
    ['Recap', 6 * BEAT + BEAT * 0.5 * nRows],
  ];
  const cues: Record<string, number> = {};
  let acc = 0;
  for (const [n, d] of scenes) {
    cues[n] = acc;
    acc += d;
  }
  cues.Outro = acc;
  const total = acc + 2 * BEAT;

  // Cartes : départ, sortie, position, instant d'impact du VS
  const area = story ? 640 : 392;
  const avail = (story ? H - PARTNERS_BOTTOM - PARTNERS_H : 930) - 24 - area;
  const cards: AnimCard[] = [];
  slots.forEach((sl, si) => {
    const s0 = cues[sl.cue] + (sl.derby ? DERBY_LEAD : 0);
    const e = (slots[si + 1] ? cues[slots[si + 1].cue] : cues.Recap) - 0.3;
    const n = sl.matches.length;
    const top0 = area + Math.max(0, (avail - (n * CARD_H + (n - 1) * CARD_GAP)) / 2);
    sl.matches.forEach((m, mi) => {
      const s = s0 + mi * BEAT;
      cards.push({ key: si + '-' + mi, m, time: sl.time, s, e: e + mi * 0.06, top: top0 + mi * (CARD_H + CARD_GAP), impact: s + BEAT });
    });
  });
  const impacts = cards.map((c) => ({ t: c.impact, x: 540, y: c.top + 128, big: c.m.derby }));

  return { format, story, W, H, OY, slots, cues, total, cards, impacts, nRows, homeCount, club: homeClub ?? '' };
}

/** Part de « mode derby » (0 → 1) à l'instant T. */
export function derbyOn(tl: Timeline, T: number): number {
  return tl.slots.reduce((a, sl, i) => {
    if (!sl.derby) return a;
    const end = tl.slots[i + 1] ? tl.cues[tl.slots[i + 1].cue] : tl.cues.Recap;
    return Math.max(a, M.draw(T, tl.cues[sl.cue] - 0.1, 0.3) * (1 - M.draw(T, end - 0.4, 0.4)));
  }, 0);
}
