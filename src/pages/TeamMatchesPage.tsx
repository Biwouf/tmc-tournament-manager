import { useEffect, useMemo, useState } from 'react';
import { supabase } from '../lib/supabase';
import { useClub } from '../contexts/ClubContext';
import { useLocalStorage } from '../hooks/useLocalStorage';
import type { TeamSaison } from '../types';
import TeamMatchesHeader from '../components/teamMatches/TeamMatchesHeader';
import SeasonGridView from '../components/teamMatches/SeasonGridView';
import AgendaView from '../components/teamMatches/AgendaView';
import ListeView from '../components/teamMatches/ListeView';
import RencontrePanel from '../components/teamMatches/RencontrePanel';
import PosterPanel from '../components/teamMatches/poster/PosterPanel';
import { useTeamSeasonGrid } from '../components/teamMatches/useTeamSeasonGrid';
import { CELL_CLASSES, STATE_LABELS, type CellState } from '../components/teamMatches/gridTypes';

type View = 'grille' | 'agenda' | 'liste';

const VIEWS: { key: View; label: string }[] = [
  { key: 'grille', label: 'Grille' },
  { key: 'agenda', label: 'Agenda' },
  { key: 'liste', label: 'Liste' },
];

const LEGENDE: CellState[] = ['win', 'loss', 'todo', 'next', 'draw'];

/** Sélection courante — porte sa saison pour être invalidée au changement. */
interface Selection {
  saisonId: string;
  etapeId: string;
}

export default function TeamMatchesPage() {
  const { clubId } = useClub();

  const [saisons, setSaisons] = useState<TeamSaison[]>([]);
  const [refError, setRefError] = useState<string | null>(null);
  const [refReady, setRefReady] = useState(false);

  const [view, setView] = useLocalStorage<View>(`tmc:${clubId}:team-matches:view`, 'grille');
  const [storedSaisonId, setStoredSaisonId] = useLocalStorage<string>(
    `tmc:${clubId}:team-matches:saison`,
    ''
  );
  const [showDone, setShowDone] = useState(false);
  const [selection, setSelection] = useState<Selection | null>(null);
  const [posterMode, setPosterMode] = useState(false);

  // Référentiel des saisons.
  useEffect(() => {
    let cancelled = false;
    supabase
      .from('team_saisons')
      .select('*')
      .eq('club_id', clubId)
      .order('created_at', { ascending: false })
      .then(({ data, error }) => {
        if (cancelled) return;
        setRefError(error?.message ?? null);
        setSaisons((data ?? []) as TeamSaison[]);
        setRefReady(true);
      });
    return () => {
      cancelled = true;
    };
  }, [clubId]);

  // Saison retenue : celle mémorisée si elle existe encore, sinon l'active.
  const saisonId = useMemo(() => {
    if (storedSaisonId && saisons.some((s) => s.id === storedSaisonId)) return storedSaisonId;
    return (saisons.find((s) => s.actif) ?? saisons[0])?.id ?? '';
  }, [saisons, storedSaisonId]);

  const grid = useTeamSeasonGrid(saisonId);
  const { blocks, doneBlocks, entries, cellByEtapeId, counters, reload } = grid;

  // Le retour depuis /team-matches/rencontre/:id doit montrer le nouveau score.
  useEffect(() => {
    window.addEventListener('focus', reload);
    return () => window.removeEventListener('focus', reload);
  }, [reload]);

  // Sélection par défaut : la première rencontre à saisir, sinon la prochaine
  // à venir. Dérivée plutôt que posée dans un effet, pour rester juste après
  // un rechargement sans réinitialiser un choix explicite.
  const defaultEtapeId = useMemo(() => {
    const todo = entries.find((e) => e.state === 'todo');
    if (todo) return todo.etape.id;
    const next = entries.find((e) => e.state === 'next');
    return next?.etape.id ?? null;
  }, [entries]);

  const selectedEtapeId =
    selection && selection.saisonId === saisonId ? selection.etapeId : defaultEtapeId;
  const selectedCell = selectedEtapeId ? (cellByEtapeId.get(selectedEtapeId) ?? null) : null;

  const select = (etapeId: string) => {
    setSelection({ saisonId, etapeId });
    setPosterMode(false);
  };

  const handleOpenFromListe = (equipeId: string, done: boolean) => {
    setView('grille');
    if (done) setShowDone(true);
    requestAnimationFrame(() => {
      document.getElementById(`equipe-${equipeId}`)?.scrollIntoView({ block: 'center' });
    });
  };

  const loading = !refReady || (saisonId !== '' && grid.loading);
  const error = refError ?? grid.error;

  return (
    <div className="min-h-screen">
      <TeamMatchesHeader
        title="Matches par équipe"
        subtitle="Grille de saison — cliquez une cellule pour saisir un score."
        backTo="/"
        backLabel="Accueil"
        actions={
          <div className="flex flex-wrap items-center gap-3">
            <div className="inline-flex rounded-full border border-border bg-card p-0.5">
              {VIEWS.map((v) => (
                <button
                  key={v.key}
                  type="button"
                  onClick={() => setView(v.key)}
                  className={`rounded-full px-3.5 py-1.5 text-sm font-medium transition ${
                    view === v.key
                      ? 'bg-primary text-primary-foreground'
                      : 'text-muted-foreground hover:bg-muted'
                  }`}
                >
                  {v.label}
                </button>
              ))}
            </div>

            <select
              value={saisonId}
              onChange={(e) => {
                setStoredSaisonId(e.target.value);
                setSelection(null);
                setPosterMode(false);
              }}
              className="rounded-lg border border-border bg-background px-3 py-2 text-sm"
            >
              {saisons.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.label}
                  {s.actif ? ' (active)' : ''}
                </option>
              ))}
            </select>

            <button
              type="button"
              onClick={() => setPosterMode(true)}
              className="rounded-lg bg-primary px-4 py-2 text-sm font-medium text-primary-foreground shadow-sm transition hover:brightness-95"
            >
              Générer une affiche
            </button>
          </div>
        }
      />

      <div className="grid grid-cols-1 items-start lg:grid-cols-[minmax(0,1fr)_372px]">
        <main className="min-w-0 px-4 py-6">
          {error && (
            <div className="mb-6 rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
              Erreur de chargement : {error}
              <span className="mt-1 block text-xs">
                Vérifiez que les migrations <code>20260606_team_matches.sql</code> et{' '}
                <code>20260820_team_competitions_terminee.sql</code> ont bien été appliquées sur
                Supabase.
              </span>
            </div>
          )}

          {/* Barre de contexte : compteurs + légende */}
          <div className="mb-6 flex flex-wrap items-center gap-x-5 gap-y-2">
            <div className="flex items-baseline gap-2">
              <span className="tabular rounded-lg bg-score-todo px-2.5 py-1 text-lg font-extrabold text-score-todo-fg">
                {counters.aSaisir}
              </span>
              <span className="text-sm font-medium">scores à saisir</span>
            </div>
            <span className="text-sm text-muted-foreground">
              {counters.equipesEnCours} équipes en cours · {counters.ceWeekEnd} rencontres ce
              week-end
            </span>
            <div className="ml-auto flex flex-wrap items-center gap-2.5">
              {LEGENDE.map((state) => (
                <span key={state} className="flex items-center gap-1.5 text-[11px] text-muted-foreground">
                  <span className={`inline-block h-3 w-3 rounded-full ${CELL_CLASSES[state]}`} />
                  {STATE_LABELS[state].toLowerCase()}
                </span>
              ))}
            </div>
          </div>

          {loading ? (
            <GridSkeleton />
          ) : saisons.length === 0 ? (
            <div className="rounded-[13px] border border-dashed border-border bg-card/50 p-12 text-center text-muted-foreground">
              Aucune saison. Rendez-vous dans l'Admin pour en créer une.
            </div>
          ) : view === 'grille' ? (
            <SeasonGridView
              blocks={blocks}
              doneBlocks={doneBlocks}
              showDone={showDone}
              onToggleDone={() => setShowDone((v) => !v)}
              selectedEtapeId={selectedEtapeId}
              onSelect={select}
            />
          ) : view === 'agenda' ? (
            <AgendaView entries={entries} selectedEtapeId={selectedEtapeId} onSelect={select} />
          ) : (
            <ListeView
              blocks={blocks}
              doneBlocks={doneBlocks}
              selectedEtapeId={selectedEtapeId}
              onOpen={handleOpenFromListe}
            />
          )}
        </main>

        <aside className="border-t border-border bg-[#fdf6f7] lg:sticky lg:top-0 lg:h-screen lg:border-l lg:border-t-0">
          {posterMode ? (
            <PosterPanel
              key={saisonId}
              entries={entries}
              onClose={() => setPosterMode(false)}
            />
          ) : (
            <RencontrePanel cell={selectedCell} onOpenPoster={() => setPosterMode(true)} />
          )}
        </aside>
      </div>
    </div>
  );
}

/** Squelette de grille — plutôt qu'un « Chargement… » centré. */
function GridSkeleton() {
  return (
    <div className="space-y-8">
      {[0, 1].map((block) => (
        <div key={block}>
          <div className="mb-2.5 h-3 w-52 animate-pulse rounded bg-muted" />
          <div className="space-y-[7px] rounded-[13px] border border-border bg-card p-2.5">
            {[0, 1, 2].map((row) => (
              <div key={row} className="grid gap-[7px] grid-cols-[186px_repeat(5,minmax(112px,1fr))]">
                <div className="h-[52px] animate-pulse rounded-[10px] bg-muted" />
                {[0, 1, 2, 3, 4].map((cell) => (
                  <div key={cell} className="h-[52px] animate-pulse rounded-[10px] bg-muted" />
                ))}
              </div>
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}
