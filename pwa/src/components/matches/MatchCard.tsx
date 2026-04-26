// Carte d'un match — gère les 3 statuts : pending, live, finished.
// Les matchs "live" ont une bordure primaire + badge LIVE animé.

import type { LiveMatch } from '../../types';
import LiveBadge from './LiveBadge';

interface Props {
  match: LiveMatch;
}

function playerLabel(match: LiveMatch, side: 'j1' | 'j2'): string {
  if (match.match_type === 'simple') {
    const prenom = match[`${side}_prenom`];
    const nom = match[`${side}_nom`];
    return `${prenom} ${nom}`;
  }
  // Double : affiche les deux partenaires
  const p1 = `${match[`${side}_prenom`]} ${match[`${side}_nom`]}`;
  const partner = side === 'j1'
    ? (match.j3_prenom ? `${match.j3_prenom} ${match.j3_nom}` : '')
    : (match.j4_prenom ? `${match.j4_prenom} ${match.j4_nom}` : '');
  return partner ? `${p1} / ${partner}` : p1;
}

function ScoreDisplay({ match }: { match: LiveMatch }) {
  const sets = [
    { j1: match.set1_j1, j2: match.set1_j2 },
    { j1: match.set2_j1, j2: match.set2_j2 },
    { j1: match.set3_j1, j2: match.set3_j2 },
  ].filter((s) => s.j1 !== null && s.j2 !== null);

  if (sets.length === 0) return null;

  return (
    <div className="flex gap-2 text-sm font-mono font-semibold">
      {sets.map((s, i) => (
        <span key={i} className="bg-muted px-2 py-0.5 rounded">
          {s.j1} – {s.j2}
        </span>
      ))}
    </div>
  );
}

export default function MatchCard({ match }: Props) {
  const isLive = match.status === 'live';
  const isPending = match.status === 'pending';
  const isFinished = match.status === 'finished';

  return (
    <div className={`bg-card rounded-xl p-4 shadow-sm border flex flex-col gap-3 ${isLive ? 'border-primary' : 'border-border'}`}>
      {/* En-tête : badge statut + heure */}
      <div className="flex items-center justify-between">
        {isLive && <LiveBadge />}
        {isPending && match.start_time && (
          <span className="text-xs text-muted-foreground">
            Commence à {match.start_time.slice(0, 5)}
          </span>
        )}
        {isFinished && (
          <span className="text-xs text-muted-foreground font-medium">Terminé</span>
        )}
        <span className="text-xs text-muted-foreground ml-auto">
          {match.match_type === 'double' ? 'Double' : 'Simple'}
        </span>
      </div>

      {/* Joueurs + score */}
      <div className="flex flex-col gap-1">
        <div className="flex items-center justify-between gap-2">
          <span className={`text-sm font-medium ${match.winner === 'j1' ? 'text-primary font-bold' : 'text-foreground'}`}>
            {playerLabel(match, 'j1')}
          </span>
        </div>
        <div className="flex items-center justify-between gap-2">
          <span className={`text-sm font-medium ${match.winner === 'j2' ? 'text-primary font-bold' : 'text-foreground'}`}>
            {playerLabel(match, 'j2')}
          </span>
        </div>
      </div>

      {/* Score si live ou finished */}
      {(isLive || isFinished) && <ScoreDisplay match={match} />}
    </div>
  );
}
