import type { LiveMatch } from '../types';
import { getSet, getSet3Normal, getSet3SuperTb, getNormalSetWinner, getTeamLabel } from '../liveScoreRules';

interface Props {
  match: LiveMatch;
  onPrimary: () => void; // "Démarrer le live" / "Reprendre" / "Voir"
  onDelete: () => void;
}

function formatDate(iso: string): string {
  return new Date(iso + 'T00:00:00').toLocaleDateString('fr-FR', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
  });
}

function renderSetScore(j1: number, j2: number, tbj1: number | null, tbj2: number | null): string {
  if (j1 === 0 && j2 === 0 && tbj1 === null) return '';
  const base = `${j1}/${j2}`;
  // Only show tb score if set is finished 7/6 via tb
  if ((j1 === 7 && j2 === 6) || (j2 === 7 && j1 === 6)) {
    const w = getNormalSetWinner({ j1, j2, tb_j1: tbj1, tb_j2: tbj2 });
    if (w !== null && tbj1 !== null && tbj2 !== null) {
      const loserTb = w === 'j1' ? tbj2 : tbj1;
      return `${base} (${loserTb})`;
    }
  }
  // During tiebreak, show tb points
  if (j1 === 6 && j2 === 6 && tbj1 !== null && tbj2 !== null) {
    return `${base} — TB ${tbj1}/${tbj2}`;
  }
  return base;
}

function scoreSummary(m: LiveMatch): string[] {
  const parts: string[] = [];
  const s1 = getSet(m, 1);
  const str1 = renderSetScore(s1.j1, s1.j2, s1.tb_j1, s1.tb_j2);
  if (str1) parts.push(`S1 ${str1}`);
  const s2 = getSet(m, 2);
  const str2 = renderSetScore(s2.j1, s2.j2, s2.tb_j1, s2.tb_j2);
  if (str2) parts.push(`S2 ${str2}`);
  if (m.set3_format === 'super_tiebreak') {
    const s3 = getSet3SuperTb(m);
    if (s3.j1 > 0 || s3.j2 > 0) parts.push(`STB ${s3.j1}/${s3.j2}`);
  } else if (m.set3_format === 'normal') {
    const s3 = getSet3Normal(m);
    const str3 = renderSetScore(s3.j1, s3.j2, s3.tb_j1, s3.tb_j2);
    if (str3) parts.push(`S3 ${str3}`);
  }
  return parts;
}

function needsDeletionBadge(m: LiveMatch): boolean {
  if (m.status !== 'finished' || !m.finished_at) return false;
  const twoDaysMs = 2 * 24 * 60 * 60 * 1000;
  return Date.now() - new Date(m.finished_at).getTime() > twoDaysMs;
}

export default function LiveMatchCard({ match, onPrimary, onDelete }: Props) {
  const primaryLabel =
    match.status === 'pending' ? 'Démarrer le live' : match.status === 'live' ? 'Reprendre' : 'Voir';

  const statusStyles: Record<LiveMatch['status'], string> = {
    pending: 'bg-slate-100 text-slate-700',
    live: 'bg-red-100 text-red-700 animate-pulse',
    finished: 'bg-emerald-100 text-emerald-700',
  };
  const statusLabels: Record<LiveMatch['status'], string> = {
    pending: 'En attente',
    live: 'LIVE',
    finished: 'Terminé',
  };

  const scores = scoreSummary(match);
  const toDelete = needsDeletionBadge(match);

  return (
    <div className="flex flex-col rounded-2xl border bg-card/90 p-6 shadow-sm transition hover:shadow-md">
      <div className="mb-3 flex items-center gap-2">
        <span className={`rounded-full px-2.5 py-0.5 text-xs font-medium ${statusStyles[match.status]}`}>
          {statusLabels[match.status]}
        </span>
        <span className="text-xs font-medium text-muted-foreground">
          {match.match_type === 'double' ? 'Double' : 'Simple'}
        </span>
        {toDelete && (
          <span className="ml-auto rounded-full bg-red-100 px-2.5 py-0.5 text-xs font-medium text-red-700">
            À supprimer
          </span>
        )}
      </div>

      <div className="space-y-1 text-sm">
        <div
          className={
            match.winner === 'j1'
              ? 'flex items-center gap-2 font-bold text-foreground'
              : match.winner === 'j2'
                ? 'font-medium text-muted-foreground'
                : 'font-medium text-card-foreground'
          }
        >
          {match.winner === 'j1' && <img src="/trophy.png" alt="Vainqueur" className="h-4 w-4" />}
          {getTeamLabel(match, 1)}
        </div>
        <div
          className={
            match.winner === 'j2'
              ? 'flex items-center gap-2 font-bold text-foreground'
              : match.winner === 'j1'
                ? 'font-medium text-muted-foreground'
                : 'font-medium text-card-foreground'
          }
        >
          {match.winner === 'j2' && <img src="/trophy.png" alt="Vainqueur" className="h-4 w-4" />}
          {getTeamLabel(match, 2)}
        </div>
      </div>

      <p className="mt-3 text-xs text-muted-foreground">
        {formatDate(match.match_date)}
        {match.start_time && ` — ${match.start_time.slice(0, 5)}`}
      </p>

      {scores.length > 0 && (
        <p className="mt-2 font-mono text-sm text-foreground">{scores.join('  ·  ')}</p>
      )}

      <div className="mt-4 flex gap-2 pt-2">
        <button
          onClick={onPrimary}
          className="rounded-lg bg-primary px-3 py-1.5 text-sm font-medium text-primary-foreground shadow-sm transition hover:brightness-95"
        >
          {primaryLabel}
        </button>
        <button
          onClick={onDelete}
          className="ml-auto rounded-lg border border-red-200 bg-red-50 px-3 py-1.5 text-sm font-medium text-red-700 transition hover:bg-red-100"
        >
          Supprimer
        </button>
      </div>
    </div>
  );
}
