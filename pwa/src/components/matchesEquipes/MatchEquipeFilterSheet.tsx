export interface SheetOption {
  id: string | null;
  label: string;
}

interface Props {
  title: string;
  options: SheetOption[];
  selectedId: string | null;
  onSelect: (id: string | null) => void;
  onClose: () => void;
}

export default function MatchEquipeFilterSheet({ title, options, selectedId, onSelect, onClose }: Props) {
  return (
    <div className="fixed inset-0 z-[60] flex flex-col justify-end" role="dialog" aria-modal="true">
      <button
        type="button"
        aria-label="Fermer"
        className="absolute inset-0 bg-black/40"
        onClick={onClose}
      />
      <div
        className="relative bg-card rounded-t-2xl border-t border-border max-h-[70vh] flex flex-col"
        style={{
          paddingBottom: 'env(safe-area-inset-bottom)',
          animation: 'sheet-up 0.2s ease',
        }}
      >
        <style>{`@keyframes sheet-up { from { transform: translateY(100%); } to { transform: translateY(0); } }`}</style>
        <div className="flex items-center justify-between px-4 py-3 border-b border-border/60">
          <h3 className="text-base font-extrabold text-foreground">{title}</h3>
          <button
            type="button"
            onClick={onClose}
            aria-label="Fermer"
            className="flex h-8 w-8 items-center justify-center rounded-full text-muted-foreground active:bg-muted"
          >
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="h-5 w-5">
              <path d="M6 6l12 12M18 6 6 18" strokeLinecap="round" />
            </svg>
          </button>
        </div>
        <div className="overflow-y-auto py-1">
          {options.map((opt) => {
            const on = opt.id === selectedId;
            return (
              <button
                key={opt.id ?? '__null__'}
                type="button"
                onClick={() => {
                  onSelect(opt.id);
                  onClose();
                }}
                className="flex w-full items-center justify-between gap-3 px-4 py-3 text-left active:bg-muted"
              >
                <span className={`text-sm ${on ? 'font-bold text-primary' : 'font-medium text-foreground'}`}>
                  {opt.label}
                </span>
                {on && (
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" className="h-5 w-5 text-primary shrink-0">
                    <path d="M5 12l5 5 9-11" strokeLinecap="round" strokeLinejoin="round" />
                  </svg>
                )}
              </button>
            );
          })}
        </div>
      </div>
    </div>
  );
}
