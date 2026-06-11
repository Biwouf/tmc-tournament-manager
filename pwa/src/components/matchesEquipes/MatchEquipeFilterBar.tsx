interface Props {
  saisonLabel: string;
  equipeLabel: string;
  equipeActive: boolean;
  onOpenSaison: () => void;
  onOpenEquipe: () => void;
  upcomingTab: 'upcoming' | 'past';
  onUpcomingTabChange: (t: 'upcoming' | 'past') => void;
  upcomingCount: number;
  pastCount: number;
}

function ChevronDown() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" className="h-3.5 w-3.5 shrink-0">
      <path d="M6 9l6 6 6-6" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

export default function MatchEquipeFilterBar({
  saisonLabel,
  equipeLabel,
  equipeActive,
  onOpenSaison,
  onOpenEquipe,
  upcomingTab,
  onUpcomingTabChange,
  upcomingCount,
  pastCount,
}: Props) {
  return (
    <div className="flex flex-col gap-3 px-4 py-3">
      {/* Chips */}
      <div className="flex gap-2">
        <button
          type="button"
          onClick={onOpenSaison}
          className="flex h-[34px] items-center gap-1.5 rounded-full border border-border bg-card px-3 text-sm"
        >
          <span className="text-muted-foreground">Saison</span>
          <span className="font-bold text-foreground">{saisonLabel}</span>
          <ChevronDown />
        </button>
        <button
          type="button"
          onClick={onOpenEquipe}
          className={`flex h-[34px] items-center gap-1.5 rounded-full border px-3 text-sm ${
            equipeActive ? 'border-accent bg-muted text-primary' : 'border-border bg-card'
          }`}
        >
          <span className={equipeActive ? 'text-primary/70' : 'text-muted-foreground'}>Équipe</span>
          <span className={`font-bold ${equipeActive ? 'text-primary' : 'text-foreground'}`}>{equipeLabel}</span>
          <ChevronDown />
        </button>
      </div>

      {/* Segmented à venir / passés */}
      <div className="grid grid-cols-2 gap-1 rounded-xl border border-border bg-card p-1">
        {(
          [
            ['upcoming', 'À venir', upcomingCount],
            ['past', 'Passés', pastCount],
          ] as const
        ).map(([key, label, count]) => {
          const on = upcomingTab === key;
          return (
            <button
              key={key}
              type="button"
              onClick={() => onUpcomingTabChange(key)}
              className={`flex items-center justify-center gap-2 rounded-lg py-2 text-sm font-bold transition-colors ${
                on ? 'bg-foreground text-background' : 'text-muted-foreground'
              }`}
            >
              {label}
              <span
                className={`min-w-[20px] rounded-full px-1.5 text-xs font-bold ${
                  on ? 'bg-white/20 text-background' : 'bg-muted text-muted-foreground'
                }`}
              >
                {count}
              </span>
            </button>
          );
        })}
      </div>
    </div>
  );
}
