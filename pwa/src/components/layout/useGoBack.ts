import { useLocation, useNavigate, type Location } from 'react-router-dom';
import { returnPath } from './headerConfig';

// State to put on every in-app link to a sub-page, so its Back returns here.
export function fromHere(location: Pick<Location, 'pathname' | 'search'>): { from: string } {
  return { from: `${location.pathname}${location.search}` };
}

// Origin passed by the link that opened the current page, if it is a safe internal path.
export function useBackOrigin(): string | null {
  const location = useLocation();
  return returnPath((location.state as { from?: string } | null)?.from);
}

// Back = the page that opened this one when known (history step, so no duplicate entry),
// else the declared parent.
export function useGoBack(parent: string): () => void {
  const navigate = useNavigate();
  const from = useBackOrigin();
  return () => {
    if (!from) navigate(parent);
    else if ((window.history.state?.idx ?? 0) > 0) navigate(-1);
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
