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
};

const EMPTY: PosterPreviewState = { matches: [], color: '', partnerLogos: [] };
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

// W1 — l'aperçu animé de la story vit dans l'étape (lecteur, encodage, partage) mais s'affiche à
// droite sur grand écran (maquette `05d`) : l'aperçu y pose un emplacement, l'étape y rend son
// lecteur par un portail. Sur petit écran, le lecteur reste dans l'étape (maquette `05a`).
let slot: HTMLElement | null = null;
const slotListeners = new Set<() => void>();

export function setStorySlot(node: HTMLElement | null): void {
  if (slot === node) return;
  slot = node;
  slotListeners.forEach((listener) => listener());
}

export function useStorySlot(): HTMLElement | null {
  return useSyncExternalStore(
    (listener) => { slotListeners.add(listener); return () => { slotListeners.delete(listener); }; },
    () => slot,
  );
}

/** Vrai tant que `query` correspond (faux sans `matchMedia`, comme sous jsdom). */
export function useMediaQuery(query: string): boolean {
  return useSyncExternalStore(
    (listener) => {
      const list = window.matchMedia?.(query);
      list?.addEventListener?.('change', listener);
      return () => list?.removeEventListener?.('change', listener);
    },
    () => window.matchMedia?.(query).matches ?? false,
  );
}
