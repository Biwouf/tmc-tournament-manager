import {
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type CSSProperties,
} from 'react';
import { Link, useLocation, useNavigate, useParams } from 'react-router-dom';
import { useClub } from '../contexts/ClubContext';
import { useAuth } from '../hooks/useAuth';
import { useLiveMatch } from '../hooks/useLiveMatch';
import { useLiveActivity } from '../hooks/useLiveActivity';
import { getTeamLabel } from '../liveScoreRules';
import {
  finalScorePatch,
  scoreSnapshot,
  scoreLabel,
} from '../lib/liveScoreActions';
import type { LiveMatch } from '../types';
import LiveScoreEntry from '../components/matches/LiveScoreEntry';
import LiveIcon from '../components/live/LiveIcon';
import LiveScoreboard from '../components/live/LiveScoreboard';
import LiveSheet from '../components/live/LiveSheet';
import LiveReactions from '../components/live/LiveReactions';
import { useReactionBursts } from '../hooks/useReactionBursts';
import { PollAnswers, PollForm } from '../components/live/LivePoll';
import '../components/live/live.css';

export default function LiveMatchPage() {
  const { id } = useParams();
  const { clubId } = useClub();
  const { user, loading: authLoading } = useAuth();
  const userId = user?.id ?? null;
  return (
    <LiveMatchScreen
      key={`${clubId}:${id}:${userId}`}
      id={id}
      clubId={clubId}
      userId={userId}
      authLoading={authLoading}
    />
  );
}
function LiveMatchScreen({
  id,
  clubId,
  userId,
  authLoading,
}: {
  id: string | undefined;
  clubId: string | null;
  userId: string | null;
  authLoading: boolean;
}) {
  const navigate = useNavigate();
  const location = useLocation();
  const reactions = useReactionBursts(id);
  const activity = useLiveActivity(id, clubId, userId, reactions.receive);
  const live = useLiveMatch(
    id,
    clubId,
    userId,
    !authLoading && activity.canAnimate,
  );
  const { match, saving, savingError, save } = live;
  const canAnimate = !authLoading && activity.canAnimate;
  const [sheet, setSheet] = useState<
    'score' | 'info' | 'poll' | 'retire' | null
  >(null);
  const [pollId, setPollId] = useState<string | null>(null);
  const [draft, setDraft] = useState('');
  const [menu, setMenu] = useState(false);
  const [history, setHistory] = useState<
    { before: Partial<LiveMatch>; revision: number }[]
  >([]);
  const undo = history[history.length - 1];
  const [height, setHeight] = useState<number>();
  const latest = useRef<HTMLButtonElement>(null);
  const input = useRef<HTMLTextAreaElement>(null);
  useLayoutEffect(() => {
    if (input.current) {
      input.current.style.height = 'auto';
      input.current.style.height = `${Math.min(input.current.scrollHeight, 110)}px`;
    }
  }, [draft]);
  const feed = useRef<HTMLDivElement>(null);
  const follow = useRef(true);
  const oldHeight = useRef<number | null>(null);
  const forceFollow = useRef(false);
  const canWrite = canAnimate && match?.status === 'live' && !activity.isError;
  const scoreError = savingError ?? live.error;
  const blocked = saving || !!scoreError || !canAnimate;
  const login = () =>
    navigate('/login', { state: { from: location.pathname } });
  useEffect(() => {
    const viewport = window.visualViewport;
    const resize = () => {
      if (!viewport || viewport.scale === 1)
        setHeight(viewport?.height ?? window.innerHeight);
    };
    resize();
    viewport?.addEventListener('resize', resize);
    window.addEventListener('resize', resize);
    return () => {
      viewport?.removeEventListener('resize', resize);
      window.removeEventListener('resize', resize);
    };
  }, []);
  const refetchActivity = activity.refetch;
  useEffect(() => {
    if (match?.status) void refetchActivity();
  }, [match?.status, refetchActivity]);
  const signature = activity.items.map((p) => p.id).join(',');
  useLayoutEffect(() => {
    const el = feed.current;
    if (!el) return;
    if (oldHeight.current !== null) {
      el.scrollTop += el.scrollHeight - oldHeight.current;
      oldHeight.current = null;
    } else if (follow.current || forceFollow.current) {
      el.scrollTop = el.scrollHeight;
      follow.current = true;
      if (latest.current) latest.current.hidden = true;
    } else if (latest.current) latest.current.hidden = false;
    forceFollow.current = false;
  }, [signature, live.loading]);
  const jumpToLatest = () => {
    const el = feed.current;
    if (el) el.scrollTop = el.scrollHeight;
    follow.current = true;
    if (latest.current) latest.current.hidden = true;
  };
  async function patchScore(patch: Partial<LiveMatch>, finish = true) {
    if (!match || blocked) return;
    const before = scoreSnapshot(match);
    const row = await save({
      ...(finish ? finalScorePatch(match, patch) : patch),
      scored_by: userId,
    });
    if (row && match.status !== 'pending')
      setHistory((items) => [
        ...(items[items.length - 1]?.revision === match.revision
          ? items
          : []
        ).slice(-19),
        { before, revision: row.revision },
      ]);
    return !!row;
  }
  async function publish(body: string, options?: string[]) {
    if (!canWrite) return false;
    forceFollow.current = true;
    const success = await activity.run(options ? 'poll' : 'message', {
      body,
      ...(options ? { options } : {}),
    });
    if (success) jumpToLatest();
    else forceFollow.current = false;
    return success;
  }
  if (live.loading || authLoading)
    return (
      <div className="live-fallback" role="status">
        Chargement du live…
      </div>
    );
  if (!match)
    return (
      <div className="live-fallback">
        <p role="alert">{live.error ?? 'Match introuvable.'}</p>
        <button onClick={() => void live.reload()}>Réessayer</button>
        <Link to="/matches">Retour aux matchs</Link>
      </div>
    );
  const poll = activity.items.find((p) => p.id === pollId);
  const showMemberDock = canAnimate && match.status === 'live';
  const reactionDock = (
    <LiveReactions
      matchId={match.id}
      clubId={clubId!}
      userId={userId}
      canSend={match.status === 'live' && !activity.isPending && !activity.isError}
      {...reactions}
    />
  );
  return (
    <div
      className="live-view"
      style={
        {
          '--live-viewport-height': height ? `${height}px` : '100dvh',
        } as CSSProperties
      }
    >
      <header className="live-header">
        <Link
          to="/matches"
          aria-label="Retour aux matchs"
          className="icon-button"
        >
          ←
        </Link>
        <h1>Le live du match</h1>
        <button
          className="icon-button info-button"
          aria-label="Informations du match"
          onClick={() => setSheet('info')}
        >
          <LiveIcon kind="info" />
        </button>
      </header>
      <LiveScoreboard
        match={match}
        canAnimate={canAnimate}
        blocked={blocked}
        saving={saving}
        scoreError={scoreError}
        canUndo={!!undo && undo.revision === match.revision}
        onOpenScore={() => setSheet('score')}
        onReload={() => void live.reload()}
        onScore={(patch) => void patchScore(patch)}
        onStart={() =>
          void patchScore(
            {
              status: 'live',
              started_at: new Date().toISOString(),
              scored_by: userId,
            },
            false,
          )
        }
        onUndo={async () => {
          if (!undo) return;
          const row = await save(undo.before);
          if (row)
            setHistory((items) =>
              items
                .slice(0, -1)
                .map((item, i) =>
                  i === items.length - 2
                    ? { ...item, revision: row.revision }
                    : item,
                ),
            );
        }}
      />
      <div
        className="live-scroll"
        ref={feed}
        onScroll={(e) => {
          const el = e.currentTarget;
          follow.current =
            el.scrollHeight - el.scrollTop - el.clientHeight < 60;
          if (follow.current) if (latest.current) latest.current.hidden = true;
        }}
      >
        <div className="live-body">
          <div className="feed-heading">
            <h2>Au bord du terrain</h2>
            <span>
              {match.status === 'finished' ? 'Le fil du match' : 'En direct'}
            </span>
          </div>
          {activity.hasNextPage && (
            <button
              className="history-button"
              disabled={activity.isFetchingNextPage}
              onClick={async () => {
                oldHeight.current = feed.current?.scrollHeight ?? null;
                const result = await activity.fetchNextPage();
                if (result.isFetchNextPageError) oldHeight.current = null;
              }}
            >
              Voir les messages précédents
            </button>
          )}
          {activity.isError && (
            <p role="alert" className="live-error">
              Impossible de charger le fil.{' '}
              <button onClick={() => void activity.refetch()}>Réessayer</button>
            </p>
          )}
          {activity.isPending ? (
            <p role="status">Chargement du fil…</p>
          ) : (
            activity.items.length === 0 && (
              <div className="empty-feed">
                <span>🎾</span>
                <h3>Le match se raconte ici</h3>
                <p>
                  {canAnimate
                    ? 'Partagez un temps fort ou lancez un sondage.'
                    : 'Retrouvez les commentaires et sondages du club au fil du match.'}
                </p>
              </div>
            )
          )}
          {activity.items.map((post) =>
            post.kind === 'poll' ? (
              <article className="poll-summary new-feed-item" key={post.id}>
                <span aria-hidden="true" className="summary-icon">
                  <LiveIcon kind="poll" />
                </span>
                <div>
                  <span className="eyebrow">
                    {post.closed ? 'SONDAGE TERMINÉ' : 'SONDAGE'}
                  </span>
                  <h3>{post.body}</h3>
                  <span className="summary-meta">
                    {post.total} votes · {post.author_name}
                  </span>
                </div>
                <button onClick={() => setPollId(post.id)}>
                  {post.closed || post.my_vote !== null
                    ? 'Résultats'
                    : 'Répondre'}
                </button>
              </article>
            ) : (
              <article className="feed-post new-feed-item" key={post.id}>
                <div className="post-heading">
                  <span className="avatar" aria-hidden="true">
                    {post.author_name.slice(0, 1)}
                  </span>
                  <strong>{post.author_name}</strong>
                  <time dateTime={post.created_at}>
                    {new Date(post.created_at).toLocaleTimeString('fr-FR', {
                      hour: '2-digit',
                      minute: '2-digit',
                    })}
                  </time>
                  {canAnimate && (
                    <button
                      className="icon-button delete-post"
                      aria-label="Supprimer ce commentaire"
                      disabled={activity.busy}
                      onClick={() => {
                        if (window.confirm('Supprimer ce commentaire ?'))
                          void activity.run('delete', { id: post.id });
                      }}
                    >
                      ×
                    </button>
                  )}
                </div>
                <p>{post.body}</p>
                <div className="post-score">
                  Au score de {scoreLabel(post.score) || '0–0'}
                </div>
              </article>
            ),
          )}
          {match.status === 'finished' && (
            <p className="feed-end">
              Le match est terminé. Merci d’avoir suivi le live.
            </p>
          )}
        </div>
      </div>
      <button
        ref={latest}
        hidden
        className="latest-button"
        onClick={jumpToLatest}
      >
        ↓ Derniers commentaires
      </button>
      {showMemberDock && (
        <div className="member-dock">
          {reactionDock}
          {menu && (
            <div className="dock-options">
              <button
                onClick={() => {
                  setMenu(false);
                  setSheet('poll');
                }}
              >
                <LiveIcon kind="poll" /> Lancer un sondage
              </button>
              {[
                'Quel échange ! 🔥',
                'Ambiance au rendez-vous 👏',
                'Petite pause ☀️',
              ].map((text) => (
                <button
                  key={text}
                  onClick={() => {
                    setDraft(text);
                    setMenu(false);
                    input.current?.focus();
                  }}
                >
                  {text}
                </button>
              ))}
            </div>
          )}
          <form
            className="dock-form"
            onSubmit={async (e) => {
              e.preventDefault();
              if (draft.trim() && (await publish(draft.trim()))) setDraft('');
            }}
          >
            <button
              className="dock-plus"
              type="button"
              aria-label="Options de publication"
              aria-expanded={menu}
              disabled={!canWrite}
              onClick={() => setMenu(!menu)}
            >
              +
            </button>
            <textarea
              ref={input}
              aria-label="Commentaire du live"
              placeholder={
                match.status === 'live'
                  ? 'Un temps fort du match…'
                  : 'Le fil est en lecture seule'
              }
              rows={1}
              maxLength={280}
              disabled={!canWrite || activity.busy}
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
            />
            <button
              className="dock-send"
              aria-label="Publier le commentaire"
              disabled={!canWrite || activity.busy || !draft.trim()}
            >
              ↑
            </button>
          </form>
          <div className="dock-caption">
            <span>Animation du club</span>
            <span>{draft.length}/280</span>
          </div>
        </div>
      )}
      {activity.actionError && sheet !== 'poll' && (
        <p className="live-error action-error" role="alert">
          {activity.actionError}
        </p>
      )}
      {!showMemberDock && reactionDock}
      {sheet === 'info' && (
        <LiveSheet title="Le match" onClose={() => setSheet(null)}>
          <div className="match-details">
            {([1, 2] as const).map((team) => (
              <p key={team}>
                <strong>{getTeamLabel(match, team)}</strong>
                <br />
                {team === 1
                  ? `${match.j1_club || 'Club non précisé'} · ${match.j1_classement || 'NC'}`
                  : `${match.j2_club || 'Club non précisé'} · ${match.j2_classement || 'NC'}`}
              </p>
            ))}
            <p>
              {new Date(`${match.match_date}T12:00:00`).toLocaleDateString(
                'fr-FR',
                { dateStyle: 'long' },
              )}
              {match.start_time && ` · ${match.start_time.slice(0, 5)}`}
              {match.court && ` · Court ${match.court}`}
            </p>
            {canAnimate && (
              <form
                onSubmit={async (e) => {
                  e.preventDefault();
                  const court = String(
                    new FormData(e.currentTarget).get('court') ?? '',
                  ).trim();
                  await save({ court: court || null });
                }}
              >
                <label htmlFor="live-court">Court</label>
                <input
                  id="live-court"
                  name="court"
                  defaultValue={match.court ?? ''}
                  maxLength={60}
                />
                <button className="primary-button" disabled={blocked}>
                  Enregistrer le court
                </button>
              </form>
            )}
            <p>
              {match.type_tournoi}
              {match.set3_format &&
                ` · 3e set : ${match.set3_format === 'normal' ? 'set classique' : 'super tie-break'}`}
            </p>
            {match.team_rencontre_id && (
              <Link to={`/matches-equipes/${match.team_rencontre_id}`}>
                Voir la rencontre →
              </Link>
            )}
          </div>
        </LiveSheet>
      )}
      {sheet === 'score' && canAnimate && (
        <LiveSheet title="Ajuster le score" onClose={() => setSheet(null)}>
          <p className="sheet-intro">
            Les changements sont enregistrés immédiatement.
          </p>
          <LiveScoreEntry
            match={match}
            onPatch={(patch) => void patchScore(patch)}
            forceDisabled={blocked}
          />
          {match.status === 'finished' && (
            <button
              className="primary-button"
              disabled={blocked}
              onClick={() =>
                void patchScore(
                  {
                    status: 'live',
                    winner: null,
                    finished_at: null,
                    retired_player: null,
                  },
                  false,
                )
              }
            >
              Rouvrir pour corriger
            </button>
          )}
          {match.status === 'live' && (
            <button
              className="retire-button"
              disabled={blocked}
              onClick={() => setSheet('retire')}
            >
              Abandon d’un joueur
            </button>
          )}
          {savingError && (
            <p className="live-error" role="alert">
              {savingError}
              <button onClick={() => void live.reload()}>
                Recharger le score
              </button>
            </p>
          )}
        </LiveSheet>
      )}
      {sheet === 'retire' && canAnimate && (
        <LiveSheet title="Qui abandonne ?" onClose={() => setSheet('score')}>
          {(['j1', 'j2'] as const).map((side, i) => (
            <button
              key={side}
              className="primary-button"
              disabled={blocked}
              onClick={async () => {
                if (
                  await patchScore(
                    {
                      status: 'finished',
                      retired_player: side,
                      winner: side === 'j1' ? 'j2' : 'j1',
                      finished_at: new Date().toISOString(),
                    },
                    false,
                  )
                )
                  setSheet(null);
              }}
            >
              {getTeamLabel(match, i === 0 ? 1 : 2)} abandonne
            </button>
          ))}
        </LiveSheet>
      )}
      {sheet === 'poll' && canWrite && (
        <LiveSheet title="Lancer un sondage" onClose={() => setSheet(null)}>
          <PollForm
            busy={activity.busy}
            error={activity.actionError}
            onSubmit={async (body, options) => {
              const success = await publish(body, options);
              if (success) setSheet(null);
              return success;
            }}
          />
        </LiveSheet>
      )}
      {pollId && (
        <LiveSheet title="Le sondage du live" onClose={() => setPollId(null)}>
          {poll ? (
            <>
              <PollAnswers
                post={{
                  ...poll,
                  closed: poll.closed || match.status !== 'live',
                }}
                userId={userId}
                canManage={canAnimate}
                busy={activity.busy}
                onLogin={login}
                onVote={(index) =>
                  void activity.run('vote', { id: poll.id, option: index })
                }
                onClosePoll={() => void activity.run('close', { id: poll.id })}
              />
              {canAnimate && (
                <button
                  className="retire-button"
                  disabled={activity.busy}
                  onClick={async () => {
                    if (
                      window.confirm('Supprimer ce sondage ?') &&
                      (await activity.run('delete', { id: poll.id }))
                    )
                      setPollId(null);
                  }}
                >
                  Supprimer le sondage
                </button>
              )}
            </>
          ) : (
            <p className="sheet-intro">Ce sondage n’est plus disponible.</p>
          )}
          {activity.actionError && (
            <p role="alert" className="live-error">
              {activity.actionError}
            </p>
          )}
        </LiveSheet>
      )}
    </div>
  );
}
