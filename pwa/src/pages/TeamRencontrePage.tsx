import { supabase } from '../lib/supabase';
import PerformanceBadge from '../components/teamMatches/PerformanceBadge';
import { isClubPerformance } from '../lib/teamPerformance';
import TeamPlayers from '../components/teamMatches/TeamPlayers';
import { useRef, useState } from 'react';
import { Link, useLocation, useNavigate, useParams } from 'react-router-dom';
import { fromHere } from '../components/layout/useGoBack';
import { formatClubName } from '../../../shared/formatClubName';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { clubTopic } from '../lib/liveChannel';
import { LIVE_SAFETY_POLL, useLiveTopic } from '../hooks/useLiveTopic';
import { useClub } from '../contexts/ClubContext';
import { useAuth } from '../hooks/useAuth';
import { useCourseContext } from '../hooks/useCourses';
import { useTeamAction } from '../hooks/useTeamAction';
import { fetchTeamDetail, TEAM_FORMATS, lineLabel, liveSets, setsLabel, type TeamLine } from '../lib/teamMatches';
import type { LiveMatch } from '../types';
import CreateTeamMatch from '../components/teamMatches/CreateTeamMatch';
import TeamCompoSheet from '../components/teamMatches/TeamCompoSheet';
import TeamSheet from '../components/teamMatches/TeamSheet';
import { announceLiveStart } from '../lib/liveFollows';
import TeamResultSheet from '../components/teamMatches/TeamResultSheet';
import TeamPhotos from '../components/teamMatches/TeamPhotos';
import TeamLineupSection from '../components/teamMatches/TeamLineupSection';
import { COMPO_COPY, parisHour } from '../../../shared/teamCompoCopy.mjs';
import { ResultChip } from '../components/matchesEquipes/ResultChip';
import { scoreIssue, type ResultIssue } from '../components/matchesEquipes/result';
import { LoadError, StaleNotice } from '../components/layout/LoadState';

type Selection = { line: TeamLine; live?: LiveMatch; mode: 'actions' | 'result' };
const toLocalInput = (iso: string) => {
  const d = new Date(iso);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
};
export default function TeamRencontrePage() {
  const { id = '' } = useParams();
  const { clubId, club } = useClub();
  const { user } = useAuth();
  const membership = useCourseContext();
  const navigate = useNavigate();
  const location = useLocation();
  const [creating, setCreating] = useState(false);
  const [composing, setComposing] = useState(false);
  const [selection, setSelection] = useState<Selection | null>(null);
  const [notifyStart, setNotifyStart] = useState(true);
  const [recap, setRecap] = useState<{ revision: number; lines: TeamLine[] } | null>(null);
  const [dateDraft, setDateDraft] = useState<string | null>(null);
  const [dateSaving, setDateSaving] = useState(false);
  const [dateError, setDateError] = useState('');
  // Heure d'ouverture de la fiche : suffit pour savoir si la rencontre a commencé (règle pure au rendu).
  const [openedAt] = useState(() => Date.now());
  const action = useTeamAction(clubId, id);
  const queryClient = useQueryClient();
  // Broadcast `live:club:<id>` : cette rencontre, ses matches ou un live lié ont changé.
  const pending = useRef<ReturnType<typeof setTimeout>>(undefined);
  const subscribed = useLiveTopic(clubId ? clubTopic(clubId) : null, ({ event, payload }) => {
    const concerned = event === 'subscribed'
      || (event === 'team' && payload.rencontre_id === id)
      || (event === 'live' && payload.team_rencontre_id === id);
    if (!concerned || pending.current) return;
    pending.current = setTimeout(() => {
      pending.current = undefined;
      void queryClient.invalidateQueries({ queryKey: ['team-detail', clubId, id], exact: true });
    }, 250);
  });
  const query = useQuery({
    queryKey: ['team-detail', clubId, id], enabled: !!clubId && !!id,
    queryFn: () => fetchTeamDetail(clubId!, id), staleTime: 0,
    refetchInterval: subscribed ? LIVE_SAFETY_POLL : 15_000,
  });
  const close = () => { setSelection(null); setCreating(false); setComposing(false); setRecap(null); action.clearError(); void query.refetch(); };
  const canEdit = !!user && !!(membership.data?.is_member || membership.data?.can_manage);
  // Admin du club ou capitaine de l'équipe : même contrôle que team_rencontre_set_date.
  const canReschedule = useQuery({
    queryKey: ['team-can-reschedule', clubId, id, user?.id], enabled: !!clubId && !!id && !!user,
    queryFn: async () => {
      const { data, error } = await supabase.rpc('team_can_reschedule', { p_club: clubId, p_rencontre: id });
      if (error) throw error;
      return data === true;
    },
  });
  const saveDate = async () => {
    if (!dateDraft || !clubId) return;
    setDateSaving(true);
    setDateError('');
    const { error } = await supabase.rpc('team_rencontre_set_date', { p_club: clubId, p_rencontre: id, p_date: new Date(dateDraft).toISOString() });
    setDateSaving(false);
    if (error) { setDateError('Impossible de modifier la date. Réessayez.'); return; }
    setDateDraft(null);
    void query.refetch();
  };
  if (query.isPending) return <div className="space-y-5 p-4" role="status" aria-label="Chargement de la rencontre…">
    <div className="sk h-56 rounded-2xl" />
    <div className="sk h-6 w-24" />
    <div className="sk h-36 rounded-xl" />
  </div>;
  if (!query.data) return <LoadError title="Impossible de charger la rencontre" onRetry={() => void query.refetch()} retrying={query.isFetching} />;
  const detail = query.data;
  const { rencontre, competition, equipe, lines, lives } = detail;
  const spec = TEAM_FORMATS[competition.format];
  const completed = lines.filter(l => l.confirmed_at && l.gagnant).length;
  const expected = spec.simples + spec.doubles;
  const ready = completed === expected && lines.length === expected;
  const freeSimples = Array.from({ length: spec.simples }, (_, i) => i + 1).filter(slot => !lines.some(l => l.match_type === 'simple' && l.slot === slot));
  const lineWinner = (line: TeamLine, live?: LiveMatch): 'club' | 'adverse' | null =>
    line.gagnant ?? (live?.status === 'finished' ? live.winner === 'j1' ? 'club' : live.winner === 'j2' ? 'adverse' : null : null);
  const total = lines.reduce((score, line) => {
    const live = lives.find(m => m.id === line.live_match_id);
    const winner = lineWinner(line, live);
    if (winner) score[winner] += line.match_type === 'double' ? spec.doublePoints : 1;
    return score;
  }, { club: 0, adverse: 0 });
  // Score de la rencontre, club d'abord : total des matchs, sinon scores figés.
  const heroClub = lines.length ? total.club : rencontre.score_club;
  const heroAdverse = lines.length ? total.adverse : rencontre.score_adverse;
  const inPlay = lives.some(m => m.status === 'live');
  const heroIssue = inPlay ? null : scoreIssue(heroClub, heroAdverse, rencontre.wo);
  const usMuted = heroIssue === 'lose' ? ' text-muted-foreground' : '';
  const themMuted = heroIssue === 'win' ? ' text-muted-foreground' : '';
  // La fiche reste ouverte pendant le live : relire les révisions au moment du clic.
  const revisions = async () => {
    if (!selection) return null;
    const fresh = (await query.refetch()).data;
    const line = fresh?.lines.find(l => l.id === selection.line.id) ?? selection.line;
    const live = fresh ? fresh.lives.find(m => m.id === line.live_match_id) : selection.live;
    return { id: line.id, revision: line.revision, live_revision: live?.revision };
  };
  const startsLive = !selection?.live || selection.live.status === 'pending';
  const start = async () => {
    const base = await revisions();
    if (!base) return;
    const result = await action.run('start_live', base);
    // L'alerte de début ne bloque jamais l'ouverture du live (au pire, pas d'alerte).
    if (result?.live_match_id && startsLive && notifyStart && clubId) await announceLiveStart(clubId, result.live_match_id);
    if (result?.live_match_id) navigate(`/matches/${result.live_match_id}/score`, { state: fromHere(location) });
  };
  const chooseRule = async (rule: 'normal' | 'super_tiebreak') => {
    const base = await revisions();
    if (!base) return;
    if (await action.run('resolve_rule', { ...base, set3_format: rule })) close();
  };
  const manage = canEdit && !rencontre.wo;
  const login = <Link to="/login" state={fromHere(location)} className="flex min-h-12 w-full items-center justify-center rounded-xl border border-border bg-card px-4 text-[15px] font-semibold">Se connecter pour suivre la rencontre</Link>;
  // Feuille de match du jour J (photo des deux feuilles) : « compo » désigne désormais la liste des joueurs.
  // Rencontre commencée (heure prévue passée) : prendre les feuilles en photo devient l'action principale.
  const started = inPlay || lines.some(l => l.live_match_id || l.gagnant) || new Date(rencontre.date_heure).getTime() <= openedAt;
  const photoButton = freeSimples.length > 0 && competition.singles_set3_format
    && <button onClick={() => setComposing(true)} className={`min-h-12 w-full rounded-xl p-3 font-semibold ${started ? 'bg-primary text-primary-foreground' : 'border border-border bg-card'}`}>{COMPO_COPY.sheetFeuille}</button>;
  const manualButton = lines.length < expected
    && <button onClick={() => setCreating(true)} className="min-h-12 w-full rounded-xl border border-border bg-card p-3 font-semibold">Ajouter un match manuellement</button>;
  // Le verrou de la compo porte déjà « Se connecter » : pas de second bouton de connexion avant la rencontre.
  const lineupLocked = !user && !rencontre.wo && !started;
  const title = `${club?.name ? formatClubName(club.name) : 'Notre club'} – ${formatClubName(rencontre.club_adverse)}`;
  // « Dimanche 22 novembre », heure de Paris.
  const dayLabel = new Intl.DateTimeFormat('fr-FR', { timeZone: 'Europe/Paris', weekday: 'long', day: 'numeric', month: 'long' })
    .format(new Date(rencontre.date_heure)).replace(/^./, c => c.toUpperCase());
  const lineupSection = clubId && !rencontre.wo && <TeamLineupSection clubId={clubId} rencontreId={id} signedIn={!!user}
    started={started} when={`${dayLabel} · ${parisHour(new Date(rencontre.date_heure))} · ${rencontre.domicile ? 'Au club' : 'À l’extérieur'}`}
    contextLabel={`${title}, ${dayLabel.toLowerCase()}`} />;
  return <div className="tr-page space-y-5 p-4">
    <section className="rounded-2xl border border-border bg-card p-5">
      <p className="text-xs font-semibold uppercase text-muted-foreground">{competition.nom} · Équipe {equipe.numero}</p>
      <h1 className="mt-2 text-2xl font-bold">{title}</h1>
      <p className="mt-2 text-sm text-muted-foreground">{new Date(rencontre.date_heure).toLocaleString('fr-FR', { dateStyle: 'medium', timeStyle: 'short' })} · {rencontre.domicile ? 'Au club' : 'À l’extérieur'}</p>
      {/* Une rencontre confirmée ne se replanifie plus par ce raccourci. */}
      {canReschedule.data && !rencontre.confirmed_at && <button onClick={() => { setDateError(''); setDateDraft(toLocalInput(rencontre.date_heure)); }} className="-ml-1 mt-1 min-h-11 px-1 text-sm font-semibold text-primary underline underline-offset-2 active:opacity-60">Changer la date</button>}
      {/* Pas de « – – – » tant que rien n'est joué : seul « En attente » s'affiche. */}
      {(rencontre.wo || heroClub != null) && <div className="mt-4 text-center text-[40px] font-bold leading-none tracking-tight tabular-nums">
        {rencontre.wo ? 'WO' : <><span className={usMuted}>{heroClub}</span> – <span className={themMuted}>{heroAdverse ?? '–'}</span></>}
      </div>}
      <div className="mt-3 flex flex-col items-center gap-1.5">
        {heroIssue && <ResultChip issue={heroIssue} size="lg" />}
        {inPlay
          ? <span className="me-res live">En direct</span>
          : <p className="text-xs font-[650] text-muted-foreground">{!heroIssue ? 'En attente' : rencontre.confirmed_at ? 'Rencontre confirmée' : 'Provisoire'}</p>}
      </div>
      <p className="mt-3 text-xs text-muted-foreground">{spec.simples} simples · {spec.doubles} double{spec.doubles > 1 ? 's' : ''}{spec.doublePoints > 1 ? ' · double à 2 points' : ''}</p>
      <p className="mt-1 text-xs text-muted-foreground">3e set des simples : {competition.singles_set3_format === 'super_tiebreak' ? 'super tie-break' : competition.singles_set3_format === 'normal' ? 'set classique' : 'à configurer'} · doubles : super tie-break</p>
    </section>
    {query.isError && <StaleNotice onRetry={() => void query.refetch()}>Actualisation impossible, les scores affichés peuvent avoir changé.</StaleNotice>}
    {!started && lineupSection}
    {!user && !lineupLocked && lines.length > 0 && login}
    {membership.isError && user && <button className="min-h-11 text-sm underline" onClick={() => void membership.refetch()}>Vérifier à nouveau mon accès membre</button>}
    <div className="flex items-center justify-between gap-3"><h2 className="text-lg font-bold">Matchs</h2><span className="text-xs text-muted-foreground">{completed}/{expected} résultats validés</span></div>
    {/* Aucun match : le membre voit comment commencer, l'invité ce qui viendra (maquettes rencontre-membre / -invite). */}
    {lines.length === 0 && <div className="space-y-3 rounded-xl border border-dashed border-border p-5 text-center">
      <h3 className="font-bold">{manage ? 'Aucun match pour l’instant' : 'Matchs à venir'}</h3>
      <p className="text-sm text-muted-foreground">{manage
        ? 'Photographiez les feuilles de match des deux équipes, ou ajoutez les matchs à la main.'
        : 'Les joueurs et les scores s’afficheront ici dès qu’ils seront saisis par le club.'}</p>
      {manage ? <>{photoButton}{manualButton}</> : !user && !lineupLocked && login}
    </div>}
    <div className="space-y-3">{lines.map(line => {
      const live = lives.find(m => m.id === line.live_match_id);
      const score = line.result_kind === 'wo' ? 'WO' : live && !line.confirmed_at ? setsLabel(liveSets(live)) : line.score;
      const onAir = live?.status === 'live' && !line.confirmed_at;
      const winner = onAir ? null : lineWinner(line, live);
      // Un simple ou un double n'a pas de nul : l'issue d'une ligne est V ou D.
      const issue: ResultIssue | null = winner ? winner === 'club' ? 'win' : 'lose' : null;
      const note = issue && !line.confirmed_at ? live?.status === 'finished' ? 'À valider' : 'Provisoire' : null;
      return <article key={line.id} className={`rounded-xl border bg-card p-4 ${onAir ? 'border-primary' : 'border-border'}`}>
        <div className="mb-3 flex items-center justify-between gap-2"><h3 className="font-semibold">{lineLabel(line)}</h3>
          <span className="flex items-center gap-2">
            {onAir ? <span className="me-res live">En direct</span>
              : issue ? <>{note && <span className="text-xs font-[650] text-muted-foreground">{note}</span>}<ResultChip issue={issue} /></>
              : <span className="text-xs font-[650] text-muted-foreground">En attente de score</span>}
          </span>
        </div>
        <p className="flex flex-wrap items-center gap-2 text-sm font-medium"><TeamPlayers players={line.joueurs_club} />{isClubPerformance(line, live) && <PerformanceBadge />}</p><p className="mt-1 text-sm text-muted-foreground"><TeamPlayers players={line.joueurs_adverse} /></p>
        {(score || (canEdit && !rencontre.wo)) && <div className="mt-2 flex min-h-11 items-center justify-between gap-3">
          {score && <p className="text-lg font-semibold tabular-nums">{score}</p>}
          {canEdit && !rencontre.wo && <button onClick={() => { action.clearError(); setSelection({ line, live, mode: 'actions' }); }}
            className="-mr-2 ml-auto min-h-11 shrink-0 px-2 text-sm font-semibold text-muted-foreground underline underline-offset-2 active:opacity-60">{line.confirmed_at ? 'Modifier le résultat' : 'Gérer le match'}</button>}
        </div>}
      </article>;
    })}</div>
    {manage && lines.length > 0 && <>
      {photoButton}
      {manualButton}
      {!rencontre.confirmed_at && ready && <p className="text-sm font-medium">Tous les résultats sont saisis. Vérifiez les scores puis confirmez la rencontre.</p>}
      {!rencontre.confirmed_at && <button disabled={!ready} onClick={() => setRecap({ revision: rencontre.revision, lines })}
        className={`min-h-12 w-full rounded-xl border border-primary p-3 font-semibold disabled:opacity-40 ${ready ? 'bg-primary text-primary-foreground' : 'text-primary'}`}>Vérifier et confirmer la rencontre</button>}
      {rencontre.confirmed_at && <p className="text-sm text-muted-foreground">Chaque membre peut corriger un résultat. La rencontre sera alors à confirmer à nouveau.</p>}
    </>}
    {/* Une fois la rencontre commencée, la compo passe sous les matchs : la feuille de match prime. */}
    {started && lineupSection}
    {clubId && <TeamPhotos clubId={clubId} rencontreId={id} photoUrls={rencontre.photo_urls} userId={user?.id ?? null} canAdd={!!canReschedule.data} onChanged={() => void query.refetch()} />}
    {creating && clubId && <CreateTeamMatch detail={detail} clubId={clubId} onClose={close} />}
    {composing && clubId && <TeamCompoSheet detail={detail} clubId={clubId} slots={freeSimples} onClose={close} />}
    {selection?.mode === 'actions' && <TeamSheet title={lineLabel(selection.line)} onClose={close} busy={action.busy}>
      {selection.line.set3_format ? <div className="space-y-3">
        <p className="text-sm text-muted-foreground">3e set : {selection.line.set3_format === 'super_tiebreak' ? 'super tie-break' : 'set classique'} · règle conservée pour ce match</p>
        <button disabled={action.busy || selection.line.result_kind === 'wo'} onClick={() => void start()} className="min-h-12 w-full rounded-xl bg-primary p-3 font-semibold text-primary-foreground disabled:opacity-40">{selection.live ? 'Gérer dans l’onglet Live →' : 'Suivre en live'}</button>
        {startsLive && <label className="flex min-h-11 items-center gap-2 text-sm text-muted-foreground"><input type="checkbox" className="h-5 w-5 accent-primary" checked={notifyStart} disabled={action.busy} onChange={e => setNotifyStart(e.target.checked)} />Prévenir les abonnés du club</label>}
        <button disabled={action.busy} onClick={() => setSelection({ ...selection, mode: 'result' })} className="min-h-12 w-full rounded-xl border border-border p-3 font-semibold">{selection.line.confirmed_at ? 'Modifier le résultat' : selection.live?.status === 'finished' ? 'Valider le résultat' : 'Saisir le résultat'}</button>
      </div> : <div className="space-y-3">
        <p className="text-sm">La règle de ce match historique n’est pas connue. Précisez-la avant de le suivre ou de vérifier son résultat.</p>
        {selection.line.match_type === 'simple' && <button disabled={action.busy} className="min-h-11 w-full rounded-lg border border-border p-3" onClick={() => void chooseRule('normal')}>Troisième set classique</button>}
        <button disabled={action.busy} className="min-h-11 w-full rounded-lg border border-border p-3" onClick={() => void chooseRule('super_tiebreak')}>Super tie-break</button>
      </div>}
      {action.error && <p role="alert" className="mt-3 text-sm text-red-700">{action.error}</p>}
    </TeamSheet>}
    {selection?.mode === 'result' && clubId && user && <TeamResultSheet line={selection.line} live={selection.live} clubId={clubId} onClose={close} />}
    {dateDraft !== null && <TeamSheet title="Changer la date" onClose={() => setDateDraft(null)} busy={dateSaving}>
      <label className="block text-sm font-medium">Date et heure
        <input type="datetime-local" required value={dateDraft} disabled={dateSaving} onChange={e => setDateDraft(e.target.value)} className="mt-1 min-h-11 w-full rounded-lg border border-border bg-background p-2" />
      </label>
      {rencontre.confirmed_at && <p className="mt-3 text-sm text-muted-foreground">La rencontre devra être confirmée à nouveau.</p>}
      {dateError && <p role="alert" className="mt-3 text-sm text-red-700">{dateError}</p>}
      <button disabled={dateSaving || !dateDraft} onClick={() => void saveDate()} className="mt-4 min-h-12 w-full rounded-xl bg-primary p-3 font-semibold text-primary-foreground disabled:opacity-40">{dateSaving ? 'Enregistrement…' : 'Enregistrer'}</button>
    </TeamSheet>}
    {recap && <TeamSheet title="Confirmer la rencontre" onClose={close} busy={action.busy}>
      <div className="space-y-3">{recap.lines.map(line => <div key={line.id} className="flex justify-between gap-3 border-b border-border pb-2 text-sm"><span className="flex items-center gap-2">{lineLabel(line)}{line.gagnant && <ResultChip issue={line.gagnant === 'club' ? 'win' : 'lose'} size="lg" />}</span><strong className="tabular-nums">{line.result_kind === 'wo' ? 'WO' : line.score}</strong></div>)}</div>
      <p className="my-4 text-sm">Les résultats de tous les matchs ont été vérifiés.</p>
      {action.error && <p role="alert" className="my-3 text-sm text-red-700">{action.error}</p>}
      <button disabled={action.busy} onClick={async () => { if (await action.run('confirm', { revision: recap.revision })) close(); }} className="min-h-12 w-full rounded-xl bg-primary p-3 font-semibold text-primary-foreground">{action.busy ? 'Confirmation…' : 'Confirmer la rencontre'}</button>
    </TeamSheet>}
  </div>;
}
