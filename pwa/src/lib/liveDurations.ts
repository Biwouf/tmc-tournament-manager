import type { LiveMatch } from '../types';
import { getNormalSetWinner, getSet, isSet3Needed } from '../liveScoreRules';

function span(from: string | null | undefined, to: string | null | undefined) {
  if (!from || !to) return null;
  return Math.max(0, Date.parse(to) - Date.parse(from));
}

// Durées en ms du match et des sets 1 à 3 ; null quand l'horodatage manque (match antérieur aux heures de fin de set).
export function liveDurations(m: LiveMatch, now: string) {
  const end = m.finished_at ?? (m.status === 'live' ? now : null);
  const won1 = getNormalSetWinner(getSet(m, 1)) !== null;
  const won2 = getNormalSetWinner(getSet(m, 2)) !== null;
  return {
    match: span(m.started_at, end),
    sets: [
      span(m.started_at, won1 ? m.set1_ended_at : end),
      won1 ? span(m.set1_ended_at, won2 ? m.set2_ended_at : end) : null,
      won1 && won2 && isSet3Needed(m) ? span(m.set2_ended_at, end) : null,
    ],
  };
}

// compact : sous chaque colonne de set (42′, 1h05) ; sinon 42 min, 1 h 05.
export function formatDuration(ms: number, compact = false) {
  const minutes = Math.floor(ms / 60_000);
  if (minutes < 60) return compact ? `${minutes}′` : `${minutes} min`;
  const rest = String(minutes % 60).padStart(2, '0');
  return compact ? `${Math.floor(minutes / 60)}h${rest}` : `${Math.floor(minutes / 60)} h ${rest}`;
}
