import { useSyncExternalStore } from 'react';
import type { TeamMatch } from '../../types';

// SaaS S7 — l'étape « Vos affiches » montre son affiche dans l'aperçu, à la place du téléphone.
// Comme `teamsSignal.ts` en S6 : l'étape et son aperçu sont deux composants que le cadre monte
// séparément, et ce petit état partagé leur évite de retoucher le cadre.

export type PosterPreviewState = {
  matches: TeamMatch[];
  background?: string;
  color: string;
  partnerLogos: string[];
  /** Affiche générée : le téléphone revient, avec l'onglet Actu. */
  generated: boolean;
  /** Incrémenté à chaque publication en actu : le téléphone relit les actus. */
  published: number;
};

const EMPTY: PosterPreviewState = { matches: [], color: '', partnerLogos: [], generated: false, published: 0 };
let state = EMPTY;
const listeners = new Set<() => void>();

export function setPosterPreview(change: Partial<PosterPreviewState> | null): void {
  state = change === null ? EMPTY : { ...state, ...change };
  listeners.forEach((listener) => listener());
}

export function usePosterPreview(): PosterPreviewState {
  return useSyncExternalStore(
    (listener) => { listeners.add(listener); return () => { listeners.delete(listener); }; },
    () => state,
  );
}
