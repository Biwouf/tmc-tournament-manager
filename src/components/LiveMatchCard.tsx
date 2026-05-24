import { useState } from 'react';
import type { LiveMatch, LiveMatchWinner } from '../types';
import LivePulse from './LivePulse';
import AnimatedScoreCell from './AnimatedScoreCell';

interface Props {
  match: LiveMatch;
  isOwnLive: boolean;
  onPrimary: () => void; // "Démarrer" / "Reprendre" / "Prendre le contrôle" / "Voir"
  onDelete: () => void;
}

interface SetState {
  j1: number;
  j2: number;
  tbJ1: number | null;
  tbJ2: number | null;
  winner: LiveMatchWinner | null;
}

interface SetCell {
  value: number;
  tb: number | null;
  emphasized: boolean;
  animate: boolean;
}

interface TeamMember {
  prenom: string;
  nom: string;
  classement: string | null;
  club: string | null;
}

function formatDate(iso: string): string {
  return new Date(iso + 'T00:00:00').toLocaleDateString('fr-FR', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
  });
}

function computeSetWinner(j1: number, j2: number, isSuperTb: boolean): LiveMatchWinner | null {
  const max = Math.max(j1, j2);
  const min = Math.min(j1, j2);
  const diff = max - min;
  const finished = isSuperTb
    ? max >= 10 && diff >= 2
    : (max === 7 && (min === 5 || min === 6)) || (max === 6 && diff >= 2);
  if (!finished) return null;
  return j1 > j2 ? 'j1' : 'j2';
}

function buildSets(match: LiveMatch): SetState[] {
  const isSuper3 = match.set3_format === 'super_tiebreak';
  const raw = [
    { j1: match.set1_j1, j2: match.set1_j2, tbJ1: match.set1_tb_j1, tbJ2: match.set1_tb_j2, isSuper: false },
    { j1: match.set2_j1, j2: match.set2_j2, tbJ1: match.set2_tb_j1, tbJ2: match.set2_tb_j2, isSuper: false },
    { j1: match.set3_j1, j2: match.set3_j2, tbJ1: match.set3_tb_j1, tbJ2: match.set3_tb_j2, isSuper: isSuper3 },
  ];
  return raw
    .filter((s) => s.j1 !== null && s.j2 !== null)
    .map((s) => ({
      j1: s.j1!,
      j2: s.j2!,
      tbJ1: s.tbJ1,
      tbJ2: s.tbJ2,
      winner: computeSetWinner(s.j1!, s.j2!, s.isSuper),
    }));
}

function cellsForSide(sets: SetState[], side: LiveMatchWinner, activeSetIndex: number): SetCell[] {
  return sets.map((s, i) => ({
    value: side === 'j1' ? s.j1 : s.j2,
    tb: side === 'j1' ? s.tbJ1 : s.tbJ2,
    emphasized: s.winner === side,
    animate: i === activeSetIndex,
  }));
}

function teamMembers(match: LiveMatch, side: LiveMatchWinner): TeamMember[] {
  if (side === 'j1') {
    const members: TeamMember[] = [
      { prenom: match.j1_prenom, nom: match.j1_nom, classement: match.j1_classement, club: match.j1_club },
    ];
    if (match.match_type === 'double' && match.j3_prenom && match.j3_nom) {
      members.push({
        prenom: match.j3_prenom,
        nom: match.j3_nom,
        classement: match.j3_classement,
        club: match.j3_club,
      });
    }
    return members;
  }
  const members: TeamMember[] = [
    { prenom: match.j2_prenom, nom: match.j2_nom, classement: match.j2_classement, club: match.j2_club },
  ];
  if (match.match_type === 'double' && match.j4_prenom && match.j4_nom) {
    members.push({
      prenom: match.j4_prenom,
      nom: match.j4_nom,
      classement: match.j4_classement,
      club: match.j4_club,
    });
  }
  return members;
}

function needsDeletionBadge(m: LiveMatch): boolean {
  if (m.status !== 'finished' || !m.finished_at) return false;
  const twoDaysMs = 2 * 24 * 60 * 60 * 1000;
  return Date.now() - new Date(m.finished_at).getTime() > twoDaysMs;
}

function winnerName(match: LiveMatch): string {
  if (match.winner === 'j1') return `${match.j1_prenom} ${match.j1_nom}`;
  if (match.winner === 'j2') return `${match.j2_prenom} ${match.j2_nom}`;
  return '';
}

function TrophyIcon() {
  return (
    <svg className="w-5 h-5 text-amber-500 shrink-0" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
      <path d="M5 4h14v3a5 5 0 01-4 4.9V14h2v2H7v-2h2v-2.1A5 5 0 015 7V4zm2 2v1a3 3 0 002.4 2.94L10 10V6H7zm10 0h-3v4l.6-.06A3 3 0 0017 7V6zM6 18h12v2H6v-2z" />
    </svg>
  );
}

function KebabIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
      <circle cx="5" cy="12" r="2" />
      <circle cx="12" cy="12" r="2" />
      <circle cx="19" cy="12" r="2" />
    </svg>
  );
}

function ScoreCell({ value, tb, emphasized, animate }: SetCell) {
  return (
    <AnimatedScoreCell
      value={value}
      tb={tb}
      animate={animate}
      className={`w-12 h-12 rounded-lg text-2xl font-bold tabular-nums ${
        emphasized ? 'bg-foreground text-background shadow-sm' : 'bg-slate-100 text-slate-700'
      }`}
      tbClassName="absolute top-1.5 right-1.5 text-[10px] font-bold opacity-80 leading-none"
    />
  );
}

function PlayerLine({ member, isWinner }: { member: TeamMember; isWinner: boolean }) {
  return (
    <div className="flex items-baseline gap-2 min-w-0">
      <span
        className={`text-lg truncate text-foreground ${isWinner ? 'font-bold' : 'font-semibold'}`}
      >
        {member.prenom} {member.nom}
      </span>
      {member.classement && (
        <span className="text-[11px] font-semibold text-slate-500 px-1.5 py-0.5 bg-slate-100 rounded shrink-0">
          {member.classement}
        </span>
      )}
      {member.club && (
        <span className="text-xs text-slate-500 truncate shrink-0">· {member.club}</span>
      )}
    </div>
  );
}

function TeamBlock({
  members,
  isWinner,
  cells,
}: {
  members: TeamMember[];
  isWinner: boolean;
  cells: SetCell[];
}) {
  return (
    <div className="flex items-center justify-between gap-4 py-3">
      <div className="flex items-center gap-3 min-w-0 flex-1">
        {isWinner ? <TrophyIcon /> : <span className="w-5 h-5 shrink-0" />}
        <div className="flex flex-col gap-1 min-w-0">
          {members.map((m, i) => (
            <PlayerLine key={i} member={m} isWinner={isWinner} />
          ))}
        </div>
      </div>
      <div className="flex items-center gap-1.5 shrink-0">
        {cells.map((c, i) => (
          <ScoreCell key={i} {...c} />
        ))}
      </div>
    </div>
  );
}

function KebabMenu({
  status,
  isOwnLive,
  onPrimary,
  onDelete,
}: {
  status: LiveMatch['status'];
  isOwnLive: boolean;
  onPrimary: () => void;
  onDelete: () => void;
}) {
  const [open, setOpen] = useState(false);
  const primaryLabel =
    status === 'pending'
      ? 'Démarrer'
      : status === 'live'
        ? isOwnLive
          ? 'Reprendre'
          : 'Prendre le contrôle'
        : 'Voir';

  return (
    <div className="relative">
      <button
        onClick={() => setOpen((o) => !o)}
        className="w-9 h-9 rounded-lg flex items-center justify-center text-slate-400 hover:bg-slate-100 hover:text-slate-700 transition"
        aria-label="Options"
      >
        <KebabIcon />
      </button>
      {open && (
        <>
          <div className="fixed inset-0 z-10" onClick={() => setOpen(false)} />
          <div className="absolute right-0 top-10 z-20 w-44 rounded-xl border border-slate-200 bg-white shadow-lg py-1 text-sm">
            <button
              onClick={() => {
                setOpen(false);
                onPrimary();
              }}
              className="w-full text-left px-3 py-2 hover:bg-slate-50 font-medium text-slate-800"
            >
              {primaryLabel}
            </button>
            <button
              onClick={() => {
                setOpen(false);
                onDelete();
              }}
              className="w-full text-left px-3 py-2 hover:bg-red-50 text-red-600"
            >
              Supprimer
            </button>
          </div>
        </>
      )}
    </div>
  );
}

export default function LiveMatchCard({ match, isOwnLive, onPrimary, onDelete }: Props) {
  const isLive = match.status === 'live';
  const isFinished = match.status === 'finished';
  const isPending = match.status === 'pending';

  const sets = buildSets(match);
  const activeSetIndex = isLive ? sets.findIndex((s) => s.winner === null) : -1;
  const cellsJ1 = cellsForSide(sets, 'j1', activeSetIndex);
  const cellsJ2 = cellsForSide(sets, 'j2', activeSetIndex);
  const toDelete = needsDeletionBadge(match);

  const cardClass = isLive
    ? 'border-red-200 shadow-[0_0_0_1px_rgba(229,24,40,0.12),0_8px_30px_rgba(229,24,40,0.08)]'
    : 'border-slate-200 shadow-sm';

  const courtClass = isLive
    ? 'bg-red-600 text-white'
    : isFinished
      ? 'bg-slate-800 text-white'
      : 'bg-amber-100 text-amber-900 border border-amber-200';

  return (
    <article
      className={`relative rounded-2xl border bg-white overflow-hidden transition hover:shadow-md ${cardClass}`}
    >
      {/* HERO BAR : court · type · status · kebab */}
      <div className="flex items-stretch border-b border-slate-100">
        <div
          className={`flex flex-col items-start justify-center px-5 py-3 min-w-[140px] ${courtClass}`}
        >
          <span className="text-[10px] font-semibold tracking-[0.18em] uppercase opacity-80">
            Court
          </span>
          <span className="text-xl font-bold leading-tight">
            {match.court ?? <span className="opacity-60">— non assigné —</span>}
          </span>
        </div>
        <div className="flex-1 flex items-center justify-between px-5 py-3 gap-3">
          <div className="flex items-center gap-2 min-w-0 flex-wrap">
            {match.type_tournoi && (
              <span className="inline-flex items-center rounded-md px-2 py-0.5 text-[11px] font-semibold tracking-wide uppercase bg-slate-900 text-white">
                {match.type_tournoi}
              </span>
            )}
            <span className="inline-flex items-center rounded-md px-2 py-0.5 text-[11px] font-semibold tracking-wide uppercase bg-slate-100 text-slate-600">
              {match.match_type === 'double' ? 'Double' : 'Simple'}
            </span>
            {toDelete && (
              <span className="inline-flex items-center rounded-md px-2 py-0.5 text-[11px] font-semibold tracking-wide uppercase bg-red-100 text-red-700">
                À supprimer
              </span>
            )}
          </div>
          <div className="flex items-center gap-3 shrink-0">
            {isLive && (
              <span className="inline-flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wider text-red-600">
                <LivePulse />
                en direct
              </span>
            )}
            {isPending && (
              <span className="inline-flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wider text-slate-700">
                <span className="h-2 w-2 rounded-full bg-slate-400" />
                En attente
              </span>
            )}
            {isFinished && (
              <span className="inline-flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wider text-emerald-700">
                <span className="h-2 w-2 rounded-full bg-emerald-500" />
                Terminé
              </span>
            )}
            <KebabMenu
              status={match.status}
              isOwnLive={isOwnLive}
              onPrimary={onPrimary}
              onDelete={onDelete}
            />
          </div>
        </div>
      </div>

      {/* SCOREBOARD */}
      <div className="px-5 py-2 divide-y divide-slate-100">
        <TeamBlock
          members={teamMembers(match, 'j1')}
          isWinner={match.winner === 'j1'}
          cells={cellsJ1}
        />
        <TeamBlock
          members={teamMembers(match, 'j2')}
          isWinner={match.winner === 'j2'}
          cells={cellsJ2}
        />
      </div>

      {/* FOOTER */}
      <div className="flex items-center justify-between px-5 py-2.5 bg-slate-50/70 border-t border-slate-100 text-xs text-slate-500 gap-3">
        <span className="tabular-nums">
          {formatDate(match.match_date)}
          {match.start_time && ` · ${match.start_time.slice(0, 5)}`}
        </span>
        {isLive && (
          <span className="font-semibold text-red-600 truncate">Live · en cours</span>
        )}
        {isFinished && match.winner && (
          <span className="flex items-center gap-2 min-w-0">
            <span className="font-semibold text-emerald-700 truncate">
              Vainqueur : {winnerName(match)}
            </span>
            {match.retired_player !== null && (
              <span className="inline-flex items-center rounded-md px-2 py-0.5 text-[11px] font-semibold tracking-wide uppercase bg-amber-100 text-amber-800 shrink-0">
                Abandon
              </span>
            )}
          </span>
        )}
      </div>
    </article>
  );
}
