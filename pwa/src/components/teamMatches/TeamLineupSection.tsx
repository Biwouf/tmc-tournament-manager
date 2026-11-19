import { useEffect, useState } from 'react';
import { Link, useLocation } from 'react-router-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { fromHere } from '../layout/useGoBack';
import TeamLineupEditor from './TeamLineupEditor';
import { COMPO_COPY as T, playersLabel } from '../../../../shared/teamCompoCopy.mjs';
import { LINEUP_SUMMARIES_KEY, fetchLineup, fullName, lineupKey, type LineupPlayer, type TeamLineup } from '../../lib/teamLineup';

/** Pastille d'initiales : moi en rouge plein, membre en gris, sans compte en pointillé. */
function Initials({ player }: { player: LineupPlayer }) {
  const tone = player.is_me ? 'bg-primary text-primary-foreground'
    : player.is_guest ? 'border border-dashed border-muted-foreground text-muted-foreground' : 'bg-muted text-foreground';
  return <span aria-hidden className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-xs font-bold ${tone}`}>{player.initials}</span>;
}

function PlayerLine({ player }: { player: LineupPlayer }) {
  const tags = [player.is_me && T.you, player.is_captain && T.captain].filter(Boolean) as string[];
  const label = [fullName(player), ...tags, player.is_guest && T.guest, player.classement].filter(Boolean).join(', ');
  return <li aria-label={label} className={`flex min-h-14 items-center gap-3 px-4 py-2 ${player.is_me ? 'bg-primary/5' : ''}`}>
    <Initials player={player} />
    <span className="min-w-0 flex-1">
      <span className="flex flex-wrap items-center gap-x-2 gap-y-1">
        <span className="text-[15px] font-medium">{fullName(player)}</span>
        {player.is_me && <span className="rounded-full bg-primary px-2 py-0.5 text-xs font-bold text-primary-foreground">{T.you}</span>}
        {player.is_captain && <span className="rounded-full bg-muted px-2 py-0.5 text-xs font-semibold">{T.captain}</span>}
      </span>
      {player.is_guest && <span className="block text-sm text-muted-foreground">{T.guest}</span>}
    </span>
    {player.classement && <span className="shrink-0 rounded-md bg-muted px-2 py-1 text-sm font-semibold tabular-nums">{player.classement}</span>}
  </li>;
}

/**
 * Section « Compo » de la fiche rencontre (brief compo-equipes §4, §7) : liste des joueurs retenus,
 * visible de toute personne connectée, modifiable par le capitaine de l'équipe ou un admin.
 * Un visiteur voit un verrou, qu'une liste existe ou non.
 */
export default function TeamLineupSection({ clubId, rencontreId, signedIn, started }: {
  clubId: string; rencontreId: string; signedIn: boolean; started: boolean;
}) {
  const location = useLocation();
  const queryClient = useQueryClient();
  const [editing, setEditing] = useState(false);
  const [saved, setSaved] = useState(false);
  const query = useQuery({
    queryKey: lineupKey(clubId, rencontreId), enabled: signedIn,
    queryFn: () => fetchLineup(clubId, rencontreId),
  });
  useEffect(() => {
    if (!saved) return;
    const timer = setTimeout(() => setSaved(false), 3000);
    return () => clearTimeout(timer);
  }, [saved]);

  if (!signedIn) {
    // Rencontre commencée : la feuille de match (publique) a pris le relais, inutile d'insister.
    if (started) return null;
    return <section aria-labelledby="compo-title" className="space-y-3">
      <h2 id="compo-title" className="text-lg font-bold">{T.title}</h2>
      <div className="space-y-3 rounded-2xl border border-border bg-card p-5 text-center">
        <p className="font-bold">{T.lockedTitle}</p>
        <p className="text-sm text-muted-foreground">{T.lockedText}</p>
        <Link to="/login" state={fromHere(location)} className="flex min-h-12 w-full items-center justify-center rounded-xl bg-primary px-4 font-semibold text-primary-foreground">{T.login}</Link>
        <Link to="/inscription" className="flex min-h-11 items-center justify-center text-sm font-semibold text-primary underline underline-offset-2">{T.signup}</Link>
      </div>
    </section>;
  }
  if (query.isPending) return <div className="sk h-32 rounded-2xl" role="status" aria-label="Chargement de la compo…" />;
  // Une actualisation ratée garde la liste déjà affichée.
  if (!query.data) return <section aria-labelledby="compo-title" className="space-y-2">
    <h2 id="compo-title" className="text-lg font-bold">{T.title}</h2>
    <p className="text-sm text-muted-foreground">{T.loadError} <button className="min-h-11 font-semibold underline" onClick={() => void query.refetch()}>{T.retry}</button></p>
  </section>;

  const lineup = query.data;
  const players = lineup.players;
  // Rencontre jouée sans compo saisie : rien à annoncer, sauf à qui peut encore la saisir.
  if (!players.length && started && !lineup.can_edit) return null;
  const captain = lineup.captains[0] ? fullName(lineup.captains[0]) : null;
  const done = (fresh: TeamLineup) => {
    queryClient.setQueryData(lineupKey(clubId, rencontreId), fresh);
    void queryClient.invalidateQueries({ queryKey: [LINEUP_SUMMARIES_KEY, clubId] });
    setEditing(false);
    setSaved(true);
  };
  const reload = () => { setEditing(false); void query.refetch(); };

  return <section aria-labelledby="compo-title" className="space-y-3">
    <div className="flex items-baseline justify-between gap-3">
      <h2 id="compo-title" className="text-lg font-bold">{T.title}</h2>
      {players.length > 0 && lineup.can_edit
        ? <button onClick={() => setEditing(true)} className="-mr-2 min-h-11 px-2 text-sm font-semibold text-primary underline underline-offset-2">{T.edit}</button>
        : players.length > 0 ? <span className="text-sm text-muted-foreground">{playersLabel(players.length)}</span> : null}
    </div>
    {saved && <p role="status" className="rounded-xl bg-muted px-4 py-2 text-sm font-semibold">{T.saved}</p>}
    {players.length === 0 ? <div className="space-y-3 rounded-2xl border border-border bg-card p-5 text-center">
      <p className="font-bold">{T.emptyTitle}</p>
      <p className="text-sm text-muted-foreground">{lineup.can_edit ? T.emptyEditor : T.emptyMember(captain)}</p>
      {lineup.can_edit && <button onClick={() => setEditing(true)} className="min-h-12 w-full rounded-xl bg-primary p-3 font-semibold text-primary-foreground">{T.choose}</button>}
    </div> : <>
      <ul aria-label={`Compo, ${playersLabel(players.length)}`} className="divide-y divide-border overflow-hidden rounded-2xl border border-border bg-card">
        {players.map(player => <PlayerLine key={player.id} player={player} />)}
      </ul>
      <p className="text-sm text-muted-foreground">{T.note}</p>
    </>}
    {editing && <TeamLineupEditor clubId={clubId} rencontreId={rencontreId} lineup={lineup} onClose={() => setEditing(false)} onSaved={done} onReload={reload} />}
  </section>;
}
