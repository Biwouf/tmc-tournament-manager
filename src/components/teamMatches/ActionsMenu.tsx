import { useEffect, useRef, useState, type ReactNode } from 'react';

export const MENU_ITEM_CLASS =
  'block w-full px-4 py-2 text-left text-sm transition hover:bg-muted disabled:opacity-50 disabled:hover:bg-transparent';

/**
 * Menu « ⋮ » des actions d'en-tête. Les entrées restent montées une fois le menu
 * refermé : les fenêtres qu'elles ouvrent (portails) leur survivent.
 */
export default function ActionsMenu({ children }: { children: ReactNode }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onPointer = (e: PointerEvent) => {
      if (!ref.current?.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && setOpen(false);
    document.addEventListener('pointerdown', onPointer);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('pointerdown', onPointer);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  return (
    <div ref={ref} className="relative">
      <button
        type="button"
        aria-label="Autres actions"
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={() => setOpen((v) => !v)}
        className="flex h-9 w-9 items-center justify-center rounded-lg border border-border bg-card transition hover:bg-muted"
      >
        <svg viewBox="0 0 24 24" className="h-5 w-5" fill="currentColor" aria-hidden="true">
          <circle cx="12" cy="5" r="1.8" />
          <circle cx="12" cy="12" r="1.8" />
          <circle cx="12" cy="19" r="1.8" />
        </svg>
      </button>
      <div
        role="menu"
        hidden={!open}
        // Un clic sur une entrée referme le menu (les clics dans un portail remontent
        // aussi ici, sans conséquence : le menu est déjà refermé).
        onClick={() => setOpen(false)}
        className="absolute right-0 z-40 mt-2 min-w-56 overflow-hidden rounded-lg border border-border bg-card py-1 shadow-lg"
      >
        {children}
      </div>
    </div>
  );
}
