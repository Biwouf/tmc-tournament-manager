import type { Cell, CompetitionBlock } from './gridTypes';
import { CELL_CLASSES, STATE_LABELS, bilanLabel } from './gridTypes';
import { STADE_LABELS, competitionLabel } from './teamMatchLabels';

/** Phase en cours ou issue de la phase finale, en une ligne. */
function etatLabel(cells: Cell[], qualifiee: boolean | null): string {
  if (qualifiee === false) return 'Éliminée en poule';

  const finales = cells.filter((c) => c.etape?.phase === 'finale');
  const dernierJoue = [...finales].reverse().find((c) => c.rencontre);
  if (dernierJoue?.etape?.stade_finale) {
    const stade = STADE_LABELS[dernierJoue.etape.stade_finale];
    if (dernierJoue.state === 'loss') return `Éliminée en ${stade}`;
    if (dernierJoue.state === 'win' && dernierJoue.etape.stade_finale === 'finale') {
      return 'Vainqueur';
    }
    return stade;
  }
  if (qualifiee === true) return 'Phase finale';

  const poule = cells.filter((c) => c.etape?.phase === 'poule');
  const joues = poule.filter((c) => c.rencontre).length;
  const total = poule.filter((c) => c.state !== 'na').length;
  return `Poule J${joues}/${total}`;
}

export default function ListeView({
  blocks,
  doneBlocks,
  selectedEtapeId,
  onOpen,
}: {
  blocks: CompetitionBlock[];
  doneBlocks: CompetitionBlock[];
  selectedEtapeId: string | null;
  onOpen: (equipeId: string, done: boolean) => void;
}) {
  const rows = [
    ...blocks.flatMap((b) => b.equipes.map((r) => ({ block: b, row: r, done: false }))),
    ...doneBlocks.flatMap((b) => b.equipes.map((r) => ({ block: b, row: r, done: true }))),
  ];

  if (rows.length === 0) {
    return (
      <div className="rounded-[13px] border border-dashed border-border bg-card/50 p-12 text-center text-muted-foreground">
        Aucune équipe dans cette saison.
      </div>
    );
  }

  return (
    <div className="overflow-x-auto rounded-[13px] border border-border bg-card">
      <table className="w-full text-sm">
        <thead className="border-b border-border text-left text-[10px] uppercase tracking-wide text-muted-foreground">
          <tr>
            <th className="px-4 py-2.5">Équipe</th>
            <th className="px-4 py-2.5">Div.</th>
            <th className="px-4 py-2.5">Avancement</th>
            <th className="px-4 py-2.5">Bilan</th>
            <th className="px-4 py-2.5">État</th>
            <th className="px-4 py-2.5 text-right" />
          </tr>
        </thead>
        <tbody className="divide-y divide-border">
          {rows.map(({ block, row, done }) => (
            <tr key={row.equipe.id} className={done ? 'opacity-60' : undefined}>
              <td className="px-4 py-3">
                <p className="font-bold">Équipe {row.equipe.numero}</p>
                <p className="text-[11px] text-muted-foreground">
                  {competitionLabel(block.competition)}
                </p>
              </td>
              <td className="px-4 py-3">{row.equipe.division}</td>
              <td className="px-4 py-3">
                <div className="flex flex-wrap gap-1">
                  {row.cells.map((cell) => (
                    <span
                      key={cell.colonneKey}
                      title={`${cell.colonneKey} — ${STATE_LABELS[cell.state]}`}
                      className={`inline-block h-3 w-3 rounded-full ${CELL_CLASSES[cell.state]} ${
                        cell.etape?.id === selectedEtapeId ? 'ring-2 ring-foreground/30' : ''
                      }`}
                    />
                  ))}
                </div>
              </td>
              <td className="tabular px-4 py-3 text-xs text-muted-foreground">
                {bilanLabel(row.equipe.division, row.bilan).split(' · ').slice(1).join(' · ')}
              </td>
              <td className="px-4 py-3 text-xs">{etatLabel(row.cells, row.equipe.qualifiee)}</td>
              <td className="px-4 py-3 text-right">
                <button
                  type="button"
                  onClick={() => onOpen(row.equipe.id, done)}
                  className="rounded-lg border border-border bg-card px-3 py-1.5 text-xs font-medium text-muted-foreground transition hover:bg-muted"
                >
                  Ouvrir
                </button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
