import { useEffect, useRef, useState } from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { fromHere } from '../layout/useGoBack';
import TeamLineupEditor from './TeamLineupEditor';
import TeamSheet from './TeamSheet';
import TennisBall from '../TennisBall';
import { COMPO_COPY as T, playersLabel, updatedLine } from '../../../../shared/teamCompoCopy.mjs';
import { LINEUP_SUMMARIES_KEY, fetchLineup, fullName, lineupEditable, lineupKey, outOfGenreLabel, type LineupPlayer, type TeamLineup } from '../../lib/teamLineup';

/** Pastille d'initiales : moi en rouge plein, membre en gris, sans compte en pointillé. */
function Initials({ player }: { player: LineupPlayer }) {
  const tone = player.is_me ? 'bg-primary text-primary-foreground'
    : player.is_guest ? 'border border-dashed border-muted-foreground text-muted-foreground' : 'bg-muted text-foreground';
  return <span aria-hidden className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-xs font-bold ${tone}`}>{player.initials}</span>;
}

function PlayerLine({ player, genre }: { player: LineupPlayer; genre: string }) {
  const tags = [player.is_me && T.you, player.is_captain && T.captain].filter(Boolean) as string[];
  // Le sexe n'arrive qu'à qui peut modifier (ou en mixte, sans mention) : la mention suit ce qu'on reçoit.
  const note = [player.is_guest && T.guest, outOfGenreLabel(player.sex, genre)].filter(Boolean).join(' · ');
  const label = [fullName(player), ...tags, note, player.classement].filter(Boolean).join(', ');
  return <li aria-label={label} className={`flex min-h-14 items-center gap-3 px-4 py-2 ${player.is_me ? 'bg-primary/5' : ''}`}>
    <Initials player={player} />
    <span className="min-w-0 flex-1">
      <span className="flex flex-wrap items-center gap-x-2 gap-y-1">
        <span className="text-[15px] font-medium">{fullName(player)}</span>
        {player.is_me && <span className="rounded-full bg-primary px-2 py-0.5 text-xs font-bold text-primary-foreground">{T.you}</span>}
        {player.is_captain && <span className="rounded-full bg-muted px-2 py-0.5 text-xs font-semibold">{T.captain}</span>}
      </span>
      {note && <span className="block text-sm text-muted-foreground">{note}</span>}
    </span>
    {player.classement && <span className="shrink-0 rounded-md bg-muted px-2 py-1 text-sm font-semibold tabular-nums">{player.classement}</span>}
  </li>;
}

/** Au-delà, la fiche montre les premiers et renvoie au reste dans une feuille. */
const INLINE_MAX = 6;
const GROUP_ORDER = ['female', 'male', 'none'] as const;

/** Liste des joueurs ; en compétition mixte, groupée Dames / Messieurs / Sexe non précisé. */
function PlayerList({ players, genre, grouped }: { players: LineupPlayer[]; genre: string; grouped: boolean }) {
  const list = (items: LineupPlayer[], label: string) => <ul aria-label={label}
    className="divide-y divide-border overflow-hidden rounded-2xl border border-border bg-card">
    {items.map(player => <PlayerLine key={player.id} player={player} genre={genre} />)}
  </ul>;
  if (!grouped) return list(players, `Compo, ${playersLabel(players.length)}`);
  return <div className="space-y-3">{GROUP_ORDER.map(key => {
    const items = players.filter(p => (p.sex ?? 'none') === key);
    if (!items.length) return null;
    const title = `${T.groups[key]} · ${items.length}`;
    return <div key={key}>
      <h3 className="mb-1 text-xs font-semibold uppercase tracking-wide text-muted-foreground">{title}</h3>
      {list(items, title)}
    </div>;
  })}</div>;
}

/**
 * Section « Compo » de la fiche rencontre (brief compo-equipes §4, §7) : liste des joueurs retenus,
 * visible de toute personne connectée, modifiable par le capitaine de l'équipe ou un admin.
 * Un visiteur voit un verrou, qu'une liste existe ou non.
 */
export default function TeamLineupSection({ clubId, rencontreId, signedIn, started, when, contextLabel }: {
  clubId: string; rencontreId: string; signedIn: boolean; started: boolean;
  /** « Dimanche 22 novembre · 9h · Au club », pour la carte « Vous jouez cette rencontre ». */
  when: string;
  /** « CAC – TC Grisolles 1, dimanche 22 novembre », repris par l'écran de connexion. */
  contextLabel: string;
}) {
  const location = useLocation();
  const navigate = useNavigate();
  const [now] = useState(() => new Date());
  const [showAll, setShowAll] = useState(false);
  // Retour de la connexion (state `welcome`) : toast, focus sur « Compo », puis on retire la marque
  // de l'historique pour ne pas rejouer le toast au rechargement.
  const welcome = (location.state as { welcome?: string } | null)?.welcome === 'compo';
  const [welcomed, setWelcomed] = useState(() => welcome);
  const queryClient = useQueryClient();
  const [editing, setEditing] = useState(false);
  const [saved, setSaved] = useState(false);
  const [blocked, setBlocked] = useState(false);
  // À la fermeture de la feuille (Échap, ✕, abandon, enregistrement), le focus revient au bouton qui
  // l'ouvre (« Modifier », ou « Choisir les joueurs » si la compo est restée vide), sinon au titre.
  const titleRef = useRef<HTMLHeadingElement>(null);
  const editRef = useRef<HTMLButtonElement>(null);
  const chooseRef = useRef<HTMLButtonElement>(null);
  const [wasEditing, setWasEditing] = useState(false);
  useEffect(() => {
    if (!editing && wasEditing) (editRef.current ?? chooseRef.current ?? titleRef.current)?.focus();
  }, [editing, wasEditing]);
  const query = useQuery({
    queryKey: lineupKey(clubId, rencontreId), enabled: signedIn,
    queryFn: () => fetchLineup(clubId, rencontreId),
  });
  const loaded = !!query.data;
  useEffect(() => {
    if (!saved && !(welcomed && loaded)) return;
    const timer = setTimeout(() => { setSaved(false); setWelcomed(false); }, 4000);
    return () => clearTimeout(timer);
  }, [saved, welcomed, loaded]);
  useEffect(() => {
    if (!welcome || !loaded) return;
    titleRef.current?.focus();
    const rest = Object.fromEntries(Object.entries(location.state as Record<string, unknown>).filter(([key]) => key !== 'welcome'));
    navigate(`${location.pathname}${location.search}`, { replace: true, state: rest });
  }, [welcome, loaded, location.state, location.pathname, location.search, navigate]);

  if (!signedIn) {
    // Rencontre commencée : la feuille de match (publique) a pris le relais, inutile d'insister.
    if (started) return null;
    return <section aria-labelledby="compo-title" className="space-y-3">
      <h2 id="compo-title" className="text-lg font-bold">{T.title}</h2>
      <div className="space-y-3 rounded-2xl border border-border bg-card p-5 text-center">
        <p className="font-bold">{T.lockedTitle}</p>
        <p className="text-sm text-muted-foreground">{T.lockedText}</p>
        {/* Connexion et inscription ramènent toutes deux ici (state.from, ?returnTo=). */}
        <Link to="/login" state={{ ...fromHere(location), compoContext: contextLabel }} aria-describedby="compo-login-return" className="flex min-h-12 w-full items-center justify-center rounded-xl bg-primary px-4 font-semibold text-primary-foreground">{T.login}</Link>
        <p id="compo-login-return" className="-mt-1 text-xs text-muted-foreground">{T.loginReturn}</p>
        <Link to={`/inscription?returnTo=${encodeURIComponent(location.pathname)}`} aria-describedby="compo-login-return" className="flex min-h-11 items-center justify-center text-sm font-semibold text-primary underline underline-offset-2">{T.signup}</Link>
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
  // Garde-fou : sans user_id d'un membre retenu, enregistrer l'effacerait. On n'ouvre pas la feuille.
  const openEditor = () => { if (!lineupEditable(lineup)) { setBlocked(true); return; } setEditing(true); setWasEditing(true); };
  const done = (fresh: TeamLineup) => {
    queryClient.setQueryData(lineupKey(clubId, rencontreId), fresh);
    void queryClient.invalidateQueries({ queryKey: [LINEUP_SUMMARIES_KEY, clubId] });
    setEditing(false);
    setSaved(true);
  };
  const reload = () => { setEditing(false); void query.refetch(); };
  const me = players.some(p => p.is_me);
  const grouped = lineup.genre === 'mixte';
  const freshness = lineup.updated_at ? updatedLine(lineup.updated_at, lineup.updated_by, now) : null;
  const truncated = players.length > INLINE_MAX;

  return <section aria-labelledby="compo-title" className="space-y-3">
    {me && <div className="flex items-center gap-3 rounded-2xl border border-primary/40 bg-primary/5 p-4">
      <span aria-hidden className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-primary"><TennisBall className="h-6 w-6" /></span>
      <span><span className="block font-bold">{T.youPlayTitle}</span><span className="block text-sm text-muted-foreground">{when}</span></span>
    </div>}
    <div className="flex items-center justify-between gap-3">
      <h2 id="compo-title" ref={titleRef} tabIndex={-1} className="text-lg font-bold outline-none">{T.title}</h2>
      {players.length > 0 && <span className="flex items-center gap-1 text-sm text-muted-foreground">
        {playersLabel(players.length)}
        {lineup.can_edit && <>{' · '}<button ref={editRef} onClick={openEditor} className="-mr-2 min-h-11 px-2 font-semibold text-primary underline underline-offset-2">{T.edit}</button></>}
      </span>}
    </div>
    {freshness && players.length > 0 && <p className="-mt-2 text-sm text-muted-foreground">{freshness}</p>}
    {blocked && <p role="alert" className="text-sm text-red-700">{T.cannotEdit}</p>}
    {(saved || welcomed) && <p role="status" className="rounded-xl bg-foreground px-4 py-2 text-sm font-semibold text-background">✓ {saved ? T.saved : T.welcomeBack}</p>}
    {players.length === 0 ? <div className="space-y-3 rounded-2xl border border-border bg-card p-5 text-center">
      <p className="font-bold">{T.emptyTitle}</p>
      <p className="text-sm text-muted-foreground">{lineup.can_edit ? T.emptyEditor : T.emptyMember(captain)}</p>
      {/* Rencontre commencée : la photo des feuilles de match devient l'action principale. */}
      {lineup.can_edit && <button ref={chooseRef} onClick={openEditor} className={`min-h-12 w-full rounded-xl p-3 font-semibold ${started ? 'border border-border bg-card' : 'bg-primary text-primary-foreground'}`}>{T.choose}</button>}
    </div> : <>
      {/* Liste tronquée : pas d'intertitres, dont les compteurs ne diraient pas ce qu'on voit. */}
      <PlayerList players={truncated ? players.slice(0, INLINE_MAX) : players} genre={lineup.genre} grouped={grouped && !truncated} />
      {truncated && <button onClick={() => setShowAll(true)} className="min-h-12 w-full rounded-xl border border-border bg-card p-3 font-semibold">{T.seeAll(players.length)}</button>}
      <p className="text-sm text-muted-foreground">{T.note}</p>
    </>}
    {showAll && <TeamSheet title={T.sheetList(players.length)} onClose={() => setShowAll(false)}>
      {freshness && <p className="-mt-3 mb-3 text-sm text-muted-foreground">{freshness}</p>}
      <PlayerList players={players} genre={lineup.genre} grouped={grouped} />
    </TeamSheet>}
    {editing && <TeamLineupEditor clubId={clubId} rencontreId={rencontreId} lineup={lineup} onClose={() => setEditing(false)} onSaved={done} onReload={reload} />}
  </section>;
}
