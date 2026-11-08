import { useSyncExternalStore } from 'react';

// SaaS S6 — l'étape « Vos équipes » prévient son aperçu qu'une équipe vient d'être créée. Le cadre
// ne relance l'aperçu qu'à la complétion d'une étape (`version`) ; ici une équipe ajoutée ne
// termine pas l'étape, d'où ce signal propre aux deux composants, sans retoucher le cadre.

let version = 0;
const listeners = new Set<() => void>();

export function notifyTeamsChanged(): void {
  version += 1;
  listeners.forEach((listener) => listener());
}

export function useTeamsVersion(): number {
  return useSyncExternalStore(
    (listener) => { listeners.add(listener); return () => { listeners.delete(listener); }; },
    () => version,
  );
}
