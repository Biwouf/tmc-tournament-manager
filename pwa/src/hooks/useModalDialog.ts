import { useEffect, useRef } from 'react';

/** Ouvre un `<dialog>` en modal tant qu'il est monté ; rend ensuite le focus à l'élément qui l'a ouvert. */
export function useModalDialog() {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const dialog = ref.current!;
    const trigger = document.activeElement as HTMLElement | null;
    dialog.showModal();
    return () => {
      dialog.close();
      if (trigger?.isConnected) trigger.focus();
    };
  }, []);
  return ref;
}
