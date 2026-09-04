import { useEffect, useMemo, useRef, useState } from 'react';
import { toJpeg } from 'html-to-image';
import { useClubConfig } from '../../../hooks/useClubConfig';
import type { TeamMatch } from '../../../types';
import TeamMatchImagePreview from '../../TeamMatchImagePreview';
import type { RencontreEntry } from '../gridTypes';
import {
  currentWeekendRange,
  formatWeekendLabel,
  isInRange,
  nextWeekendRange,
  weekendFileDate,
  type WeekendRange,
} from '../weekend';
import { MAX_POSTER_MATCHES, formatRencontreDate, rencontreToTeamMatch } from './posterHelpers';

interface Groupe {
  key: string;
  label: string;
  range: WeekendRange | null;
  entries: RencontreEntry[];
}

/** Rencontres à venir groupées par week-end (courant, suivant, puis le reste). */
function groupByWeekend(entries: RencontreEntry[], now: Date): Groupe[] {
  const courant = currentWeekendRange(now);
  const suivant = nextWeekendRange(now);
  const aVenir = entries.filter((e) => new Date(e.rencontre.date_heure) >= now);

  const groupes: Groupe[] = [
    {
      key: 'courant',
      label: `Ce week-end · ${formatWeekendLabel(courant)}`,
      range: courant,
      entries: aVenir.filter((e) => isInRange(e.rencontre.date_heure, courant)),
    },
    {
      key: 'suivant',
      label: `Week-end suivant · ${formatWeekendLabel(suivant)}`,
      range: suivant,
      entries: aVenir.filter((e) => isInRange(e.rencontre.date_heure, suivant)),
    },
    {
      key: 'plus-tard',
      label: 'Plus tard',
      range: null,
      entries: aVenir.filter(
        (e) =>
          !isInRange(e.rencontre.date_heure, courant) && !isInRange(e.rencontre.date_heure, suivant)
      ),
    },
  ];
  return groupes.filter((g) => g.entries.length > 0);
}

export default function PosterPanel({
  entries,
  onClose,
}: {
  entries: RencontreEntry[];
  onClose: () => void;
}) {
  // Le fond d'affiche du club (PR7) est lu ICI et passé en prop : `TeamMatchImagePreview` est
  // monté deux fois plus bas (aperçu réduit + nœud d'export hors viewport), et le hook n'a
  // aucune raison de tourner deux fois sur le même écran.
  const { config } = useClubConfig();
  const now = useMemo(() => new Date(), []);
  const groupes = useMemo(() => groupByWeekend(entries, now), [entries, now]);
  const weekend = useMemo(() => currentWeekendRange(now), [now]);

  // Présélection : le week-end courant, tronqué à 8, par date croissante.
  const [selectedIds, setSelectedIds] = useState<string[]>(() =>
    entries
      .filter((e) => isInRange(e.rencontre.date_heure, weekend))
      .sort((a, b) => a.rencontre.date_heure.localeCompare(b.rencontre.date_heure))
      .slice(0, MAX_POSTER_MATCHES)
      .map((e) => e.rencontre.id)
  );

  const [genStatus, setGenStatus] = useState<'idle' | 'loading' | 'done'>('idle');
  const [dataUrl, setDataUrl] = useState<string | null>(null);
  const posterRef = useRef<HTMLDivElement>(null);

  // Toute nouvelle sélection invalide l'affiche déjà générée.
  useEffect(() => {
    setGenStatus('idle');
    setDataUrl(null);
  }, [selectedIds]);

  const selected = useMemo(() => new Set(selectedIds), [selectedIds]);
  const atMax = selectedIds.length >= MAX_POSTER_MATCHES;

  const toggle = (id: string) =>
    setSelectedIds((prev) => {
      if (prev.includes(id)) return prev.filter((x) => x !== id);
      // Au-delà de MAX_POSTER_MATCHES le clic est ignoré.
      return prev.length >= MAX_POSTER_MATCHES ? prev : [...prev, id];
    });

  const takeAll = (groupe: Groupe) =>
    setSelectedIds((prev) => {
      const next = [...prev];
      for (const e of groupe.entries) {
        if (next.length >= MAX_POSTER_MATCHES) break;
        if (!next.includes(e.rencontre.id)) next.push(e.rencontre.id);
      }
      return next;
    });

  const selectedMatches = useMemo<TeamMatch[]>(
    () =>
      entries
        .filter((e) => selected.has(e.rencontre.id))
        .sort((a, b) => a.rencontre.date_heure.localeCompare(b.rencontre.date_heure))
        .map((e) => rencontreToTeamMatch(e.rencontre, e.equipe, e.competition)),
    [entries, selected]
  );

  // toJpeg reste déclenché par une action explicite : à pixelRatio 2 sur une
  // A4, l'appeler à chaque coche ferait ramer le panneau.
  const handleGenerate = async () => {
    setGenStatus('loading');
    try {
      const node = posterRef.current;
      if (!node) throw new Error('Aperçu non monté');
      const url = await toJpeg(node, { quality: 0.92, pixelRatio: 2 });
      setDataUrl(url);
      setGenStatus('done');
    } catch (err) {
      console.error(err);
      setGenStatus('idle');
    }
  };

  const fileName = `affiche-rencontres-${weekendFileDate(weekend)}.jpg`;
  const genBtnLabel =
    genStatus === 'loading' ? 'Génération…' : genStatus === 'done' ? 'Régénérer' : "Générer l'affiche";

  return (
    <div className="flex h-full flex-col overflow-y-auto p-5">
      <div className="flex items-start justify-between gap-2">
        <div>
          <p className="text-[10px] font-semibold uppercase tracking-[0.08em] text-muted-foreground">
            Affiche des rencontres
          </p>
          <h2 className="mt-1 text-[21px] font-extrabold leading-tight">Rencontres à venir</h2>
        </div>
        <button
          type="button"
          onClick={onClose}
          aria-label="Fermer le mode affiche"
          className="rounded-lg border border-border bg-card px-2.5 py-1 text-sm text-muted-foreground transition hover:bg-muted"
        >
          ✕
        </button>
      </div>

      <p className="tabular mt-1 text-xs text-muted-foreground">
        {selectedIds.length} / {MAX_POSTER_MATCHES} sélectionnées
      </p>

      {groupes.length === 0 ? (
        <p className="mt-5 rounded-xl border border-dashed border-border p-6 text-center text-xs text-muted-foreground">
          Aucune rencontre à venir.
        </p>
      ) : (
        <div className="mt-4 space-y-4">
          {groupes.map((groupe) => (
            <div key={groupe.key}>
              <div className="mb-1.5 flex items-baseline justify-between gap-2">
                <h3 className="text-[10px] font-semibold uppercase tracking-[0.08em] text-muted-foreground">
                  {groupe.label}
                </h3>
                <button
                  type="button"
                  onClick={() => takeAll(groupe)}
                  className="text-[11px] font-semibold text-primary hover:underline"
                >
                  Tout prendre
                </button>
              </div>
              <div className="space-y-1">
                {groupe.entries.map((e) => {
                  const checked = selected.has(e.rencontre.id);
                  const disabled = !checked && atMax;
                  return (
                    <label
                      key={e.rencontre.id}
                      className={`flex cursor-pointer items-start gap-2.5 rounded-lg border border-border px-2.5 py-2 text-xs transition ${
                        disabled ? 'opacity-50' : 'hover:bg-muted/50'
                      }`}
                    >
                      <input
                        type="checkbox"
                        checked={checked}
                        disabled={disabled}
                        onChange={() => toggle(e.rencontre.id)}
                        className="mt-0.5 accent-[var(--color-primary)]"
                      />
                      <span className="min-w-0 flex-1">
                        <span className="block truncate font-bold">{e.rencontre.club_adverse}</span>
                        <span className="block truncate text-[10px] uppercase tracking-wide text-muted-foreground">
                          {e.competition.nom} · Éq. {e.equipe.numero}
                        </span>
                        <span className="block text-[10px] text-muted-foreground">
                          {formatRencontreDate(e.rencontre.date_heure)} ·{' '}
                          {e.rencontre.domicile ? 'Au club' : 'Déplacement'}
                        </span>
                      </span>
                    </label>
                  );
                })}
              </div>
            </div>
          ))}
        </div>
      )}

      <p className="mt-4 text-[11px] leading-relaxed text-muted-foreground">
        Mise en page CAC, {MAX_POSTER_MATCHES} rencontres maximum. L'aperçu se met à jour à chaque
        coche ; le JPEG n'est calculé qu'à la génération.
      </p>

      {/* Aperçu A4 (le rendu exporté est le nœud hors viewport plus bas) */}
      {selectedMatches.length > 0 && (
        <div className="mt-3 overflow-hidden rounded-xl border border-border">
          <div className="h-[260px] w-full overflow-hidden">
            <div
              style={{ width: 1414, transform: 'scale(0.234)', transformOrigin: 'top left' }}
              aria-label="Aperçu de l'affiche"
            >
              <TeamMatchImagePreview
                matches={selectedMatches}
                background={config.posters.team_match_background}
              />
            </div>
          </div>
        </div>
      )}

      <button
        type="button"
        onClick={handleGenerate}
        disabled={selectedMatches.length === 0 || genStatus === 'loading'}
        className="mt-4 inline-flex items-center justify-center gap-2 rounded-lg bg-primary px-5 py-2.5 text-sm font-semibold text-primary-foreground shadow-sm transition hover:brightness-95 disabled:opacity-50"
      >
        {genStatus === 'loading' && (
          <span className="inline-block h-3.5 w-3.5 animate-spin rounded-full border-2 border-white/40 border-t-white" />
        )}
        {genBtnLabel}
      </button>

      {dataUrl && (
        <a
          href={dataUrl}
          download={fileName}
          className="mt-2 rounded-lg border border-border bg-card px-5 py-2.5 text-center text-sm font-semibold text-primary transition hover:bg-muted"
        >
          Télécharger l'affiche JPEG
        </a>
      )}

      <button
        type="button"
        onClick={onClose}
        className="mt-2 rounded-lg px-5 py-2 text-center text-xs font-medium text-muted-foreground transition hover:text-foreground"
      >
        Revenir à la rencontre
      </button>

      {/* Affiche hors viewport — requise pour html-to-image */}
      <div style={{ position: 'fixed', left: -99999, top: 0, pointerEvents: 'none' }} aria-hidden>
        <div ref={posterRef}>
          <TeamMatchImagePreview
            matches={selectedMatches}
            background={config.posters.team_match_background}
          />
        </div>
      </div>
    </div>
  );
}
