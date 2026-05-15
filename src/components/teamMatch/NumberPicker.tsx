interface NumberPickerProps {
  value: 1 | 2 | 3;
  onChange: (v: 1 | 2 | 3) => void;
  max?: 1 | 2 | 3;
}

export default function NumberPicker({ value, onChange, max = 3 }: NumberPickerProps) {
  return (
    <div className="inline-flex gap-1.5">
      {Array.from({ length: max }).map((_, i) => {
        const n = (i + 1) as 1 | 2 | 3;
        const active = value === n;
        return (
          <button
            key={n}
            type="button"
            onClick={() => onChange(n)}
            className={
              'h-9 w-9 rounded-lg text-sm font-bold transition ' +
              (active
                ? 'border-[1.5px] border-primary bg-primary text-primary-foreground'
                : 'border border-border bg-card text-foreground hover:bg-muted')
            }
          >
            {n}
          </button>
        );
      })}
    </div>
  );
}
