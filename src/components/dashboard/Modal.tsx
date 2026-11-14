import { useEffect, useId, useRef, type ReactNode } from 'react';
import { createPortal } from 'react-dom';

// SaaS S8 — fenêtre du tableau de bord (publier, mot de passe, partager) : même rendu que
// `TenupBatchSync`, plus Échap, focus sur le premier champ ou bouton, et focus rendu à la fermeture.
export default function Modal({ title, onClose, children }: { title: string; onClose: () => void; children: ReactNode }) {
  const titleId = useId();
  const box = useRef<HTMLDivElement>(null);
  const close = useRef(onClose);
  useEffect(() => { close.current = onClose; });

  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null;
    box.current?.querySelector<HTMLElement>('input, textarea, button:not([disabled])')?.focus();
    const onKey = (event: KeyboardEvent) => { if (event.key === 'Escape') close.current(); };
    document.addEventListener('keydown', onKey);
    return () => { document.removeEventListener('keydown', onKey); previous?.focus?.(); };
  }, []);

  return createPortal(
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div ref={box} role="dialog" aria-modal="true" aria-labelledby={titleId}
        className="max-h-[90vh] w-full max-w-md overflow-y-auto rounded-2xl border bg-card p-6 text-card-foreground shadow-xl">
        <h3 id={titleId} className="mb-2 text-lg font-semibold">{title}</h3>
        {children}
      </div>
    </div>,
    document.body,
  );
}
