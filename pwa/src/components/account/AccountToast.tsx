import { useEffect, useState, type PointerEvent } from 'react';
import { ACCOUNT_COPY as T } from '../../../../shared/accountCopy.mjs';

/** `onEnd` : le toast n'est plus là (délai, remplacé, page quittée, ou « Annuler » touché). */
export type Toast = { text: string; undo?: () => void; onEnd?: () => void };

// Avec « Annuler », plus longtemps : le temps de lire et de toucher le bouton.
const DELAY = 5000;
const UNDO_DELAY = 10000;

/**
 * Message bref, avec « Annuler » au besoin. Au-dessus de la barre d'onglets et du bandeau
 * d'installation (z-index 60). Le délai s'arrête tant que le focus ou la souris est dedans
 * (WCAG 2.2.1) ; un toucher ne le fige jamais. Échap le ferme. La région `role="status"` reste dans le DOM (WCAG 4.1.3).
 */
export default function AccountToast({ toast, onClose }: { toast: Toast | null; onClose: () => void }) {
  const [focused, setFocused] = useState(false);
  const [hovered, setHovered] = useState(false);
  // Un nouveau toast repart sans pause : l'ancien a pu disparaître sans événement de sortie.
  const [shown, setShown] = useState(toast);
  if (shown !== toast) {
    setShown(toast);
    setFocused(false);
    setHovered(false);
  }
  const paused = focused || hovered;
  useEffect(() => {
    if (!toast || paused) return;
    const timer = setTimeout(onClose, toast.undo ? UNDO_DELAY : DELAY);
    return () => clearTimeout(timer);
  }, [toast, paused, onClose]);
  useEffect(() => () => toast?.onEnd?.(), [toast]);
  return (
    <div role="status" aria-live="polite" className="pointer-events-none fixed inset-x-0 z-[70] flex justify-center px-4"
      style={{ bottom: 'calc(56px + var(--install-banner-height, 0px) + 16px + env(safe-area-inset-bottom))' }}>
      {toast && (
        <div className="pointer-events-auto flex min-h-12 max-w-md items-center gap-3 rounded-xl bg-foreground px-4 py-2 text-sm text-background shadow-lg"
          onFocus={() => setFocused(true)} onBlur={() => setFocused(false)}
          onPointerEnter={(event: PointerEvent) => { if (event.pointerType === 'mouse') setHovered(true); }}
          onPointerLeave={(event: PointerEvent) => { if (event.pointerType === 'mouse') setHovered(false); }}
          onKeyDown={event => { if (event.key === 'Escape') onClose(); }}>
          <span>{toast.text}</span>
          {toast.undo && <button type="button" onClick={toast.undo} className="min-h-11 px-2 font-bold underline">{T.undo}</button>}
        </div>
      )}
    </div>
  );
}
