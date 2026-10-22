import type { LiveMatch, LiveMatchWinner } from '../../types';
import { getTeamLabel } from '../../liveScoreRules';

// Choix du premier serveur : « Je ne sais pas » enregistre null (pas d'indicateur).
export default function FirstServerPicker({
  match,
  title,
  disabled,
  showCurrent,
  onPick,
}: {
  match: LiveMatch;
  title: string;
  disabled: boolean;
  showCurrent: boolean;
  onPick: (side: LiveMatchWinner | null) => void;
}) {
  const options: [LiveMatchWinner | null, string][] = [
    ['j1', getTeamLabel(match, 1)],
    ['j2', getTeamLabel(match, 2)],
    [null, 'Je ne sais pas'],
  ];
  return (
    <div className="serve-picker" role="group" aria-label={title}>
      <p>{title}</p>
      {options.map(([side, label]) => (
        <button
          key={side ?? 'unknown'}
          type="button"
          disabled={disabled}
          aria-pressed={showCurrent ? match.first_server === side : undefined}
          onClick={() => onPick(side)}
        >
          {label}
        </button>
      ))}
    </div>
  );
}
