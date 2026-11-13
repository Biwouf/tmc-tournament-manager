import { useMemo, useState } from 'react';
import { toJpeg } from 'html-to-image';
import type { TeamMatch } from '../../../types';
import type { RencontreEntry } from '../gridTypes';
import { currentWeekendRange, formatWeekLabel, isInRange, weekRange, weekendFileDate } from '../weekend';
import { MAX_POSTER_MATCHES, rencontreToTeamMatch } from './posterHelpers';

// Sélection des rencontres et export de l'affiche des rencontres, extraits de `PosterPanel` (SaaS
// S7) pour que l'étape « Vos affiches » des premiers pas présélectionne et exporte exactement
// comme le panneau.

export interface PosterGroupe {
  key: string;
  label: string;
  entries: RencontreEntry[];
}

/**
 * Rencontres de la semaine en cours : le week-end courant EN ENTIER (les rencontres déjà
 * commencées comprises : elles sont présélectionnées, et le dimanche elles disparaissaient de la
 * liste tout en restant cochées) plus les rencontres à venir de la semaine qui le précèdent
 * (11 novembre…), qui tombaient sinon dans « Plus tard ».
 */
export function isCurrentWeek(iso: string, now: Date): boolean {
  if (isInRange(iso, currentWeekendRange(now))) return true;
  return new Date(iso) >= now && isInRange(iso, weekRange(now));
}

/**
 * Rencontres groupées par semaine (lundi → dimanche) : la semaine courante (cf. `isCurrentWeek`),
 * puis les rencontres à venir de la semaine suivante et au-delà.
 */
export function groupByWeek(entries: RencontreEntry[], now: Date): PosterGroupe[] {
  const courante = weekRange(now);
  const suivante = weekRange(new Date(now.getFullYear(), now.getMonth(), now.getDate() + 7));
  const aVenir = entries.filter((e) => new Date(e.rencontre.date_heure) >= now);

  const groupes: PosterGroupe[] = [
    {
      key: 'courant',
      label: `Cette semaine · ${formatWeekLabel(courante)}`,
      entries: entries.filter((e) => isCurrentWeek(e.rencontre.date_heure, now)),
    },
    {
      key: 'suivant',
      label: `Semaine suivante · ${formatWeekLabel(suivante)}`,
      entries: aVenir.filter((e) => isInRange(e.rencontre.date_heure, suivante)),
    },
    {
      key: 'plus-tard',
      label: 'Plus tard',
      entries: aVenir.filter(
        (e) =>
          !isCurrentWeek(e.rencontre.date_heure, now) && !isInRange(e.rencontre.date_heure, suivante)
      ),
    },
  ];
  return groupes.filter((g) => g.entries.length > 0);
}

/** Présélection : la semaine courante (week-end compris), tronquée à 8, par date croissante. */
export function initialPosterSelection(entries: RencontreEntry[], now: Date): string[] {
  return entries
    .filter((e) => isCurrentWeek(e.rencontre.date_heure, now))
    .sort((a, b) => a.rencontre.date_heure.localeCompare(b.rencontre.date_heure))
    .slice(0, MAX_POSTER_MATCHES)
    .map((e) => e.rencontre.id);
}

/** Groupes, présélection, coches (8 au plus) et rencontres converties pour le rendu. */
export function usePosterSelection(entries: RencontreEntry[]) {
  const now = useMemo(() => new Date(), []);
  const groupes = useMemo(() => groupByWeek(entries, now), [entries, now]);
  const weekend = useMemo(() => currentWeekendRange(now), [now]);
  const [selectedIds, setSelectedIds] = useState<string[]>(() => initialPosterSelection(entries, now));

  const selected = useMemo(() => new Set(selectedIds), [selectedIds]);
  const atMax = selectedIds.length >= MAX_POSTER_MATCHES;

  const toggle = (id: string) =>
    setSelectedIds((prev) => {
      if (prev.includes(id)) return prev.filter((x) => x !== id);
      // Au-delà de MAX_POSTER_MATCHES le clic est ignoré.
      return prev.length >= MAX_POSTER_MATCHES ? prev : [...prev, id];
    });

  const takeAll = (groupe: PosterGroupe) =>
    setSelectedIds((prev) => {
      const next = [...prev];
      for (const e of groupe.entries) {
        if (next.length >= MAX_POSTER_MATCHES) break;
        if (!next.includes(e.rencontre.id)) next.push(e.rencontre.id);
      }
      return next;
    });

  const selectedMatches = useMemo<TeamMatch[]>(
    () =>
      entries
        .filter((e) => selected.has(e.rencontre.id))
        .sort((a, b) => a.rencontre.date_heure.localeCompare(b.rencontre.date_heure))
        .map((e) => rencontreToTeamMatch(e.rencontre, e.equipe, e.competition)),
    [entries, selected]
  );

  return { groupes, weekend, selectedIds, selected, atMax, toggle, takeAll, selectedMatches };
}

// toJpeg reste déclenché par une action explicite : à pixelRatio 2 sur une
// A4, l'appeler à chaque coche ferait ramer le panneau.
/** Le JPEG de l'affiche, depuis son nœud monté hors viewport. */
export function exportPosterJpeg(node: HTMLElement): Promise<string> {
  return toJpeg(node, { quality: 0.92, pixelRatio: 2 });
}

/** `affiche-rencontres-<samedi du week-end>.jpg`. */
export function posterFileName(weekend: ReturnType<typeof currentWeekendRange>): string {
  return `affiche-rencontres-${weekendFileDate(weekend)}.jpg`;
}
