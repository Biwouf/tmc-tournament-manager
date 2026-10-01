import { Link } from 'react-router-dom';
import type { LiveMatch } from '../../types';
import {
  getTeamLabel,
  getNormalSetWinner,
  getSet,
  getSet3Normal,
  isSet3Needed,
} from '../../liveScoreRules';
import {
  activeSet,
  quickScore,
  quickScoreLabel,
} from '../../lib/liveScoreActions';
export default function LiveScoreboard({
  match,
  canAnimate,
  blocked,
  saving,
  scoreError,
  canUndo,
  onOpenScore,
  onReload,
  onUndo,
  onStart,
  onScore,
}: {
  match: LiveMatch;
  canAnimate: boolean;
  blocked: boolean;
  saving: boolean;
  scoreError: string | null;
  canUndo: boolean;
  onOpenScore: () => void;
  onReload: () => void;
  onUndo: () => void;
  onStart: () => void;
  onScore: (patch: Partial<LiveMatch>) => void;
}) {
  const currentSet = activeSet(match);
  const quickAvailable = !!quickScore(match, 'j1');
  return (
    <section className="live-score" aria-label="Score du match">
      <div className="score-meta">
        <span
          className={
            match.status === 'finished' ? 'status-finished' : 'status-live'
          }
        >
          {match.status === 'live'
            ? '● LIVE'
            : match.status === 'pending'
              ? 'À VENIR'
              : 'TERMINÉ'}
        </span>
        <span>
          {match.court
            ? `Court ${match.court}`
            : match.match_type === 'double'
              ? 'Double'
              : 'Simple'}
          {match.status === 'live' && ` · Set ${currentSet}`}
        </span>
      </div>
      <table className="score-table">
        <thead>
          <tr>
            <th scope="col">
              {match.match_type === 'double' ? 'Équipes' : 'Joueurs'}
            </th>
            {[1, 2, 3].map((n) => (
              <th key={n} scope="col">
                S{n}
              </th>
            ))}
            {canAnimate && match.status === 'live' && (
              <th scope="col">
                <span className="sr-only">Ajouter au score</span>
              </th>
            )}
          </tr>
        </thead>
        <tbody>
          {(['j1', 'j2'] as const).map((side, i) => (
            <tr key={side}>
              <th scope="row">
                <span
                  className="player-name"
                  title={getTeamLabel(match, i === 0 ? 1 : 2)}
                >
                  {getTeamLabel(match, i === 0 ? 1 : 2)}
                  {match.winner === side && ' 🏆'}
                </span>
              </th>
              {([1, 2, 3] as const).map((n) => {
                const value = match[`set${n}_${side}`];
                const tb = match[`set${n}_tb_${side}`];
                const normal =
                  n === 3 ? getSet3Normal(match) : getSet(match, n);
                const winner =
                  n === 3 && match.set3_format === 'super_tiebreak'
                    ? match.winner
                    : getNormalSetWinner(normal);
                return (
                  <td
                    key={`${n}:${value}:${tb}`}
                    className={
                      match.status === 'live' && n === currentSet
                        ? 'current-set score-changed'
                        : winner && winner !== side
                          ? 'lost-set'
                          : ''
                    }
                  >
                    {value ??
                      (n === currentSet &&
                      match.status === 'live' &&
                      (n !== 3 || isSet3Needed(match))
                        ? 0
                        : '–')}
                    {tb !== null && <sup>{tb}</sup>}
                  </td>
                );
              })}
              {canAnimate && match.status === 'live' && (
                <td className="score-action">
                  <button
                    disabled={blocked || !quickAvailable}
                    aria-label={`${quickScoreLabel(match)} pour ${getTeamLabel(match, i === 0 ? 1 : 2)}`}
                    onClick={() => {
                      const patch = quickScore(match, side);
                      if (patch) onScore(patch);
                    }}
                  >
                    {quickScoreLabel(match)}
                  </button>
                </td>
              )}
            </tr>
          ))}
        </tbody>
      </table>
      {match.retired_player && (
        <p className="live-note">
          Abandon de{' '}
          {getTeamLabel(match, match.retired_player === 'j1' ? 1 : 2)}
        </p>
      )}
      {canAnimate && (
        <div className="score-tools">
          <button onClick={() => onOpenScore()}>
            {match.status === 'pending'
              ? 'Préparer le score'
              : 'Corriger le score'}
          </button>
          <span role="status">
            {saving
              ? 'Enregistrement…'
              : scoreError
                ? 'Score à vérifier'
                : 'Synchronisé'}
          </span>
          {canUndo && (
            <button className="undo-score" disabled={blocked} onClick={onUndo}>
              ↶ Annuler
            </button>
          )}
        </div>
      )}
      {match.status === 'live' &&
        canAnimate &&
        currentSet === 3 &&
        !match.set3_format && (
          <button className="live-note" onClick={() => onOpenScore()}>
            Choisir le format du set décisif →
          </button>
        )}
      {match.status === 'pending' && canAnimate && (
        <button className="start-live" disabled={blocked} onClick={onStart}>
          Démarrer le live
        </button>
      )}
      {match.team_rencontre_id &&
        match.status === 'finished' &&
        !match.team_result_confirmed && (
          <Link
            className="live-note"
            to={`/matches-equipes/${match.team_rencontre_id}`}
          >
            Valider le résultat dans la rencontre →
          </Link>
        )}
      {scoreError && (
        <p role="alert" className="live-error">
          {scoreError}{' '}
          <button onClick={() => onReload()}>Recharger le score</button>
        </p>
      )}
    </section>
  );
}
