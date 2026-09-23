import { useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { useClub } from '../contexts/ClubContext';
import { useAuth } from '../hooks/useAuth';
import { useCourseContext } from '../hooks/useCourses';
import { useTeamAction } from '../hooks/useTeamAction';
import { fetchTeamDetail, TEAM_FORMATS, lineLabel, playerLabel, liveSets, setsLabel, type TeamLine } from '../lib/teamMatches';
import type { LiveMatch } from '../types';
import CreateTeamMatch from '../components/teamMatches/CreateTeamMatch';
import TeamSheet from '../components/teamMatches/TeamSheet';
import TeamResultSheet from '../components/teamMatches/TeamResultSheet';

type Selection = { line: TeamLine; live?: LiveMatch; mode: 'actions' | 'result' };
export default function TeamRencontrePage() {
  const { id = '' } = useParams();
  const { clubId, club } = useClub();
  const { user } = useAuth();
  const membership = useCourseContext();
  const navigate = useNavigate();
  const [creating, setCreating] = useState(false);
  const [selection, setSelection] = useState<Selection | null>(null);
  const [recap, setRecap] = useState<{ revision: number; lines: TeamLine[] } | null>(null);
  const action = useTeamAction(clubId, id);
  const query = useQuery({
    queryKey: ['team-detail', clubId, id], enabled: !!clubId && !!id,
    queryFn: () => fetchTeamDetail(clubId!, id), staleTime: 0, refetchInterval: 15_000,
  });
  const close = () => { setSelection(null); setCreating(false); setRecap(null); action.clearError(); void query.refetch(); };
  const canEdit = !!user && !!(membership.data?.is_member || membership.data?.can_manage);
  if (query.isPending) return <p className="p-6" role="status">Chargement de la rencontre…</p>;
  if (!query.data) return <div className="p-6"><p role="alert">Impossible de charger la rencontre.</p><button className="min-h-11 underline" onClick={() => void query.refetch()}>Réessayer</button></div>;
  const detail = query.data;
  const { rencontre, competition, equipe, lines, lives } = detail;
  const spec = TEAM_FORMATS[competition.format];
  const completed = lines.filter(l => l.confirmed_at && l.gagnant).length;
  const expected = spec.simples + spec.doubles;
  const total = lines.reduce((score, line) => {
    const live = lives.find(m => m.id === line.live_match_id);
    const winner = line.gagnant ?? (live?.status === 'finished' ? live.winner === 'j1' ? 'club' : live.winner === 'j2' ? 'adverse' : null : null);
    if (winner) score[winner] += line.match_type === 'double' ? spec.doublePoints : 1;
    return score;
  }, { club: 0, adverse: 0 });
  const start = async () => {
    if (!selection) return;
    const result = await action.run('start_live', { id: selection.line.id, revision: selection.line.revision, live_revision: selection.live?.revision });
    if (result?.live_match_id) navigate(`/matches/${result.live_match_id}/score`);
  };
  const chooseRule = async (rule: 'normal' | 'super_tiebreak') => {
    if (!selection) return;
    if (await action.run('resolve_rule', { id: selection.line.id, revision: selection.line.revision, live_revision: selection.live?.revision, set3_format: rule })) close();
  };
  return <div className="space-y-5 p-4">
    <section className="rounded-2xl border border-border bg-card p-5">
      <p className="text-xs font-semibold uppercase text-primary">{competition.nom} · Équipe {equipe.numero}</p>
      <h1 className="mt-2 text-2xl font-bold">{club?.name ?? 'Notre club'} – {rencontre.club_adverse}</h1>
      <p className="mt-2 text-sm text-muted-foreground">{new Date(rencontre.date_heure).toLocaleString('fr-FR', { dateStyle: 'medium', timeStyle: 'short' })} · {rencontre.domicile ? 'Au club' : 'À l’extérieur'}</p>
      <div className="my-4 text-center text-4xl font-bold tabular-nums">{rencontre.wo ? 'WO' : lines.length ? `${total.club} – ${total.adverse}` : `${rencontre.score_club ?? '–'} – ${rencontre.score_adverse ?? '–'}`}</div>
      <p className="text-center text-sm font-semibold">{rencontre.confirmed_at ? 'Rencontre confirmée' : 'Résultat provisoire'}</p>
      <p className="mt-3 text-xs text-muted-foreground">{spec.simples} simples · {spec.doubles} double{spec.doubles > 1 ? 's' : ''}{spec.doublePoints > 1 ? ' · double à 2 points' : ''}</p>
      <p className="mt-1 text-xs text-muted-foreground">3e set des simples : {competition.singles_set3_format === 'super_tiebreak' ? 'super tie-break' : competition.singles_set3_format === 'normal' ? 'set classique' : 'à configurer'} · doubles : super tie-break</p>
    </section>
    {query.isError && <p role="alert" className="text-sm text-amber-800">Actualisation impossible. Les données affichées peuvent avoir changé. <button onClick={() => void query.refetch()} className="underline">Réessayer</button></p>}
    {!user && <Link to="/login" state={{ from: `/matches-equipes/${id}` }} className="block rounded-xl border border-border p-3 text-center text-primary">Se connecter pour gérer les matchs</Link>}
    {membership.isError && user && <button className="min-h-11 text-sm underline" onClick={() => void membership.refetch()}>Vérifier à nouveau mon accès membre</button>}
    <div className="flex items-center justify-between gap-3"><h2 className="text-lg font-bold">Matchs</h2><span className="text-xs text-muted-foreground">{completed}/{expected} résultats validés</span></div>
    {lines.length === 0 && <p className="rounded-xl border border-dashed border-border p-6 text-center text-sm text-muted-foreground">Aucun match créé. Ajoutez les joueurs de la rencontre pour commencer.</p>}
    <div className="space-y-3">{lines.map(line => {
      const live = lives.find(m => m.id === line.live_match_id);
      const score = live && !line.confirmed_at ? setsLabel(liveSets(live)) : line.score;
      const status = line.confirmed_at ? line.result_kind === 'wo' ? 'WO · Validé' : 'Résultat validé'
        : live?.status === 'live' ? 'LIVE' : live?.status === 'finished' ? 'LIVE · TERMINÉ · À valider' : 'En attente de score';
      return <article key={line.id} className={`rounded-xl border bg-card p-4 ${live?.status === 'live' ? 'border-primary' : 'border-border'}`}>
        <div className="mb-3 flex flex-wrap justify-between gap-2"><h3 className="font-semibold">{lineLabel(line)}</h3><span className="text-xs font-semibold text-primary">{status}</span></div>
        <p className="text-sm font-medium">{playerLabel(line.joueurs_club)}</p><p className="mt-1 text-sm text-muted-foreground">{playerLabel(line.joueurs_adverse)}</p>
        {score && <p className="mt-3 text-lg font-semibold tabular-nums">{score}</p>}
        {canEdit && !rencontre.wo && <button onClick={() => { action.clearError(); setSelection({ line, live, mode: 'actions' }); }} className="mt-3 min-h-11 w-full rounded-lg border border-border text-sm font-semibold">{line.confirmed_at ? 'Modifier le résultat' : 'Gérer le match'}</button>}
      </article>;
    })}</div>
    {canEdit && !rencontre.wo && <>
      {lines.length < expected && <button onClick={() => setCreating(true)} className="min-h-12 w-full rounded-xl bg-primary p-3 font-semibold text-primary-foreground">Ajouter un match</button>}
      {!rencontre.confirmed_at && <button disabled={completed !== expected || lines.length !== expected} onClick={() => setRecap({ revision: rencontre.revision, lines })}
        className="min-h-12 w-full rounded-xl border border-primary p-3 font-semibold text-primary disabled:opacity-40">Vérifier et confirmer la rencontre</button>}
      {rencontre.confirmed_at && <p className="text-sm text-muted-foreground">Chaque membre peut corriger un résultat. La rencontre sera alors à confirmer à nouveau.</p>}
    </>}
    {creating && clubId && <CreateTeamMatch detail={detail} clubId={clubId} onClose={close} />}
    {selection?.mode === 'actions' && <TeamSheet title={lineLabel(selection.line)} onClose={close} busy={action.busy}>
      {selection.line.set3_format ? <div className="space-y-3">
        <p className="text-sm text-muted-foreground">3e set : {selection.line.set3_format === 'super_tiebreak' ? 'super tie-break' : 'set classique'} · règle conservée pour ce match</p>
        <button disabled={action.busy || selection.line.result_kind === 'wo'} onClick={() => void start()} className="min-h-12 w-full rounded-xl bg-primary p-3 font-semibold text-primary-foreground disabled:opacity-40">{selection.live ? 'Gérer dans l’onglet Live →' : 'Suivre en live'}</button>
        <button disabled={action.busy} onClick={() => setSelection({ ...selection, mode: 'result' })} className="min-h-12 w-full rounded-xl border border-border p-3 font-semibold">{selection.live?.status === 'finished' ? 'Valider le résultat' : 'Saisir le résultat'}</button>
      </div> : <div className="space-y-3">
        <p className="text-sm">La règle de ce match historique n’est pas connue. Précisez-la avant de le suivre ou de vérifier son résultat.</p>
        {selection.line.match_type === 'simple' && <button disabled={action.busy} className="min-h-11 w-full rounded-lg border border-border p-3" onClick={() => void chooseRule('normal')}>Troisième set classique</button>}
        <button disabled={action.busy} className="min-h-11 w-full rounded-lg border border-border p-3" onClick={() => void chooseRule('super_tiebreak')}>Super tie-break</button>
      </div>}
      {action.error && <p role="alert" className="mt-3 text-sm text-red-700">{action.error}</p>}
    </TeamSheet>}
    {selection?.mode === 'result' && clubId && user && <TeamResultSheet line={selection.line} live={selection.live} clubId={clubId} userId={user.id} onClose={close} />}
    {recap && <TeamSheet title="Confirmer la rencontre" onClose={close} busy={action.busy}>
      <div className="space-y-3">{recap.lines.map(line => <div key={line.id} className="flex justify-between gap-3 border-b border-border pb-2 text-sm"><span>{lineLabel(line)} · {line.gagnant === 'club' ? 'Gagné' : 'Perdu'}</span><strong>{line.score}</strong></div>)}</div>
      <p className="my-4 text-sm">Les résultats de tous les matchs ont été vérifiés.</p>
      {action.error && <p role="alert" className="my-3 text-sm text-red-700">{action.error}</p>}
      <button disabled={action.busy} onClick={async () => { if (await action.run('confirm', { revision: recap.revision })) close(); }} className="min-h-12 w-full rounded-xl bg-primary p-3 font-semibold text-primary-foreground">{action.busy ? 'Confirmation…' : 'Confirmer la rencontre'}</button>
    </TeamSheet>}
  </div>;
}
