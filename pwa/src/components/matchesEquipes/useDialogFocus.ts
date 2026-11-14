import { useEffect, useRef, type RefObject } from 'react';

// Hors tabulation (`tabindex="-1"`, ex. le voile cliquable d'une feuille) : jamais ciblé.
const FOCUSABLE = ':is(a[href], button:not([disabled]), input, select, textarea, [tabindex]):not([tabindex="-1"])';

/**
 * Dialogue modal : focus sur le premier élément, Tab reste dans le dialogue, Échap ferme,
 * le focus revient sur le bouton d'ouverture à la fermeture. `opener` sert quand ce bouton a
 * perdu le focus avant l'ouverture (bouton désactivé pendant un chargement).
 */
export function useDialogFocus(
  ref: RefObject<HTMLElement | null>,
  onClose: () => void,
  open = true,
  opener?: RefObject<HTMLElement | null>,
) {
  const closeRef = useRef(onClose);
  useEffect(() => {
    closeRef.current = onClose;
  });

  useEffect(() => {
    const node = ref.current;
    if (!open || !node) return;
    const previous = opener?.current ?? (document.activeElement as HTMLElement | null);
    node.querySelector<HTMLElement>(FOCUSABLE)?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') return closeRef.current();
      if (e.key !== 'Tab') return;
      const items = [...node.querySelectorAll<HTMLElement>(FOCUSABLE)];
      if (!items.length) return;
      const first = items[0];
      const last = items[items.length - 1];
      if (e.shiftKey && document.activeElement === first) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && document.activeElement === last) {
        e.preventDefault();
        first.focus();
      }
    };
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('keydown', onKey);
      previous?.focus();
    };
  }, [ref, open, opener]);
}
