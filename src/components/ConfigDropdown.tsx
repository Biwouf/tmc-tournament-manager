import { useState, useRef, useEffect } from 'react';
import type { GlobalConfig } from '../types';
import ConfigurationForm from './ConfigurationForm';

interface Props {
  config: GlobalConfig;
  onUpdate: (config: GlobalConfig) => void;
}

export default function ConfigDropdown({ config, onUpdate }: Props) {
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState(false);
  const panelRef = useRef<HTMLDivElement>(null);

  // Close panel when clicking outside
  useEffect(() => {
    function handleClickOutside(e: MouseEvent) {
      if (panelRef.current && !panelRef.current.contains(e.target as Node)) {
        setOpen(false);
        setEditing(false);
      }
    }
    if (open) document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [open]);

  const handleUpdate = (newConfig: GlobalConfig) => {
    onUpdate(newConfig);
    setOpen(false);
    setEditing(false);
  };

  const formatDate = (dateStr: string) =>
    new Date(dateStr).toLocaleDateString('fr-FR', {
      day: '2-digit',
      month: '2-digit',
      year: 'numeric',
    });

  return (
    <div className="relative" ref={panelRef}>
      {/* Trigger button */}
      <button
        onClick={() => { setOpen((o) => !o); setEditing(false); }}
        className="flex items-center gap-2 rounded-lg border border-border bg-card px-4 py-2 text-sm font-medium text-card-foreground shadow-sm transition hover:bg-muted"
      >
        <svg className="h-4 w-4 text-muted-foreground" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
            d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z" />
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
        </svg>
        Configuration
        <svg className={`h-4 w-4 transition-transform ${open ? 'rotate-180' : ''}`} fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
        </svg>
      </button>

      {/* Dropdown panel */}
      {open && (
        <div className="absolute right-0 top-full z-50 mt-2 rounded-xl border border-border bg-popover text-popover-foreground shadow-xl"
          style={{ width: editing ? '900px' : '420px', maxHeight: '80vh', overflowY: 'auto' }}>

          {!editing ? (
            /* ── Summary view ── */
            <div className="p-5">
              <div className="flex justify-between items-center mb-4">
                <h3 className="text-lg font-semibold text-foreground">Configuration actuelle</h3>
                <button
                  onClick={() => setEditing(true)}
                  className="rounded-lg bg-primary px-4 py-1.5 text-sm font-medium text-primary-foreground transition hover:brightness-95"
                >
                  Modifier
                </button>
              </div>

              {/* Dates & courts */}
              <div className="mb-3 space-y-1.5 rounded-lg border border-border/70 bg-muted/50 p-3 text-sm">
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Période</span>
                  <span className="font-medium text-foreground">{formatDate(config.startDate)} → {formatDate(config.endDate)}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Courts</span>
                  <span className="font-medium text-foreground">{config.numberOfCourts}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Durée d'un match</span>
                  <span className="font-medium text-foreground">{config.matchDuration} min</span>
                </div>
              </div>

              {/* Daily slots */}
              <div className="mb-3">
                <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">Créneaux horaires</p>
                <div className="space-y-1">
                  {config.dailyTimeSlots.map((slot, i) => (
                    <div key={i} className="flex items-center justify-between rounded border border-border/70 bg-muted/50 px-3 py-1.5 text-sm">
                      <span className="text-foreground">{formatDate(slot.date)}</span>
                      <span className="text-muted-foreground">{slot.firstMatchStart} – {slot.lastMatchStart}</span>
                    </div>
                  ))}
                </div>
              </div>

              {/* Tournaments */}
              <div>
                <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">Tournois ({config.tournaments.length})</p>
                <div className="space-y-1">
                  {config.tournaments.map((t, i) => (
                    <div key={t.id} className="flex items-center justify-between rounded border border-border/70 bg-muted/50 px-3 py-1.5 text-sm">
                      <span className="font-medium text-foreground">
                        T{i + 1} — {t.gender === 'homme' ? 'Hommes' : 'Femmes'}, {t.numberOfPlayers} joueurs
                      </span>
                      <span className="text-xs text-muted-foreground">{t.minRanking} → {t.maxRanking}</span>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          ) : (
            /* ── Edit view ── */
            <div className="p-5">
              <div className="flex justify-between items-center mb-4">
                <h3 className="text-lg font-semibold text-foreground">Modifier la configuration</h3>
                <button
                  onClick={() => setEditing(false)}
                  className="rounded-lg border border-border px-3 py-1.5 text-sm font-medium text-muted-foreground transition hover:bg-muted hover:text-foreground"
                >
                  Annuler
                </button>
              </div>
              <ConfigurationForm
                initialConfig={config}
                onSubmit={handleUpdate}
              />
            </div>
          )}
        </div>
      )}
    </div>
  );
}
