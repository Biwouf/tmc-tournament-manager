import { useRef, useState } from 'react';
import type { LiveMatch } from '../../types';
import { getTeamLabel } from '../../liveScoreRules';
import { recapSets, winnerFirst, type LiveRecap as Recap } from '../../lib/liveRecap';
import LiveReplay from './LiveReplay';

const plural = (n: number, one: string, many: string) =>
  `${n} ${n > 1 ? many : one}`;

/** Accroche en fin de fil d'un live terminé, qui ouvre la story « Revivre le match ». */
export default function LiveRecap({
  match,
  recap,
}: {
  match: LiveMatch;
  recap: Recap;
}) {
  const [open, setOpen] = useState(false);
  const opener = useRef<HTMLButtonElement>(null);
  const sets = recapSets(match, recap.score);
  const stats = [
    plural(recap.messages + recap.photos + recap.polls, 'publication', 'publications'),
    plural(recap.reactions, 'réaction', 'réactions'),
    recap.viewers !== null && plural(recap.viewers, 'spectateur', 'spectateurs'),
  ].filter(Boolean);
  return (
    <section className="live-recap" aria-label="Récap du match">
      <span className="replay-kicker">RÉCAP DU MATCH</span>
      {match.winner && (
        <h3>
          Victoire de {getTeamLabel(match, match.winner === 'j1' ? 1 : 2)}
          {match.retired_player && ' (abandon)'}
        </h3>
      )}
      <p className="recap-score">
        {sets.map((s) => (
          <span key={s.set} className="recap-set-score">
            {winnerFirst(s.score, match.winner).join('–')}
            {s.tiebreak && <sup>{Math.min(...s.tiebreak)}</sup>}
          </span>
        ))}
      </p>
      <p className="recap-stats">{stats.join(' · ')}</p>
      <button ref={opener} className="replay-cta" onClick={() => setOpen(true)}>
        ▶ Revivre le match
      </button>
      {open && (
        <LiveReplay
          match={match}
          recap={recap}
          onClose={() => {
            setOpen(false);
            opener.current?.focus();
          }}
        />
      )}
    </section>
  );
}
