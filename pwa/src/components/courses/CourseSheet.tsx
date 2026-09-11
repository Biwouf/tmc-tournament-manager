import { useEffect, useId, useRef, type ReactNode } from 'react';
import { createPortal } from 'react-dom';

export default function CourseSheet({
  title,
  onClose,
  children,
  busy = false,
}: {
  title: string;
  onClose: () => void;
  children: ReactNode;
  busy?: boolean;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  const titleId = useId();
  useEffect(() => {
    const dialog = ref.current;
    const trigger = document.activeElement as HTMLElement | null;
    dialog?.showModal();
    const content = document.querySelector<HTMLElement>('.pwa-content');
    const overflow = content?.style.overflow;
    if (content) content.style.overflow = 'hidden';
    return () => {
      dialog?.close();
      if (content) content.style.overflow = overflow ?? '';
      if (trigger?.isConnected) trigger.focus();
    };
  }, []);
  return createPortal(
    <dialog
      className="booking-sheet"
      ref={ref}
      aria-labelledby={titleId}
      onCancel={(e) => {
        e.preventDefault();
        if (!busy) onClose();
      }}
      onClick={(e) => {
        if (e.target === e.currentTarget && !busy) onClose();
      }}
    >
      <div className="booking-sheet-body">
        <div className="booking-handle" />
        <div className="booking-sheet-heading">
          <h2 id={titleId}>{title}</h2>
          <button
            className="booking-close"
            aria-label="Fermer"
            onClick={onClose}
            disabled={busy}
          >
            ×
          </button>
        </div>
        {children}
      </div>
    </dialog>,
    document.body,
  );
}
