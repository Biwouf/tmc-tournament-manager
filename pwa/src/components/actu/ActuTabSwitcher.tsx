interface Props {
  tab: 'actus' | 'events';
  onChange: (t: 'actus' | 'events') => void;
}

const items = [
  { key: 'actus', label: 'Actualités' },
  { key: 'events', label: 'Événements' },
] as const;

export default function ActuTabSwitcher({ tab, onChange }: Props) {
  return (
    <div role="tablist" aria-label="Contenu" className="bg-card border-b border-border/60 px-4 flex gap-6 sticky top-0 z-10">
      {items.map((it) => {
        const on = tab === it.key;
        return (
          <button
            key={it.key}
            type="button"
            role="tab"
            aria-selected={on}
            onClick={() => onChange(it.key)}
            className={`relative min-h-11 py-3 text-base tracking-tight ${
              on ? 'font-extrabold text-foreground' : 'font-semibold text-muted-foreground'
            }`}
          >
            {it.label}
            {on && (
              <span aria-hidden="true" className="absolute left-0 right-0 -bottom-px h-[3px] bg-primary rounded-sm" />
            )}
          </button>
        );
      })}
    </div>
  );
}
