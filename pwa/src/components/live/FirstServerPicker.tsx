import type { LiveMatch } from '../../types';
import { getTeamLabel, type Player } from '../../liveScoreRules';

// Choix du côté au service : un bouton par joueur/équipe, puis une action secondaire
// (« Déjà commencé » au démarrage, « Effacer » en cours de match).
export default function FirstServerPicker({
  match,
  title,
  disabled,
  current,
  onPick,
  extraLabel,
  extraDisabled = false,
  onExtra,
}: {
  match: LiveMatch;
  title: string;
  disabled: boolean;
  /** Côté au service affiché comme sélectionné ; undefined = pas d'état. */
  current?: Player | null;
  onPick: (side: Player) => void;
  extraLabel: string;
  extraDisabled?: boolean;
  onExtra: () => void;
}) {
  const sides: [Player, string][] = [
    ['j1', getTeamLabel(match, 1)],
    ['j2', getTeamLabel(match, 2)],
  ];
  return (
    <div className="serve-picker" role="group" aria-label={title}>
      <p>{title}</p>
      {sides.map(([side, label]) => (
        <button
          key={side}
          type="button"
          disabled={disabled}
          aria-pressed={current === undefined ? undefined : current === side}
          onClick={() => onPick(side)}
        >
          {label}
        </button>
      ))}
      <button type="button" disabled={disabled || extraDisabled} onClick={onExtra}>
        {extraLabel}
      </button>
    </div>
  );
}
