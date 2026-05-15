interface SegmentedOption<T extends string> {
  value: T;
  label: string;
  icon?: string;
}

interface SegmentedProps<T extends string> {
  value: T;
  onChange: (v: T) => void;
  options: ReadonlyArray<T | SegmentedOption<T>>;
}

export default function Segmented<T extends string>({ value, onChange, options }: SegmentedProps<T>) {
  return (
    <div className="inline-flex w-fit gap-0.5 rounded-lg bg-muted p-0.5">
      {options.map((o) => {
        const v = (typeof o === 'string' ? o : o.value) as T;
        const label = typeof o === 'string' ? o : o.label;
        const icon = typeof o === 'object' ? o.icon : null;
        const active = value === v;
        return (
          <button
            key={v}
            type="button"
            onClick={() => onChange(v)}
            className={
              'inline-flex items-center gap-1.5 whitespace-nowrap rounded-md px-3 py-1.5 text-xs transition ' +
              (active
                ? 'bg-card font-bold text-foreground shadow-sm'
                : 'font-medium text-muted-foreground hover:text-foreground')
            }
          >
            {icon && <span className="text-sm">{icon}</span>}
            {label}
          </button>
        );
      })}
    </div>
  );
}
