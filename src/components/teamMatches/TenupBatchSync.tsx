import { useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { supabase } from '../../lib/supabase';
import { useClub } from '../../contexts/ClubContext';
import { useLocalStorage } from '../../hooks/useLocalStorage';
import { tenupClient } from '../../../shared/tenupClient';
import type { RencontreEntry } from './gridTypes';
import {
  TENUP_BATCH_DAYS,
  runTenupBatch,
  tenupBatchCandidates,
  type TenupBatchStatus,
} from './tenupBatch';

type Row = { entry: RencontreEntry; status: TenupBatchStatus; message?: string };

const STATUS_LABELS: Record<TenupBatchStatus, string> = {
  pending: 'En attente',
  running: 'En cours…',
  imported: 'Importée',
  failed: 'Non importée',
  cancelled: 'Annulée',
};
const STATUS_CLASSES: Record<TenupBatchStatus, string> = {
  pending: 'text-muted-foreground',
  running: 'text-primary',
  imported: 'text-score-win-fg',
  failed: 'text-score-loss-fg',
  cancelled: 'text-muted-foreground',
};
// Fond animé (index.css) : balayage pendant l'import, remplissage à l'issue.
const ROW_CLASSES: Record<TenupBatchStatus, string> = {
  pending: '',
  running: 'tenup-row-running',
  imported: 'tenup-row-imported',
  failed: 'tenup-row-failed',
  cancelled: 'opacity-60',
};

/** Synchronise d'un coup les rencontres Ten'Up récentes de la saison affichée. */
export default function TenupBatchSync({
  entries,
  onDone,
  className,
}: {
  entries: RencontreEntry[];
  onDone: () => void;
  className: string;
}) {
  const { clubId } = useClub();
  const [open, setOpen] = useState(false);
  const [days, setDays] = useLocalStorage<number>(
    `tmc:${clubId}:team-matches:tenup-days`,
    TENUP_BATCH_DAYS.default
  );
  // Liste figée au lancement : le rechargement de la grille ne la modifie pas.
  const [rows, setRows] = useState<Row[] | null>(null);
  const [running, setRunning] = useState(false);
  const stopRef = useRef(false);

  const candidates = tenupBatchCandidates(entries, days);
  const shown: Row[] = rows ?? candidates.map((entry) => ({ entry, status: 'pending' }));

  const start = async () => {
    if (running || !clubId || candidates.length === 0) return;
    stopRef.current = false;
    setRunning(true);
    setRows(candidates.map((entry) => ({ entry, status: 'pending' })));
    await runTenupBatch(
      candidates.map(({ rencontre: r }) => ({ id: r.id, url: r.tenup_url!, side: r.tenup_side! })),
      {
        clientFor: (id) => tenupClient(supabase, clubId, id),
        shouldStop: () => stopRef.current,
        onUpdate: (id, status, message) =>
          setRows((prev) =>
            prev?.map((row) => (row.entry.rencontre.id === id ? { ...row, status, message } : row)) ?? prev
          ),
      }
    );
    setRunning(false);
    onDone();
  };

  const close = () => {
    if (running) return;
    setOpen(false);
    setRows(null);
  };

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className={className}
      >
        Synchroniser Ten’Up
      </button>
      {/* Hors du menu d'actions, qui se referme au clic. */}
      {open && createPortal(
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
          <div
            role="dialog"
            aria-modal="true"
            aria-labelledby="tenup-batch-title"
            className="max-h-[90vh] w-full max-w-2xl overflow-y-auto rounded-2xl border bg-card p-6 shadow-xl"
          >
            <h3 id="tenup-batch-title" className="mb-2 text-lg font-semibold">
              Synchroniser les rencontres récentes
            </h3>
            <p className="mb-4 text-sm text-muted-foreground">
              Rencontres créées depuis Ten’Up et pas encore synchronisées. Ten’Up fait foi :
              compositions, scores, date et adversaire déjà saisis (y compris en live) seront
              remplacés. Comptez environ 20 secondes par rencontre.
            </p>
            <label className="mb-4 flex items-center gap-2 text-sm font-medium">
              Rencontres des
              <input
                type="number"
                min={TENUP_BATCH_DAYS.min}
                max={TENUP_BATCH_DAYS.max}
                value={days}
                disabled={running || rows !== null}
                onChange={(e) => {
                  const value = Math.round(Number(e.target.value));
                  if (value >= TENUP_BATCH_DAYS.min && value <= TENUP_BATCH_DAYS.max) setDays(value);
                }}
                className="w-20 rounded-lg border border-border bg-background px-3 py-2 text-sm"
              />
              derniers jours
            </label>

            {shown.length === 0 ? (
              <p className="rounded-lg border border-dashed border-border p-4 text-center text-sm text-muted-foreground">
                Aucune rencontre à synchroniser sur cette période.
              </p>
            ) : (
              <ul className="space-y-2">
                {shown.map(({ entry: { rencontre, equipe, competition }, status, message }) => (
                  <li
                    key={rencontre.id}
                    className={`rounded-lg border border-border p-3 text-sm transition-colors ${ROW_CLASSES[status]}`}
                  >
                    <div className="flex flex-wrap items-baseline justify-between gap-2">
                      <span className="font-medium">
                        {competition.nom} · Éq. {equipe.numero} — {rencontre.club_adverse}
                      </span>
                      <span className={`text-xs font-semibold ${STATUS_CLASSES[status]}`}>
                        {STATUS_LABELS[status]}
                      </span>
                    </div>
                    <p className="text-xs text-muted-foreground">
                      {new Date(rencontre.date_heure).toLocaleDateString('fr-FR', {
                        timeZone: 'Europe/Paris',
                      })}
                      {message ? ` · ${message}` : ''}
                    </p>
                  </li>
                ))}
              </ul>
            )}

            <div className="mt-6 flex flex-wrap justify-end gap-3">
              {running ? (
                <button
                  type="button"
                  onClick={() => (stopRef.current = true)}
                  className="rounded-lg border border-border px-4 py-2 text-sm font-medium hover:bg-muted"
                >
                  Arrêter après la rencontre en cours
                </button>
              ) : (
                <button
                  type="button"
                  onClick={close}
                  className="rounded-lg border border-border px-4 py-2 text-sm font-medium hover:bg-muted"
                >
                  Fermer
                </button>
              )}
              {rows === null && (
                <button
                  type="button"
                  onClick={() => void start()}
                  disabled={candidates.length === 0}
                  className="rounded-lg bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground disabled:opacity-50"
                >
                  Importer les résultats ({candidates.length})
                </button>
              )}
            </div>
          </div>
        </div>,
        document.body
      )}
    </>
  );
}
