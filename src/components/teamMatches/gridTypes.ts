import type {
  TeamCompetition,
  TeamEquipe,
  TeamEtape,
  TeamRencontre,
  TeamStadeFinale,
} from '../../types';

/**
 * État d'une cellule de la grille de saison.
 * L'ordre de dérivation compte (cf. brief §4.2) : `wo` passe avant les scores,
 * puisqu'un WO renseigne le score automatiquement.
 */
export type CellState = 'na' | 'none' | 'wo' | 'todo' | 'win' | 'loss' | 'draw' | 'next';

/** Une colonne = une journée de poule ou un stade de phase finale du groupe. */
export interface Colonne {
  /** Clé stable dans le bloc compétition : `J3` ou `F:1/4`. */
  key: string;
  /** En-tête court : `J3`, `1/4`, `F`. */
  label: string;
  phase: 'poule' | 'finale';
  numeroJournee: number | null;
  stadeFinale: TeamStadeFinale | null;
}

/** Une cellule = le croisement (équipe × colonne). */
export interface Cell {
  colonneKey: string;
  state: CellState;
  /** `null` quand l'équipe n'a pas cette étape (`na`). */
  etape: TeamEtape | null;
  rencontre: TeamRencontre | null;
  /** Ligne principale : `4–1`, `WO`, `· ·` ou `–`. Vide pour `na`. */
  score: string;
  /** Ligne secondaire : `à saisir`, `Nul`, le club adverse… */
  subtitle: string;
  /** Infobulle — seulement pour `na`, pour expliquer le trou. */
  title?: string;
}

/** Bilan d'une équipe. `nuls` n'est affiché que s'il est > 0 (D1). */
export interface Bilan {
  victoires: number;
  nuls: number;
  defaites: number;
}

export interface EquipeRow {
  equipe: TeamEquipe;
  bilan: Bilan;
  cells: Cell[];
}

export interface CompetitionBlock {
  competition: TeamCompetition;
  colonnes: Colonne[];
  nPoule: number;
  nFinales: number;
  equipes: EquipeRow[];
}

/** Une rencontre à plat avec tout son contexte — vues Agenda, Liste et affiche. */
export interface RencontreEntry {
  rencontre: TeamRencontre;
  etape: TeamEtape;
  equipe: TeamEquipe;
  competition: TeamCompetition;
  state: CellState;
}

/** Contexte complet d'une cellule sélectionnée, indexé par `etape.id`. */
export interface CellRef {
  competition: TeamCompetition;
  equipe: TeamEquipe;
  etape: TeamEtape;
  rencontre: TeamRencontre | null;
  colonne: Colonne;
  state: CellState;
}

export interface GridCounters {
  aSaisir: number;
  equipesEnCours: number;
  ceWeekEnd: number;
}

/** Largeur minimale d'une ligne de grille — calculée, jamais codée en dur. */
export const COL_EQUIPE_W = 186;
export const COL_POULE_W = 112;
export const COL_FINALE_W = 108;
export const GRID_GAP = 7;

export function gridMinWidth(nPoule: number, nFinales: number): number {
  return (
    COL_EQUIPE_W +
    nPoule * COL_POULE_W +
    nFinales * COL_FINALE_W +
    (nPoule + nFinales) * GRID_GAP
  );
}

export function gridTemplateColumns(nPoule: number, nFinales: number): string {
  return [
    `${COL_EQUIPE_W}px`,
    nPoule > 0 ? `repeat(${nPoule}, minmax(${COL_POULE_W}px, 1fr))` : '',
    nFinales > 0 ? `repeat(${nFinales}, ${COL_FINALE_W}px)` : '',
  ]
    .filter(Boolean)
    .join(' ');
}

/** Classes Tailwind d'une cellule selon son état. */
export const CELL_CLASSES: Record<CellState, string> = {
  na: 'cell-na border border-dashed border-score-na text-transparent',
  none: 'border border-border bg-card text-muted-foreground',
  wo: 'border border-transparent bg-score-wo text-score-wo-fg',
  todo: 'border border-transparent bg-score-todo text-score-todo-fg',
  win: 'border border-score-win-border bg-score-win text-score-win-fg',
  loss: 'border border-score-loss-border bg-score-loss text-score-loss-fg',
  draw: 'border border-score-draw-border bg-score-draw text-score-draw-fg',
  next: 'border border-transparent bg-score-next text-score-next-fg',
};

export const STATE_LABELS: Record<CellState, string> = {
  na: 'Non applicable',
  none: 'À programmer',
  wo: 'WO',
  todo: 'Score à saisir',
  win: 'Victoire',
  loss: 'Défaite',
  draw: 'Nul',
  next: 'À venir',
};
