import { useLocation, useNavigate, type Location } from 'react-router-dom';
import { returnPath } from './headerConfig';

// State to put on every in-app link to a sub-page, so its Back returns here. `fromIdx` is the
// history index of the origin: Back only steps back when the origin is the previous entry.
export function fromHere(location: Pick<Location, 'pathname' | 'search'>): { from: string; fromIdx: number } {
  return { from: `${location.pathname}${location.search}`, fromIdx: window.history.state?.idx ?? 0 };
}

// Origin passed by the link that opened the current page, if it is a safe internal path.
export function useBackOrigin(): string | null {
  const location = useLocation();
  return returnPath((location.state as { from?: string } | null)?.from);
}

// Back = the page that opened this one when known, else the declared parent. Step back only
// when this entry directly follows the origin (no duplicate entry, never the wrong page);
// otherwise (deep link, replaced entry) replace this entry with the origin.
export function useGoBack(parent: string): () => void {
  const navigate = useNavigate();
  const location = useLocation();
  const from = useBackOrigin();
  const originIdx = (location.state as { fromIdx?: number } | null)?.fromIdx;
  return () => {
    if (!from) navigate(parent);
    else if (originIdx !== undefined && (window.history.state?.idx ?? 0) === originIdx + 1) navigate(-1);
    else navigate(from, { replace: true });
  };
}

// Label of the back button for a known origin (« Live », « Équipes »…).
export function originLabel(from: string | null): string | null {
  if (!from) return null;
  if (/^\/matches-equipes(?:[/?#]|$)/.test(from)) return /^\/matches-equipes\/[^/?#]/.test(from) ? 'Rencontre' : 'Équipes';
  if (/^\/matches(?:[/?#]|$)/.test(from)) return 'Live';
  if (/^\/(?:actu|actus|evenements)(?:[/?#]|$)/.test(from)) return 'Actualités';
  if (/^\/cours(?:[/?#]|$)/.test(from)) return 'Cours';
  return null;
}
