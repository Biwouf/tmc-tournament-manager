import {
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type CSSProperties,
} from 'react';
import { Link, useLocation, useNavigate, useParams } from 'react-router-dom';
import {
  keepPreviousData,
  useQuery,
  useQueryClient,
} from '@tanstack/react-query';
import { useClub } from '../contexts/ClubContext';
import { useAuth } from '../hooks/useAuth';
import { useLiveMatch } from '../hooks/useLiveMatch';
import { useLiveActivity } from '../hooks/useLiveActivity';
import {
  firstServerFor,
  getServer,
  getTeamLabel,
  isSet3Needed,
} from '../liveScoreRules';
import {
  canFinish,
  finalScorePatch,
  scoreSnapshot,
  scoreLabel,
} from '../lib/liveScoreActions';
import type { LiveMatch } from '../types';
import LiveScoreEntry from '../components/matches/LiveScoreEntry';
import LiveIcon from '../components/live/LiveIcon';
import LiveScoreboard from '../components/live/LiveScoreboard';
import LiveSheet from '../components/live/LiveSheet';
import PostReactions from '../components/live/PostReactions';
import FirstServerPicker from '../components/live/FirstServerPicker';
import LiveRecap from '../components/live/LiveRecap';
import { LiveFollowButton } from '../components/live/LivePush';
import { announceLiveStart } from '../lib/liveFollows';
import { PollAnswers, PollForm } from '../components/live/LivePoll';
import {
  compressPhoto,
  livePhotoPath,
  livePhotoUrl,
  removeLivePhoto,
  uploadLivePhoto,
} from '../lib/liveActivity';
import { countLiveView, readRecap } from '../lib/liveRecap';
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
  const activity = useLiveActivity(id, clubId, userId);
  // Ligne déjà chargée par la liste Live (tenue à jour par le Broadcast) : affichée tout de suite.
  const queryClient = useQueryClient();
  const live = useLiveMatch(
    id,
    clubId,
    userId,
    !authLoading && activity.canAnimate,
    queryClient
      .getQueryData<LiveMatch[]>(['matches', clubId])
      ?.find((m) => m.id === id),
  );
  const { match, saving, savingError, save } = live;
  const canAnimate = !authLoading && activity.canAnimate;
  const [sheet, setSheet] = useState<
    'score' | 'set3' | 'info' | 'poll' | 'retire' | null
  >(null);
  const [pollId, setPollId] = useState<string | null>(null);
  const [startNotice, setStartNotice] = useState('');
  const [followToast, setFollowToast] = useState('');
  useEffect(() => {
    if (!followToast) return;
    const timer = setTimeout(() => setFollowToast(''), 3000);
    return () => clearTimeout(timer);
  }, [followToast]);
  const [draft, setDraft] = useState('');
  const [photo, setPhoto] = useState<{
    id: string;
    blob: Blob;
    preview: string;
    sent: boolean;
  } | null>(null);
  const [photoBusy, setPhotoBusy] = useState(false);
  const [photoError, setPhotoError] = useState('');
  const fileInput = useRef<HTMLInputElement>(null);
  const preview = photo?.preview;
  useEffect(() => {
    if (preview) return () => URL.revokeObjectURL(preview);
  }, [preview]);
  const [menu, setMenu] = useState(false);
  const [history, setHistory] = useState<
    { before: Partial<LiveMatch>; revision: number }[]
  >([]);
  const undo = history[history.length - 1];
  const [height, setHeight] = useState<number>();
  const [keyboard, setKeyboard] = useState(0);
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
  // Commentaires et photos restent ouverts après la fin du match ; les sondages, non.
  const canWrite =
    canAnimate &&
    (match?.status === 'live' || match?.status === 'finished') &&
    !activity.isError;
  const canPoll = canWrite && match?.status === 'live';
  const scoreError = savingError ?? live.error;
  const blocked = saving || !live.confirmed || !!scoreError || !canAnimate;
  const login = () =>
    navigate('/login', { state: { from: location.pathname } });
  useEffect(() => {
    const viewport = window.visualViewport;
    const resize = () => {
      if (!viewport || viewport.scale === 1) {
        setHeight(viewport?.height ?? window.innerHeight);
        // Les feuilles (<dialog>) sont ancrées au bas du viewport de mise en
        // page, que le clavier ne réduit pas : sans ce décalage, le
        // formulaire du sondage s'ouvre caché derrière le clavier.
        setKeyboard(
          viewport
            ? Math.max(
                0,
                window.innerHeight - viewport.height - viewport.offsetTop,
              )
            : 0,
        );
        // iOS fait défiler le document au focus du composer avant que la vue
        // ne soit réduite à la hauteur du clavier : elle se retrouve alors
        // hors écran jusqu'à la première frappe. La vue suit déjà le viewport
        // visible, le document n'a donc jamais à défiler.
        if (window.scrollY) window.scrollTo(0, 0);
      }
    };
    resize();
    viewport?.addEventListener('resize', resize);
    viewport?.addEventListener('scroll', resize);
    window.addEventListener('resize', resize);
    return () => {
      viewport?.removeEventListener('resize', resize);
      viewport?.removeEventListener('scroll', resize);
      window.removeEventListener('resize', resize);
    };
  }, []);
  const refetchActivity = activity.refetch;
  useEffect(() => {
    if (match?.status) void refetchActivity();
  }, [match?.status, refetchActivity]);
  // Spectateurs uniques du récap : comptés une fois par appareil, pendant le live.
  useEffect(() => {
    if (id && match?.status === 'live') countLiveView(id);
  }, [id, match?.status]);
  const signature = activity.items.map((p) => p.id).join(',');
  // Relu quand le fil change (publication ou réaction ajoutée après la fin du match).
  const feedVersion = activity.items
    .map((p) => `${p.id}:${p.reactions.reduce((n, r) => n + r.count, 0)}`)
    .join(',');
  const recap = useQuery({
    queryKey: ['live-recap', clubId, id, feedVersion],
    enabled: !!id && !!clubId && match?.status === 'finished',
    queryFn: () => readRecap(id!, clubId!),
    placeholderData: keepPreviousData,
  });
  const recapData = match?.status === 'finished' ? recap.data : null;
  const recapShown = useRef(false);
  const recapCard = useRef<HTMLDivElement>(null);
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
  // Le fil s'ouvre en bas : à sa première apparition, le récap est montré depuis son début.
  useLayoutEffect(() => {
    const el = feed.current;
    const card = recapCard.current;
    if (!recapData || recapShown.current || !el || !card) return;
    recapShown.current = true;
    if (follow.current)
      el.scrollTop +=
        card.getBoundingClientRect().top - el.getBoundingClientRect().top - 12;
  }, [recapData]);
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
    if (!canWrite || (options && !canPoll)) return false;
    forceFollow.current = true;
    const success = await activity.run(options ? 'poll' : 'message', {
      body,
      ...(options ? { options } : {}),
    });
    if (success) jumpToLatest();
    else forceFollow.current = false;
    return success;
  }
  async function choosePhoto(file: File | undefined) {
    if (!file) return;
    setPhotoError('');
    setPhotoBusy(true);
    try {
      const blob = await compressPhoto(file);
      discardPhoto();
      setPhoto({
        id: crypto.randomUUID(),
        blob,
        preview: URL.createObjectURL(blob),
        sent: false,
      });
    } catch (error) {
      setPhotoError(
        error instanceof Error ? error.message : 'Photo illisible.',
      );
    } finally {
      setPhotoBusy(false);
    }
  }
  function discardPhoto() {
    // Fichier déjà envoyé sans publication aboutie : on ne laisse pas d'orphelin.
    if (photo?.sent)
      void removeLivePhoto(livePhotoPath(clubId!, match!.id, photo.id));
    setPhoto(null);
  }
  async function publishPhoto(body: string) {
    if (!canWrite || !photo) return false;
    setPhotoError('');
    if (!photo.sent) {
      setPhotoBusy(true);
      try {
        await uploadLivePhoto(
          livePhotoPath(clubId!, match!.id, photo.id),
          photo.blob,
        );
        setPhoto({ ...photo, sent: true });
      } catch (error) {
        setPhotoError(
          error instanceof Error ? error.message : 'Envoi impossible.',
        );
        return false;
      } finally {
        setPhotoBusy(false);
      }
    }
    forceFollow.current = true;
    const success = await activity.run('photo', { id: photo.id, body });
    if (success) {
      setPhoto(null);
      jumpToLatest();
    } else forceFollow.current = false;
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
  const showMemberDock =
    canAnimate && (match.status === 'live' || match.status === 'finished');
  const canFollow = canAnimate && !!userId && !!clubId && match.status !== 'finished';
  return (
    <div
      className="live-view"
      style={
        {
          '--live-viewport-height': height ? `${height}px` : '100dvh',
          '--live-keyboard-inset': `${keyboard}px`,
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
        {canFollow && (
          <LiveFollowButton
            clubId={clubId!}
            userId={userId!}
            matchId={match.id}
            iconOnly
            onChange={(following) => setFollowToast(following
              ? 'Alertes activées pour ce match'
              : 'Alertes désactivées pour ce match')}
          />
        )}
      </header>
      <LiveScoreboard
        match={match}
        canAnimate={canAnimate}
        blocked={blocked}
        saving={saving}
        syncing={!live.confirmed}
        scoreError={scoreError}
        canUndo={!!undo && undo.revision === match.revision}
        onOpenScore={() => setSheet('score')}
        // Match par équipes historique : la règle se fixe dans la rencontre.
        onChooseSet3={() =>
          setSheet(match.team_match_line_id ? 'score' : 'set3')
        }
        onReload={() => void live.reload()}
        onScore={async (patch) => {
          // Un set partout : on propose aussitôt le format du set décisif.
          const tied =
            !match.set3_format &&
            !match.team_match_line_id &&
            !isSet3Needed(match) &&
            isSet3Needed({ ...match, ...patch });
          if ((await patchScore(patch)) && tied) setSheet('set3');
        }}
        onStart={async (firstServer, notify) => {
          const started = await patchScore(
            {
              status: 'live',
              first_server: firstServer,
              started_at: new Date().toISOString(),
              scored_by: userId,
            },
            false,
          );
          if (started && notify && clubId && !(await announceLiveStart(clubId, match.id)))
            setStartNotice('Le live a démarré, mais l’alerte n’a pas pu être envoyée.');
          if (started && !firstServer) setSheet('score');
        }}
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
      {startNotice && <p role="status" className="live-note">{startNotice}</p>}
      {followToast && <p role="status" className="live-toast">{followToast}</p>}
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
                      aria-label={
                        post.kind === 'photo'
                          ? 'Supprimer cette photo'
                          : 'Supprimer ce commentaire'
                      }
                      disabled={activity.busy}
                      onClick={async () => {
                        if (
                          window.confirm(
                            post.kind === 'photo'
                              ? 'Supprimer cette photo ?'
                              : 'Supprimer ce commentaire ?',
                          ) &&
                          (await activity.run('delete', { id: post.id })) &&
                          post.image_path
                        )
                          void removeLivePhoto(post.image_path);
                      }}
                    >
                      ×
                    </button>
                  )}
                </div>
                {post.image_path && (
                  <a
                    className="post-photo"
                    href={livePhotoUrl(post.image_path)}
                    target="_blank"
                    rel="noreferrer"
                  >
                    <img
                      src={livePhotoUrl(post.image_path)}
                      alt={post.body || `Photo de ${post.author_name}`}
                      loading="lazy"
                    />
                  </a>
                )}
                {post.body && <p>{post.body}</p>}
                <div className="post-score">
                  Au score de {scoreLabel(post.score) || '0–0'}
                </div>
                <PostReactions
                  post={post}
                  signedIn={!!userId}
                  pending={activity.reacting.includes(post.id)}
                  onReact={(emoji) => void activity.react(post.id, emoji)}
                />
              </article>
            ),
          )}
          {recapData && (
            <div ref={recapCard}>
              <LiveRecap match={match} recap={recapData} />
            </div>
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
          {menu && (
            <div className="dock-options">
              {canPoll && (
                <button
                  onClick={() => {
                    setMenu(false);
                    setSheet('poll');
                  }}
                >
                  <LiveIcon kind="poll" /> Lancer un sondage
                </button>
              )}
              <button
                disabled={photoBusy || activity.busy}
                onClick={() => {
                  setMenu(false);
                  fileInput.current?.click();
                }}
              >
                <LiveIcon kind="photo" /> Ajouter une photo
              </button>
            </div>
          )}
          {photo && (
            <div className="dock-photo">
              <img src={photo.preview} alt="Photo à publier" />
              <button
                type="button"
                aria-label="Retirer la photo"
                disabled={photoBusy || activity.busy}
                onClick={discardPhoto}
              >
                ×
              </button>
            </div>
          )}
          <form
            className="dock-form"
            onSubmit={async (e) => {
              e.preventDefault();
              if (
                photo
                  ? await publishPhoto(draft.trim())
                  : draft.trim() && (await publish(draft.trim()))
              )
                setDraft('');
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
            <input
              ref={fileInput}
              type="file"
              accept="image/*"
              hidden
              aria-label="Photo du live"
              onChange={(e) => {
                void choosePhoto(e.target.files?.[0]);
                e.target.value = '';
              }}
            />
            <textarea
              ref={input}
              aria-label="Commentaire du live"
              placeholder={
                photo
                  ? 'Une légende (facultatif)…'
                  : match.status === 'finished'
                    ? 'Un mot sur le match…'
                    : 'Un temps fort du match…'
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
              disabled={
                !canWrite ||
                activity.busy ||
                photoBusy ||
                (!draft.trim() && !photo)
              }
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
      {(photoError || activity.actionError) && sheet !== 'poll' && (
        <p className="live-error action-error" role="alert">
          {photoError || activity.actionError}
        </p>
      )}
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
          {match.status === 'live' && (
            <FirstServerPicker
              match={match}
              title="Qui sert maintenant ?"
              disabled={blocked}
              current={getServer(match)}
              onPick={async (side) => {
                if (await save({ first_server: firstServerFor(match, side) }))
                  setSheet(null);
              }}
              extraLabel="Effacer"
              extraDisabled={!match.first_server}
              onExtra={() => void save({ first_server: null })}
            />
          )}
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
          {canFinish(match) && (
            <button
              className="primary-button"
              disabled={blocked}
              onClick={() => void patchScore({})}
            >
              Terminer le match
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
      {sheet === 'set3' && canAnimate && (
        <LiveSheet
          title="Format du set décisif"
          onClose={() => setSheet(null)}
        >
          {(
            [
              ['normal', 'Set normal'],
              ['super_tiebreak', 'Super tiebreak'],
            ] as const
          ).map(([format, label]) => (
            <button
              key={format}
              className="primary-button"
              disabled={blocked}
              onClick={async () => {
                if (
                  await patchScore(
                    format === 'super_tiebreak'
                      ? {
                          set3_format: format,
                          set3_tb_j1: null,
                          set3_tb_j2: null,
                        }
                      : { set3_format: format },
                  )
                )
                  setSheet(null);
              }}
            >
              {label}
            </button>
          ))}
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
      {sheet === 'poll' && canPoll && (
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
