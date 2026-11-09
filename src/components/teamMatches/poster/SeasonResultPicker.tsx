import { useCallback, useEffect, useMemo, useState } from 'react';
import { supabase } from '../../../lib/supabase';
import { useClub } from '../../../contexts/ClubContext';
import type { TeamMatchLine } from '../../../types';
import { CELL_CLASSES, type RencontreEntry } from '../gridTypes';
import { competitionLabel, etapeLabelCourt, totalPointsFormat } from '../teamMatchLabels';
import { formatRencontreDate } from './posterHelpers';
import ResultPosterSection, { type ResultPosterFile } from './ResultPosterSection';

/**
 * Rencontre terminée : tous les points du format sont attribués (WO compris). Le score se remplit
 * au fil des matchs, un score partiel (ex. 2–1 en 4S2D) n'est donc pas une fin de rencontre.
 */
function isFinished({ rencontre, competition }: RencontreEntry) {
  if (rencontre.score_club === null || rencontre.score_adverse === null) return false;
  return rencontre.score_club + rencontre.score_adverse === totalPointsFormat(competition.format);
}

function entryLabel({ rencontre, etape, equipe, competition }: RencontreEntry) {
  return `${formatRencontreDate(rencontre.date_heure)} · ${competitionLabel(competition)} · Éq. ${equipe.numero} ${etapeLabelCourt(etape)} · ${rencontre.score_club}–${rencontre.score_adverse} ${rencontre.club_adverse}`;
}

/** Délai entre deux téléchargements : les navigateurs ignorent des clics trop rapprochés. */
const DOWNLOAD_INTERVAL_MS = 400;
/** Rencontres proposées d'emblée ; les plus anciennes sont repliées. */
const RECENT_DAYS = 7;

/**
 * Visuels de fin de rencontre dans `/medias`, en lot : les rencontres terminées cochées ont
 * chacune leur aperçu et leurs réglages, et « Tout télécharger » enregistre les PNG prêts.
 */
export default function SeasonResultPicker({ entries }: { entries: RencontreEntry[] }) {
  const finished = useMemo(() => entries.filter(isFinished).reverse(), [entries]);
  const [since] = useState(() => Date.now() - RECENT_DAYS * 24 * 60 * 60 * 1000);
  const recent = finished.filter(e => new Date(e.rencontre.date_heure).getTime() >= since);
  const older = finished.filter(e => new Date(e.rencontre.date_heure).getTime() < since);
  // Sans rencontre récente, les anciennes sont dépliées : la liste n'est jamais vide.
  const [showOlder, setShowOlder] = useState(recent.length === 0);
  const [selected, setSelected] = useState<Set<string>>(() => new Set(recent[0] ? [recent[0].rencontre.id] : []));
  const [files, setFiles] = useState<Record<string, ResultPosterFile>>({});
  const chosen = finished.filter(e => selected.has(e.rencontre.id));
  const ready = chosen.map(e => files[e.rencontre.id]).filter((file): file is ResultPosterFile => !!file);
  const visible = showOlder ? finished : recent;

  const setFile = useCallback((id: string, file: ResultPosterFile | null) => {
    setFiles(previous => {
      if (!file) { const rest = { ...previous }; delete rest[id]; return rest; }
      return { ...previous, [id]: file };
    });
  }, []);

  function toggle(id: string) {
    setSelected(previous => {
      const next = new Set(previous);
      if (!next.delete(id)) next.add(id);
      return next;
    });
  }

  function downloadAll() {
    ready.forEach((file, index) => window.setTimeout(() => {
      const link = document.createElement('a');
      link.href = file.url; link.download = file.name; link.click();
    }, index * DOWNLOAD_INTERVAL_MS));
  }

  if (finished.length === 0) {
    return <p className="rounded-xl border border-dashed border-border p-8 text-center text-muted-foreground">Aucune rencontre terminée sur cette saison.</p>;
  }
  const row = (entry: RencontreEntry) => <RencontreOption key={entry.rencontre.id} entry={entry} checked={selected.has(entry.rencontre.id)} onToggle={() => toggle(entry.rencontre.id)} />;
  return (
    <div className="max-w-2xl space-y-6">
      <fieldset className="min-w-0 rounded-2xl border border-border bg-card p-4 shadow-sm sm:p-5">
        <legend className="sr-only">Rencontres terminées</legend>
        <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
          <div>
            <p className="font-semibold">Rencontres terminées</p>
            <p className="text-xs text-muted-foreground">{selected.size} sélectionnée{selected.size > 1 ? 's' : ''} · un visuel par rencontre</p>
          </div>
          <div className="flex gap-1 text-xs font-medium">
            <button type="button" className="rounded-full px-3 py-1.5 text-primary hover:bg-primary/10" onClick={() => setSelected(previous => new Set([...previous, ...visible.map(e => e.rencontre.id)]))}>Tout cocher</button>
            <button type="button" disabled={selected.size === 0} className="rounded-full px-3 py-1.5 text-muted-foreground hover:bg-muted disabled:opacity-40" onClick={() => setSelected(new Set())}>Tout décocher</button>
          </div>
        </div>
        {recent.length > 0
          ? <ul className="space-y-2">{recent.map(row)}</ul>
          : <p className="rounded-xl border border-dashed border-border px-4 py-3 text-sm text-muted-foreground">Aucune rencontre terminée ces {RECENT_DAYS} derniers jours.</p>}
        {older.length > 0 && <>
          <button type="button" aria-expanded={showOlder} onClick={() => setShowOlder(!showOlder)} className="mt-3 flex w-full items-center justify-between rounded-xl px-3 py-2 text-sm font-medium text-muted-foreground transition hover:bg-muted hover:text-foreground">
            <span>Rencontres plus anciennes ({older.length})</span>
            <svg viewBox="0 0 20 20" fill="currentColor" aria-hidden="true" className={`h-4 w-4 transition-transform ${showOlder ? 'rotate-180' : ''}`}><path fillRule="evenodd" d="M5.23 7.21a.75.75 0 0 1 1.06.02L10 11.17l3.71-3.94a.75.75 0 1 1 1.08 1.04l-4.25 4.5a.75.75 0 0 1-1.08 0l-4.25-4.5a.75.75 0 0 1 .02-1.06Z" clipRule="evenodd" /></svg>
          </button>
          {showOlder && <ul className="mt-2 max-h-80 space-y-2 overflow-y-auto">{older.map(row)}</ul>}
        </>}
      </fieldset>
      {chosen.length > 1 && (
        <div className="flex flex-wrap items-center gap-3">
          <button type="button" disabled={ready.length === 0} onClick={downloadAll} className="rounded-lg bg-primary px-5 py-2.5 text-sm font-semibold text-primary-foreground disabled:opacity-50">
            Tout télécharger ({ready.length}/{chosen.length})
          </button>
          {ready.length < chosen.length && <p className="text-xs text-muted-foreground">Seuls les visuels prêts sont téléchargés.</p>}
        </div>
      )}
      {chosen.map(entry => (
        <div key={entry.rencontre.id} className="space-y-2">
          <h3 className="text-sm font-semibold">{entryLabel(entry)}</h3>
          <RencontreResult entry={entry} onFileChange={setFile} />
        </div>
      ))}
    </div>
  );
}

function RencontreOption({ entry, checked, onToggle }: { entry: RencontreEntry; checked: boolean; onToggle: () => void }) {
  const { rencontre, etape, equipe, competition, state } = entry;
  const photos = rencontre.photo_urls.length;
  return (
    <li>
      <label className={`flex cursor-pointer items-center gap-3 rounded-xl border px-3 py-2.5 transition ${checked ? 'border-primary bg-primary/5 ring-1 ring-primary' : 'border-border hover:border-primary/40 hover:bg-muted/60'}`}>
        <input type="checkbox" checked={checked} onChange={onToggle} className="h-4 w-4 shrink-0 cursor-pointer accent-primary" />
        <span className="min-w-0 flex-1">
          <span className="block truncate text-sm font-semibold">{rencontre.club_adverse}</span>
          <span className="block truncate text-xs text-muted-foreground">
            {formatRencontreDate(rencontre.date_heure)} · Éq. {equipe.numero} {etapeLabelCourt(etape)} · {competitionLabel(competition)}
          </span>
        </span>
        {photos > 0 && <span title={`${photos} photo${photos > 1 ? 's' : ''} : visuel « Esprit d’équipe » proposé`} className="flex shrink-0 items-center gap-1 text-xs text-muted-foreground">
          <svg viewBox="0 0 20 20" fill="currentColor" aria-hidden="true" className="h-4 w-4"><path fillRule="evenodd" d="M1 8a2 2 0 0 1 2-2h.93a2 2 0 0 0 1.66-.89l.82-1.22A2 2 0 0 1 8.07 3h3.86a2 2 0 0 1 1.66.89l.82 1.22a2 2 0 0 0 1.66.89H17a2 2 0 0 1 2 2v7a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V8Zm13.5 3a4.5 4.5 0 1 1-9 0 4.5 4.5 0 0 1 9 0ZM10 14a3 3 0 1 0 0-6 3 3 0 0 0 0 6Z" clipRule="evenodd" /></svg>
          <span className="sr-only">Photos :</span>{photos}
        </span>}
        <span className={`shrink-0 rounded-full px-2.5 py-1 text-xs font-semibold tabular-nums ${CELL_CLASSES[state]}`}>
          {rencontre.wo ? 'WO ' : ''}{rencontre.score_club}–{rencontre.score_adverse}
        </span>
      </label>
    </li>
  );
}

function RencontreResult({ entry, onFileChange }: { entry: RencontreEntry; onFileChange: (id: string, file: ResultPosterFile | null) => void }) {
  const { clubId } = useClub();
  const [lines, setLines] = useState<TeamMatchLine[] | null>(null);
  const [error, setError] = useState('');
  const id = entry.rencontre.id;
  useEffect(() => {
    let cancelled = false;
    supabase.from('team_match_lines').select('*').eq('rencontre_id', id).eq('club_id', clubId).order('ordre', { ascending: true })
      .then(({ data, error: fetchError }) => {
        if (cancelled) return;
        if (fetchError) setError(fetchError.message);
        else setLines((data ?? []) as TeamMatchLine[]);
      });
    return () => { cancelled = true; };
  }, [id, clubId]);

  if (error) return <p className="text-sm text-destructive">Erreur de chargement : {error}</p>;
  if (!lines) return <p className="text-sm text-muted-foreground">Chargement des matchs…</p>;
  return <ResultPosterSection rencontre={entry.rencontre} lines={lines} competition={entry.competition} equipe={entry.equipe} etape={entry.etape} defaultOpen onFileChange={file => onFileChange(id, file)} />;
}
