import { Link } from 'react-router-dom';
import type { Cell, CompetitionBlock } from './gridTypes';
import {
  CELL_CLASSES,
  STATE_LABELS,
  bilanLabel,
  gridMinWidth,
  gridTemplateColumns,
} from './gridTypes';
import { competitionLabel } from './teamMatchLabels';

function CellButton({
  cell,
  selected,
  onSelect,
}: {
  cell: Cell;
  selected: boolean;
  onSelect: () => void;
}) {
  const classes = `flex min-h-[52px] flex-col items-center justify-center rounded-[10px] px-1.5 py-1 ${CELL_CLASSES[cell.state]}`;

  // `na` n'est pas un bouton : l'étape n'existe pas pour cette équipe.
  if (cell.state === 'na') {
    return (
      <div className={`${classes} cursor-default`} title={cell.title} aria-label="Journée non applicable">
        <span aria-hidden="true" />
      </div>
    );
  }

  return (
    <button
      type="button"
      onClick={onSelect}
      title={`${STATE_LABELS[cell.state]}${cell.subtitle ? ` — ${cell.subtitle}` : ''}`}
      className={`${classes} text-center transition hover:brightness-[.97] ${
        selected ? 'border-foreground shadow-[0_0_0_2px_rgba(46,32,35,.12)]' : ''
      }`}
    >
      <span className="tabular text-[15px] font-extrabold leading-none">{cell.score}</span>
      {cell.subtitle && (
        <span className="mt-1 w-full truncate text-[10px] leading-tight opacity-80">
          {cell.subtitle}
        </span>
      )}
    </button>
  );
}

function Block({
  block,
  done,
  selectedEtapeId,
  onSelect,
}: {
  block: CompetitionBlock;
  done: boolean;
  selectedEtapeId: string | null;
  onSelect: (etapeId: string) => void;
}) {
  const { colonnes, nPoule, nFinales } = block;
  const template = gridTemplateColumns(nPoule, nFinales);
  const minWidth = gridMinWidth(nPoule, nFinales);
  const firstFinaleKey = colonnes.find((c) => c.phase === 'finale')?.key;

  return (
    <section className={done ? 'opacity-75' : undefined}>
      <div className="mb-2.5 flex items-center gap-2">
        <h2 className="text-xs font-semibold uppercase tracking-[0.08em] text-primary">
          {competitionLabel(block.competition)}
        </h2>
        {done && (
          <span className="rounded-full bg-score-wo px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-score-wo-fg">
            Terminé
          </span>
        )}
      </div>

      {block.equipes.length === 0 ? (
        <p className="rounded-xl border border-dashed border-border bg-card/50 p-5 text-center text-sm text-muted-foreground">
          Aucune équipe dans cette compétition.
        </p>
      ) : (
        <div className="overflow-x-auto rounded-[13px] border border-border bg-card py-2.5 pr-2.5">
          <div style={{ minWidth }}>
            {/* En-têtes de colonnes */}
            <div className="grid items-end gap-[7px] pb-1.5" style={{ gridTemplateColumns: template }}>
              <div className="sticky left-0 z-10 bg-card pl-2.5" />
              {colonnes.map((col) => (
                <div
                  key={col.key}
                  className={`rounded-md py-1 text-center text-[10px] font-semibold uppercase tracking-wide ${
                    col.phase === 'finale'
                      ? 'bg-finale-header text-finale-header-fg'
                      : 'text-muted-foreground'
                  } ${col.key === firstFinaleKey ? 'border-l-2 border-score-na pl-1' : ''}`}
                >
                  {col.label}
                </div>
              ))}
            </div>

            {/* Une ligne par équipe */}
            <div className="space-y-[7px]">
              {block.equipes.map((row) => (
                <div
                  key={row.equipe.id}
                  id={`equipe-${row.equipe.id}`}
                  className="grid items-stretch gap-[7px] scroll-mt-24"
                  style={{ gridTemplateColumns: template }}
                >
                  <div className="sticky left-0 z-10 flex flex-col justify-center border-r border-border bg-card pl-2.5 pr-2">
                    <Link
                      to={`/team-matches/equipe/${row.equipe.id}`}
                      className="text-sm font-bold hover:text-primary hover:underline"
                    >
                      Équipe {row.equipe.numero}
                    </Link>
                    <span className="text-[11px] text-muted-foreground">
                      {bilanLabel(row.equipe.division, row.bilan)}
                    </span>
                  </div>
                  {row.cells.map((cell) => (
                    <CellButton
                      key={cell.colonneKey}
                      cell={cell}
                      selected={cell.etape?.id === selectedEtapeId}
                      onSelect={() => cell.etape && onSelect(cell.etape.id)}
                    />
                  ))}
                </div>
              ))}
            </div>
          </div>
        </div>
      )}
    </section>
  );
}

export default function SeasonGridView({
  blocks,
  doneBlocks,
  showDone,
  onToggleDone,
  selectedEtapeId,
  onSelect,
}: {
  blocks: CompetitionBlock[];
  doneBlocks: CompetitionBlock[];
  showDone: boolean;
  onToggleDone: () => void;
  selectedEtapeId: string | null;
  onSelect: (etapeId: string) => void;
}) {
  if (blocks.length === 0 && doneBlocks.length === 0) {
    return (
      <div className="rounded-[13px] border border-dashed border-border bg-card/50 p-12 text-center text-muted-foreground">
        Aucune compétition dans cette saison. Rendez-vous dans l'Admin pour en créer une.
      </div>
    );
  }

  return (
    <div className="space-y-8">
      {blocks.map((block) => (
        <Block
          key={block.competition.id}
          block={block}
          done={false}
          selectedEtapeId={selectedEtapeId}
          onSelect={onSelect}
        />
      ))}

      {blocks.length === 0 && (
        <p className="rounded-[13px] border border-dashed border-border bg-card/50 p-8 text-center text-sm text-muted-foreground">
          Toutes les compétitions de cette saison sont marquées terminées.
        </p>
      )}

      {doneBlocks.length > 0 && (
        <div className="space-y-5 border-t border-border pt-5">
          <button
            type="button"
            onClick={onToggleDone}
            className="flex items-center gap-2 text-sm font-medium text-muted-foreground transition hover:text-foreground"
          >
            <span aria-hidden="true">{showDone ? '▾' : '▸'}</span>
            Championnats terminés ({doneBlocks.length}) — {showDone ? 'masquer' : 'afficher'}
          </button>

          {showDone && (
            <>
              <p className="text-xs text-muted-foreground">
                Championnats terminés : consultables, mais hors de la grille active.
              </p>
              {doneBlocks.map((block) => (
                <Block
                  key={block.competition.id}
                  block={block}
                  done
                  selectedEtapeId={selectedEtapeId}
                  onSelect={onSelect}
                />
              ))}
            </>
          )}
        </div>
      )}
    </div>
  );
}
