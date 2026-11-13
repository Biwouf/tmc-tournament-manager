// Calcul pur de la story « Prochaines rencontres » (matches par équipes) : regroupement par jour,
// découpage en écrans, cues, durée, placement des cartes et du récap. Portage de la skill Claude
// `rencontres-equipes-animation` (v1 du 07/11/2026) : mêmes séquences, tenue des écrans de cartes raccourcie le 13/11. Story
// uniquement (1080 × 1920), comme la skill. Aucune dépendance au DOM ni à React — testé par
// `npm run test:rencontres-animation`.
import type { TeamMatch } from '../../types';
import { GENRE_LABELS, formatCategorie } from '../teamMatches/teamMatchLabels.ts';
import { STORY_MAX_SECONDS, formatHeure, splitStoryParts } from '../programmeAnimation/timeline.ts';

export type AnimOpponent = { name: string; sub: string };
export type AnimRencontre = {
  time: string;
  comp: string;
  /** « HOMMES · SENIORS » */
  tag: string;
  /** « ÉQUIPE 2 » */
  team: string;
  opp: AnimOpponent;
  home: boolean;
};
export type AnimDay = {
  /** « 2026-11-08 » */
  date: string;
  day: string;
  num: string;
  month: string;
  /** « Dimanche 8 novembre » */
  label: string;
  /** Horaires du jour, sans doublon : « 9h · 14h ». */
  hours: string;
  matches: AnimRencontre[];
  start: number;
  hit: number;
  compact: number;
  end: number;
};
export type RencontreCard = {
  key: number;
  m: AnimRencontre;
  s: number;
  impact: number;
  flip: number;
  top: number;
  /** Hauteur de la carte : 400 px jusqu'à 2 cartes par écran, 320 px à 3. */
  CH: number;
  side: 'L' | 'R';
  out: number;
};
export type RecapItem =
  | { type: 'head'; day: AnimDay; y: number; at: number }
  | { type: 'row'; m: AnimRencontre; y: number; i: number };
export type Recap = { start: number; rows0: number; badges: number; end: number; rowH: number; items: RecapItem[] };
export type RencontresImpact = { t: number; x: number; y: number; big: boolean };

export type RencontresTimeline = {
  W: number;
  H: number;
  /** Décalage de l'en-tête : rien d'important dans les 250 px du haut d'une story. */
  OY: number;
  days: AnimDay[];
  cards: RencontreCard[];
  /** Début de chaque écran de cartes (balayages entre deux écrans d'un même jour). */
  wipes: number[];
  recap: Recap | null;
  /** Écran final, arrivée des partenaires, fondu de sortie. */
  end: number;
  partners: number;
  outro: number;
  total: number;
  impacts: RencontresImpact[];
  nHome: number;
  nAway: number;
};

export const BEAT = 0.5;
export const MAX_PER_SCREEN = 3;
const GAP = 36, AREA_TOP = 590, AREA_BOTTOM = 1640;
/** Récap : lignes de 104 px (+ 14 d'écart), resserrées s'il y en a trop pour la zone sûre. */
const RECAP_TOP = 600, RECAP_BOTTOM = 1650, RECAP_ROW = 104, RECAP_GAP = 14, RECAP_HEAD = 64, RECAP_DAY_GAP = 10;

const JOURS = ['DIMANCHE', 'LUNDI', 'MARDI', 'MERCREDI', 'JEUDI', 'VENDREDI', 'SAMEDI'];
const MOIS = ['JANVIER', 'FÉVRIER', 'MARS', 'AVRIL', 'MAI', 'JUIN', 'JUILLET', 'AOÛT', 'SEPTEMBRE', 'OCTOBRE', 'NOVEMBRE', 'DÉCEMBRE'];

const cap = (s: string) => s.charAt(0) + s.slice(1).toLocaleLowerCase('fr-FR');

/** « 2026-11-01 » → jour, « 1er », mois et libellé « Dimanche 1er novembre ». */
export function dayParts(iso: string) {
  const [y, mo, d] = iso.split('-').map(Number);
  const dt = new Date(y, mo - 1, d);
  const day = JOURS[dt.getDay()], month = MOIS[mo - 1], num = d === 1 ? '1er' : String(d);
  return { day, num, month, label: `${cap(day)} ${num} ${month.toLocaleLowerCase('fr-FR')}` };
}

// Mots qui désignent le club et non sa ville : « TENNIS CLUB », « T.C », « RACING »…
const CLUB_WORDS = new Set(['TENNIS', 'CLUB', 'TC', 'T.C', 'T.C.', 'A.S', 'A.S.', 'ASPTT', 'ASSOCIATION', 'PADEL', 'RACING']);

/**
 * Nom d'adversaire Ten'Up → gros nom (la ville) et sous-titre (le reste), comme sur l'affiche :
 * « LAUNAGUET RACING TENNIS CLUB 1 » → LAUNAGUET / RACING TENNIS CLUB 1,
 * « TENNIS CLUB GRISOLLES 1 » → GRISOLLES / TENNIS CLUB 1. Aucun mot de club : tout en gros.
 */
export function splitOpponent(raw: string): AnimOpponent {
  const words = raw.trim().toLocaleUpperCase('fr-FR').split(/\s+/).filter(Boolean);
  if (words.length === 0) return { name: 'À DÉTERMINER', sub: '' };
  const isClub = (w: string) => CLUB_WORDS.has(w);
  let start = 0;
  while (start < words.length && isClub(words[start])) start++;
  let end = start;
  while (end < words.length && !isClub(words[end])) end++;
  // Numéro d'équipe final (« … 1 ») : il reste dans le sous-titre.
  if (end === words.length && end - start > 1 && /^\d+$/.test(words[end - 1])) end--;
  if (end === start) return { name: words.join(' '), sub: '' };
  return { name: words.slice(start, end).join(' '), sub: [...words.slice(0, start), ...words.slice(end)].join(' ') };
}

/** Rencontre de l'affiche (`TeamMatch`) → données d'une carte. */
export function toAnimRencontre(m: TeamMatch): AnimRencontre {
  return {
    time: m.time ? formatHeure(m.time) : '',
    comp: m.competitionName.trim(),
    tag: `${GENRE_LABELS[m.gender] ?? m.gender} · ${formatCategorie(m.ageCategory)}`.toLocaleUpperCase('fr-FR'),
    team: `ÉQUIPE ${m.teamNumber}`,
    opp: splitOpponent(m.opponent),
    home: m.location === 'home',
  };
}

/** `matches` : les rencontres de l'affiche, par date croissante. */
export function buildRencontresTimeline(matches: TeamMatch[]): RencontresTimeline {
  const W = 1080, H = 1920, OY = 250;
  const days: AnimDay[] = [];
  for (const tm of matches) {
    let d = days.find((x) => x.date === tm.date);
    if (!d) {
      d = { date: tm.date, ...dayParts(tm.date), hours: '', matches: [], start: 0, hit: 0, compact: 0, end: 0 };
      days.push(d);
    }
    d.matches.push(toAnimRencontre(tm));
  }

  const all = days.flatMap((d) => d.matches);
  const nHome = all.filter((m) => m.home).length;
  const cards: RencontreCard[] = [], wipes: number[] = [];
  let screens = 0;
  let t = 0.9;
  days.forEach((d, di) => {
    d.hours = [...new Set(d.matches.map((m) => m.time).filter(Boolean))].join(' · ');
    d.start = t;
    d.hit = t + 0.5;
    d.compact = t + 2.0;
    if (di > 0) wipes.push(t);
    t += 2.3;
    // 3 cartes max par écran, répartition équilibrée (4 → 2+2, 5 → 3+2)
    const k = Math.ceil(d.matches.length / MAX_PER_SCREEN);
    let i = 0;
    for (let s = 0; s < k; s++) {
      const n = Math.ceil((d.matches.length - i) / (k - s)), ms = d.matches.slice(i, i + n);
      i += n;
      if (s > 0) {
        wipes.push(t);
        t += 0.3;
      }
      const CH = n >= 3 ? 320 : 400, top0 = AREA_TOP + (AREA_BOTTOM - AREA_TOP - (n * CH + (n - 1) * GAP)) / 2;
      // Tenue une fois la dernière carte retournée : 1,65 s + 1 s par carte (2,65 s à 1 carte,
      // 4,65 s à 3). Raccourcie le 13/11/2026 (la skill tenait 2 s de plus par écran à 3 cartes).
      const dur = (n - 1) * BEAT + 1.5 + 1.0 * n + 1.0, end = t + dur;
      ms.forEach((m, mi) => {
        const st = t + mi * BEAT;
        cards.push({ key: cards.length, m, s: st, impact: st + 0.6, flip: st + 0.85, top: top0 + mi * (CH + GAP), CH, side: mi % 2 ? 'R' : 'L', out: end - 0.4 + mi * 0.06 });
      });
      screens++;
      t = end;
    }
    d.end = t;
  });

  // Récap : seulement si les rencontres occupent plusieurs écrans
  let recap: Recap | null = null;
  if (screens > 1) {
    wipes.push(t);
    const rows0 = t + 0.5, badges = rows0 + 0.2 * all.length + 0.3;
    const fixed = days.length * (RECAP_HEAD + RECAP_DAY_GAP);
    const step = Math.min(RECAP_ROW + RECAP_GAP, (RECAP_BOTTOM - RECAP_TOP - fixed) / Math.max(1, all.length));
    const items: RecapItem[] = [];
    let y = RECAP_TOP, idx = 0;
    for (const d of days) {
      items.push({ type: 'head', day: d, y, at: rows0 - 0.2 + 0.2 * idx });
      y += RECAP_HEAD;
      for (const m of d.matches) {
        items.push({ type: 'row', m, y, i: idx++ });
        y += step;
      }
      y += RECAP_DAY_GAP;
    }
    recap = { start: t, rows0, badges, end: badges + 5.0, rowH: step - RECAP_GAP, items };
    t = recap.end;
  }

  const end = t;
  wipes.push(end);
  const partners = end + 0.7, outro = end + 4.2, total = outro + 0.5;
  const impacts: RencontresImpact[] = [
    ...days.map((d) => ({ t: d.hit, x: 540, y: 1000, big: true })),
    ...cards.map((c) => ({ t: c.impact, x: 540, y: c.top + c.CH * 0.6, big: false })),
    { t: end + 0.55, x: 540, y: 980, big: true },
  ];
  return { W, H, OY, days, cards, wipes, recap, end, partners, outro, total, impacts, nHome, nAway: all.length - nHome };
}

/**
 * Story Facebook : la story en une ou plusieurs parties de `maxSeconds` au plus, coupées entre
 * deux écrans (mêmes écrans que `buildRencontresTimeline` : un jour, 3 rencontres au plus,
 * répartition équilibrée). Chaque partie est une story complète : une partie d'un seul écran n'a
 * pas de récap, celle de plusieurs écrans récapitule les siens.
 */
export function buildRencontresStoryParts(matches: TeamMatch[], maxSeconds = STORY_MAX_SECONDS): RencontresTimeline[] {
  const days: TeamMatch[][] = [];
  for (const tm of matches) {
    const d = days.find((x) => x[0].date === tm.date);
    if (d) d.push(tm);
    else days.push([tm]);
  }
  const screens = days.flatMap((d) => {
    const k = Math.ceil(d.length / MAX_PER_SCREEN), out: TeamMatch[][] = [];
    for (let s = 0, i = 0; s < k; s++) {
      const n = Math.ceil((d.length - i) / (k - s));
      out.push(d.slice(i, (i += n)));
    }
    return out;
  });
  const part = (i: number, j: number) => buildRencontresTimeline(screens.slice(i, j).flat());
  const parts = splitStoryParts(screens.length, (i, j) => part(i, j).total, maxSeconds);
  return parts.length ? parts.map(([i, j]) => part(i, j)) : [buildRencontresTimeline(matches)];
}
