import type { ReactNode } from 'react';

interface Props {
  saisonLabel: string;
  equipeLabel: string;
  onOpenSaison: () => void;
  onOpenEquipe: () => void;
  /** Bouton « Calendrier », à droite des filtres (connecté uniquement). */
  calendar?: ReactNode;
  upcomingTab: 'upcoming' | 'past';
  onUpcomingTabChange: (t: 'upcoming' | 'past') => void;
  /** Compteurs absents tant que les rencontres chargent. */
  upcomingCount?: number;
  pastCount?: number;
}

function ChevronDown() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" aria-hidden="true">
      <path d="M6 9l6 6 6-6" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

export default function MatchEquipeFilterBar({
  saisonLabel,
  equipeLabel,
  onOpenSaison,
  onOpenEquipe,
  calendar,
  upcomingTab,
  onUpcomingTabChange,
  upcomingCount,
  pastCount,
}: Props) {
  return (
    <div className="pb-1">
      <div className="me-toolbar">
        <button type="button" onClick={onOpenSaison} className="me-tool" aria-haspopup="dialog">
          <span className="lbl">Saison</span>
          <span className="val">{saisonLabel}</span>
          <ChevronDown />
        </button>
        <button type="button" onClick={onOpenEquipe} className="me-tool" aria-haspopup="dialog">
          <span className="lbl">Équipe</span>
          <span className="val">{equipeLabel}</span>
          <ChevronDown />
        </button>
        {calendar}
      </div>

      <div className="me-seg" role="tablist" aria-label="Période">
        {(
          [
            ['upcoming', 'À venir', upcomingCount],
            ['past', 'Passés', pastCount],
          ] as const
        ).map(([key, label, count]) => (
          <button
            key={key}
            type="button"
            role="tab"
            aria-selected={upcomingTab === key}
            onClick={() => onUpcomingTabChange(key)}
          >
            {label}
            {count !== undefined && <span className="me-count">{count}</span>}
          </button>
        ))}
      </div>
    </div>
  );
}
