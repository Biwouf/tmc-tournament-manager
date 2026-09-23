import { useEffect, useRef, type ReactNode } from 'react';
import { createPortal } from 'react-dom';

export default function TeamSheet({ title, children, onClose, busy = false }: {
  title: string; children: ReactNode; onClose: () => void; busy?: boolean;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const dialog = ref.current!;
    dialog.showModal();
    return () => dialog.close();
  }, []);
  return createPortal(<dialog ref={ref} onCancel={event => { event.preventDefault(); if (!busy) onClose(); }}
    aria-label={title}
    className="fixed inset-x-0 bottom-0 top-auto m-0 max-h-[90dvh] w-full max-w-none overflow-y-auto rounded-t-3xl bg-card p-5 text-foreground shadow-xl backdrop:bg-black/50 sm:inset-0 sm:m-auto sm:max-w-lg sm:rounded-2xl"
    style={{ paddingBottom: 'max(1.25rem, env(safe-area-inset-bottom))' }}>
    <div className="mb-4 flex items-center justify-between gap-3">
      <h2 className="text-lg font-bold">{title}</h2>
      <button type="button" disabled={busy} onClick={onClose} className="min-h-11 min-w-11 rounded-lg border border-border px-3" aria-label="Fermer">✕</button>
    </div>
    {children}
  </dialog>, document.body);
}
