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
    <div className="bg-card border-b border-border/60 px-4 flex gap-6 sticky top-0 z-10">
      {items.map((it) => {
        const on = tab === it.key;
        return (
          <button
            key={it.key}
            type="button"
            onClick={() => onChange(it.key)}
            className={`relative py-3 text-base tracking-tight ${
              on ? 'font-extrabold text-foreground' : 'font-semibold text-muted-foreground'
            }`}
          >
            {it.label}
            {on && (
              <span className="absolute left-0 right-0 -bottom-px h-[3px] bg-primary rounded-sm" />
            )}
          </button>
        );
      })}
    </div>
  );
}
