import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { supabase } from '../../lib/supabase';
import { useClub } from '../../contexts/ClubContext';
import type { TeamMatchLine } from '../../types';
import type { CellRef } from './gridTypes';
import { STATE_LABELS } from './gridTypes';
import {
  CATEGORIE_LABELS,
  FORMAT_LABELS,
  FORMAT_SPECS,
  etapeLabel,
} from './teamMatchLabels';

function formatDateHeure(iso: string): string {
  return new Date(iso).toLocaleString('fr-FR', {
    weekday: 'long',
    day: '2-digit',
    month: 'long',
    hour: '2-digit',
    minute: '2-digit',
  });
}

/** `S1`…`D2` — libellé d'ordre d'un match individuel. */
function lineLabel(line: TeamMatchLine): string {
  return `${line.match_type === 'double' ? 'D' : 'S'}${line.ordre + 1}`;
}

function joueursLabel(line: TeamMatchLine): string {
  const noms = line.joueurs_club.map((j) => [j.prenom, j.nom].filter(Boolean).join(' '));
  return noms.length ? noms.join(' / ') : 'Composition à faire';
}

function lineTag(line: TeamMatchLine): { label: string; classes: string } {
  if (line.gagnant === 'club') return { label: 'Gagné', classes: 'bg-score-win text-score-win-fg' };
  if (line.gagnant === 'adverse') return { label: 'Perdu', classes: 'bg-score-loss text-score-loss-fg' };
  if (line.live_match_id) return { label: 'Live', classes: 'bg-score-todo text-score-todo-fg' };
  return { label: 'À créer', classes: 'bg-score-wo text-score-wo-fg' };
}

export default function RencontrePanel({
  cell,
  onOpenPoster,
}: {
  cell: CellRef | null;
  onOpenPoster: () => void;
}) {
  const navigate = useNavigate();
  const { clubId } = useClub();
  const [lines, setLines] = useState<TeamMatchLine[]>([]);
  /** Rencontre à laquelle `lines` correspond — sert à dériver l'état de chargement. */
  const [linesFor, setLinesFor] = useState<string | null>(null);

  const rencontreId = cell?.rencontre?.id ?? null;
  const linesLoading = rencontreId !== null && linesFor !== rencontreId;

  // Une requête par sélection, annulable. Pas de cache : le retour depuis
  // /team-matches/rencontre/:id doit voir les lines à jour.
  useEffect(() => {
    if (!rencontreId) return;
    let cancelled = false;
    supabase
      .from('team_match_lines')
      .select('*')
      .eq('club_id', clubId)
      .eq('rencontre_id', rencontreId)
      .order('ordre', { ascending: true })
      .then(({ data }) => {
        if (cancelled) return;
        setLines((data ?? []) as TeamMatchLine[]);
        setLinesFor(rencontreId);
      });
    return () => {
      cancelled = true;
    };
  }, [rencontreId, clubId]);

  if (!cell) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-3 p-8 text-center">
        <p className="text-sm font-semibold">Sélectionnez une rencontre</p>
        <p className="text-xs text-muted-foreground">
          Cliquez une cellule de la grille pour voir son détail et saisir son score.
        </p>
        <button
          type="button"
          onClick={onOpenPoster}
          className="mt-2 rounded-lg border border-border bg-card px-4 py-2 text-sm font-medium text-muted-foreground transition hover:bg-muted"
        >
          Générer une affiche
        </button>
      </div>
    );
  }

  const { competition, equipe, etape, rencontre, state } = cell;
  const spec = FORMAT_SPECS[competition.format];
  const liveLine = lines.find((l) => l.live_match_id);

  const ctaLabel = !rencontre
    ? 'Créer la rencontre'
    : state === 'todo' || rencontre.score_club === null
      ? 'Saisir le score'
      : lines.length === 0
        ? "Composer l'équipe"
        : 'Modifier le score';

  const goToRencontre = () =>
    navigate(
      rencontre
        ? `/team-matches/rencontre/${rencontre.id}`
        : `/team-matches/rencontre/new?etapeId=${etape.id}`
    );

  const handleCreateActu = () => {
    if (!rencontre) return;
    const dateCourte = new Date(rencontre.date_heure).toLocaleDateString('fr-FR', {
      day: '2-digit',
      month: 'short',
      year: 'numeric',
    });
    navigate('/actus/new', {
      state: {
        titre: `Match par équipe — ${rencontre.club_adverse} (${dateCourte})`,
        image_urls: rencontre.photo_urls,
      },
    });
  };

  return (
    <div className="flex h-full flex-col overflow-y-auto p-5">
      <p className="text-[10px] font-semibold uppercase tracking-[0.08em] text-muted-foreground">
        {competition.nom} — {CATEGORIE_LABELS[competition.categorie]} · Équipe {equipe.numero} ·{' '}
        {equipe.division}
      </p>

      <h2 className="mt-1.5 text-[21px] font-extrabold leading-tight">
        {etapeLabel(etape)}
        {rencontre ? ` — ${rencontre.club_adverse}` : ''}
      </h2>

      <p className="mt-1 text-xs text-muted-foreground">
        {STATE_LABELS[state]}
        {rencontre && ` · ${formatDateHeure(rencontre.date_heure)}`}
        {rencontre && ` · ${rencontre.domicile ? 'Au club' : 'Déplacement'}`}
      </p>

      {/* Score */}
      <div className="mt-4 flex items-stretch gap-2.5 rounded-[13px] border border-border bg-background p-3.5">
        <div className="flex-1 text-center">
          <p className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
            CAC Tennis
          </p>
          <p className="tabular text-[32px] font-extrabold leading-none">
            {rencontre?.score_club ?? '–'}
          </p>
        </div>
        <div className="w-px bg-border" />
        <div className="flex-1 text-center">
          <p className="truncate text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
            {rencontre?.club_adverse ?? 'Adverse'}
          </p>
          <p className="tabular text-[32px] font-extrabold leading-none">
            {rencontre?.score_adverse ?? '–'}
          </p>
        </div>
      </div>

      {/* Matches individuels */}
      <div className="mt-5">
        <div className="mb-2 flex items-baseline justify-between">
          <h3 className="text-[10px] font-semibold uppercase tracking-[0.08em] text-muted-foreground">
            Matches
          </h3>
          <span className="text-[10px] text-muted-foreground">{FORMAT_LABELS[competition.format]}</span>
        </div>

        {!rencontre ? (
          <p className="rounded-xl border border-dashed border-border p-4 text-center text-xs text-muted-foreground">
            Aucune rencontre sur cette étape. Créez-la pour composer l'équipe.
          </p>
        ) : linesLoading ? (
          <div className="space-y-1.5">
            {Array.from({ length: spec.simples + spec.doubles }, (_, i) => (
              <div key={i} className="h-9 animate-pulse rounded-lg bg-muted" />
            ))}
          </div>
        ) : lines.length === 0 ? (
          <p className="rounded-xl border border-dashed border-border p-4 text-center text-xs text-muted-foreground">
            Aucun match saisi ({spec.simples} simples, {spec.doubles} double
            {spec.doubles > 1 ? 's' : ''} attendus).
          </p>
        ) : (
          <ul className="divide-y divide-border rounded-xl border border-border">
            {lines.map((line) => {
              const tag = lineTag(line);
              return (
                <li key={line.id} className="flex items-center gap-2.5 px-3 py-2">
                  <span className="w-6 shrink-0 text-[11px] font-bold text-muted-foreground">
                    {lineLabel(line)}
                  </span>
                  <span className="min-w-0 flex-1 truncate text-xs font-medium">
                    {joueursLabel(line)}
                  </span>
                  {line.score && <span className="tabular shrink-0 text-[11px]">{line.score}</span>}
                  <span
                    className={`shrink-0 rounded-full px-2 py-0.5 text-[10px] font-semibold ${tag.classes}`}
                  >
                    {tag.label}
                  </span>
                </li>
              );
            })}
          </ul>
        )}
      </div>

      {/* CTA principal */}
      <button
        type="button"
        onClick={goToRencontre}
        className="mt-5 rounded-lg bg-primary px-5 py-2.5 text-sm font-semibold text-primary-foreground shadow-sm transition hover:brightness-95"
      >
        {ctaLabel}
      </button>

      {/* Actions secondaires — toutes branchées sur les flux existants de la
          page rencontre, qui reste la seule surface d'édition. */}
      {rencontre && (
        <div className="mt-2.5 grid grid-cols-2 gap-2">
          <button
            type="button"
            onClick={() =>
              navigate(liveLine ? `/live-score/${liveLine.live_match_id}` : '/live-score')
            }
            className="rounded-lg border border-border bg-card px-3 py-2 text-xs font-medium text-muted-foreground transition hover:bg-muted"
          >
            Live Score
          </button>
          <button
            type="button"
            onClick={goToRencontre}
            className="rounded-lg border border-border bg-card px-3 py-2 text-xs font-medium text-muted-foreground transition hover:bg-muted"
          >
            Photos ({rencontre.photo_urls.length})
          </button>
          <button
            type="button"
            onClick={handleCreateActu}
            className="rounded-lg border border-border bg-card px-3 py-2 text-xs font-medium text-muted-foreground transition hover:bg-muted"
          >
            Créer une actu
          </button>
          <button
            type="button"
            onClick={goToRencontre}
            className="rounded-lg border border-border bg-card px-3 py-2 text-xs font-medium text-muted-foreground transition hover:bg-muted"
          >
            Plein écran
          </button>
          <button
            type="button"
            onClick={goToRencontre}
            className="col-span-2 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-xs font-medium text-red-700 transition hover:bg-red-100"
          >
            {rencontre.wo ? 'Annuler le WO' : 'Déclarer un WO'}
          </button>
        </div>
      )}

      <p className="mt-3 text-[10px] leading-relaxed text-muted-foreground">
        Photos, WO et plein écran ouvrent la page de la rencontre — c'est là que vivent ces flux.
      </p>
    </div>
  );
}
