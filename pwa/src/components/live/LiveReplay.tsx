import { useEffect, useRef, useState, type ReactNode } from 'react';
import type { LiveMatch, LiveMatchWinner } from '../../types';
import { getTeamLabel } from '../../liveScoreRules';
import { livePhotoUrl } from '../../lib/liveActivity';
import { formatDuration } from '../../lib/liveDurations';
import {
  matchHighlight,
  recapSets,
  replayFrames,
  type LiveRecap,
  type RecapSet,
} from '../../lib/liveRecap';

const reducedMotion = () =>
  typeof window.matchMedia === 'function' &&
  window.matchMedia('(prefers-reduced-motion: reduce)').matches;
const time = (iso: string | null) =>
  iso
    ? new Date(iso).toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' })
    : '';
const PHOTO_MS = 2600;

/** Nom court pour le tableau de score : « A. Martin », « Martin / Durand » en double. */
export function shortName(m: LiveMatch, side: LiveMatchWinner) {
  const [prenom, nom, partner] =
    side === 'j1' ? [m.j1_prenom, m.j1_nom, m.j3_nom] : [m.j2_prenom, m.j2_nom, m.j4_nom];
  if (m.match_type === 'double' && partner) return `${nom} / ${partner}`;
  return `${prenom ? `${prenom.slice(0, 1)}. ` : ''}${nom}`;
}

type Scene = { key: string; duration: number; render: (elapsed: number) => ReactNode };

/**
 * Story plein écran « Revivre le match » : intro, match en accéléré avec les
 * publications les plus réagies à leur heure, moment fort, diaporama photos,
 * tribune, vainqueur. Toucher à gauche recule, à droite avance.
 */
export default function LiveReplay({
  match,
  recap,
  onClose,
}: {
  match: LiveMatch;
  recap: LiveRecap;
  onClose: () => void;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const d = dialog.current!;
    d.showModal();
    return () => d.close();
  }, []);
  const name = (side: LiveMatchWinner) => shortName(match, side);
  const sets = recapSets(match, recap.score);
  const frames = replayFrames(match, recap.score);
  const highlight = matchHighlight(match, sets, name);
  const photos = recap.photos_top.filter((p) => p.image_path);
  const duration =
    match.started_at && match.finished_at
      ? Date.parse(match.finished_at) - Date.parse(match.started_at)
      : null;
  const scenes: Scene[] = [
    { key: 'intro', duration: 3500, render: () => <Intro match={match} /> },
  ];
  if (frames.length > 1)
    scenes.push({
      key: 'replay',
      duration: Math.min(14000, Math.max(5000, frames.length * 450)),
      render: (elapsed) => (
        <Replay
          match={match}
          recap={recap}
          frames={frames}
          progress={elapsed / Math.min(14000, Math.max(5000, frames.length * 450))}
        />
      ),
    });
  if (highlight)
    scenes.push({
      key: 'highlight',
      duration: 4500,
      render: () => (
        <div className="replay-center">
          <span className="replay-kicker">LE MOMENT FORT</span>
          <p className="replay-big">{highlight.title}</p>
          <p className="replay-muted">{highlight.detail}</p>
        </div>
      ),
    });
  if (photos.length)
    scenes.push({
      key: 'photos',
      duration: photos.length * PHOTO_MS,
      render: (elapsed) => {
        const photo = photos[Math.min(photos.length - 1, Math.floor(elapsed / PHOTO_MS))];
        return (
          <div className="replay-photo" key={photo.id}>
            <img src={livePhotoUrl(photo.image_path!)} alt={photo.body || `Photo de ${photo.author_name}`} />
            <p>
              {photo.body && <span>« {photo.body} »</span>}
              <small>
                {photo.author_name} · {time(photo.created_at)}
                {photo.reactions > 0 && ` · ${photo.emoji ?? ''} ${photo.reactions}`}
              </small>
            </p>
          </div>
        );
      },
    });
  scenes.push(
    {
      key: 'crowd',
      duration: 4500,
      render: (elapsed) => <Crowd recap={recap} elapsed={elapsed} />,
    },
    {
      key: 'final',
      duration: 5000,
      render: () => <Final match={match} sets={sets} duration={duration} />,
    },
  );

  const [index, setIndex] = useState(0);
  const [elapsed, setElapsed] = useState(0);
  const [paused, setPaused] = useState(false);
  const [ended, setEnded] = useState(false);
  const clock = useRef(0);
  const scene = scenes[index];
  const last = scenes.length - 1;
  const go = (i: number) => {
    clock.current = 0;
    setElapsed(0);
    setEnded(false);
    setIndex(Math.max(0, Math.min(last, i)));
  };
  useEffect(() => {
    if (paused || ended) return;
    const start = performance.now() - clock.current;
    let frame = requestAnimationFrame(function tick() {
      const now = performance.now() - start;
      clock.current = Math.min(now, scene.duration);
      setElapsed(clock.current);
      if (now < scene.duration) frame = requestAnimationFrame(tick);
      else if (index < last) go(index + 1);
      else setEnded(true);
    });
    return () => cancelAnimationFrame(frame);
  }, [index, paused, ended]);

  return (
    <dialog
      ref={dialog}
      className="replay"
      aria-label="Revivre le match"
      onCancel={(e) => {
        e.preventDefault();
        onClose();
      }}
    >
      <div className="replay-bars" aria-hidden="true">
        {scenes.map((s, i) => (
          <span key={s.key}>
            <i
              style={{
                width: `${i < index ? 100 : i > index ? 0 : (elapsed / scene.duration) * 100}%`,
              }}
            />
          </span>
        ))}
      </div>
      <div className="replay-tools">
        <button
          aria-label={paused ? 'Reprendre' : 'Mettre en pause'}
          onClick={() => setPaused(!paused)}
        >
          {paused ? '▶' : '❚❚'}
        </button>
        <button aria-label="Fermer le récap" onClick={onClose} autoFocus>
          ×
        </button>
      </div>
      <div className="replay-scene" key={scene.key}>
        {scene.render(elapsed)}
      </div>
      {ended ? (
        <div className="replay-end">
          <button className="replay-cta" onClick={() => go(0)}>
            ↻ Revoir
          </button>
          <button className="replay-secondary" onClick={onClose}>
            Retour au live
          </button>
        </div>
      ) : (
        <>
          <button
            className="replay-zone prev"
            aria-label="Scène précédente"
            onClick={() => go(index - 1)}
          />
          <button
            className="replay-zone next"
            aria-label="Scène suivante"
            onClick={() => (index < last ? go(index + 1) : setEnded(true))}
          />
        </>
      )}
    </dialog>
  );
}

function Intro({ match }: { match: LiveMatch }) {
  const date = new Date(`${match.match_date}T12:00:00`).toLocaleDateString('fr-FR', {
    day: 'numeric',
    month: 'long',
  });
  return (
    <div className="replay-center">
      <span className="replay-kicker">REVIVEZ LE MATCH</span>
      <p className="replay-big">
        {getTeamLabel(match, 1)}
        <small>contre</small>
        {getTeamLabel(match, 2)}
      </p>
      <p className="replay-muted">
        {[match.type_tournoi, match.court && `Court ${match.court}`, date]
          .filter(Boolean)
          .join(' · ')}
      </p>
    </div>
  );
}

function Replay({
  match,
  recap,
  frames,
  progress,
}: {
  match: LiveMatch;
  recap: LiveRecap;
  frames: ReturnType<typeof replayFrames>;
  progress: number;
}) {
  const step = Math.min(frames.length - 1, Math.floor(progress * frames.length * 1.08));
  const frame = frames[step];
  const now = frame.at ? Date.parse(frame.at) : null;
  const shown =
    now === null
      ? recap.moments.slice(0, Math.floor(progress * (recap.moments.length + 1)))
      : recap.moments.filter((p) => Date.parse(p.created_at) <= now);
  const columns = frames[frames.length - 1].sets.length;
  return (
    <div className="replay-live">
      <span className="replay-kicker">LE MATCH EN ACCÉLÉRÉ</span>
      <span className="replay-clock">{time(frame.at)}</span>
      <div className="replay-board">
        {(['j1', 'j2'] as const).map((side, row) => (
          <div key={side}>
            <span>{shortName(match, side)}</span>
            {Array.from({ length: columns }, (_, i) => {
              const value = frame.sets[i]?.[row];
              return (
                <b
                  key={`${i}:${value}`}
                  className={frame.game?.side === side && frame.game.set === i ? 'won' : ''}
                >
                  {value ?? ''}
                </b>
              );
            })}
          </div>
        ))}
        {frame.game?.isBreak && (
          <span className="replay-break" key={step}>
            BREAK · {shortName(match, frame.game.side)}
          </span>
        )}
      </div>
      <div className="replay-feed">
        {shown.slice(-3).map((p) => (
          <p key={p.id} className="replay-bubble">
            {p.image_path && <img src={livePhotoUrl(p.image_path)} alt="" />}
            <span>
              {p.body || 'Photo'}
              <small>
                {p.author_name}
                {p.reactions > 0 && ` · ${p.emoji ?? ''} ${p.reactions}`}
              </small>
            </span>
          </p>
        ))}
      </div>
    </div>
  );
}

function Crowd({ recap, elapsed }: { recap: LiveRecap; elapsed: number }) {
  const t = reducedMotion() ? 1 : Math.min(1, elapsed / 1500);
  const ease = 1 - (1 - t) ** 3;
  // Valeur animée pour l'œil, valeur exacte pour les lecteurs d'écran.
  const count = (n: number) => (
    <>
      <span aria-hidden="true">{Math.round(n * ease)}</span>
      <span className="sr-only">{n}</span>
    </>
  );
  const posts = recap.messages + recap.photos + recap.polls;
  const emojis = recap.top_reactions.map((r) => r.emoji);
  return (
    <div className="replay-center replay-crowd">
      <span className="replay-kicker">EN TRIBUNE</span>
      {recap.viewers !== null && (
        <p className="replay-big">
          {count(recap.viewers)}
          <small>spectateurs ont suivi le live</small>
        </p>
      )}
      <p className="replay-stats">
        <span>
          <strong>{count(posts)}</strong> publications
        </span>
        <span>
          <strong>{count(recap.reactions)}</strong> réactions
        </span>
      </p>
      {emojis.length > 0 && (
        <p className="replay-muted replay-emojis">
          {recap.top_reactions.map((r) => (
            <span key={r.emoji}>
              {r.emoji} {r.count}
            </span>
          ))}
        </p>
      )}
      {emojis.length > 0 &&
        !reducedMotion() &&
        Array.from({ length: 16 }, (_, i) => (
          <span
            key={i}
            className="replay-float"
            aria-hidden="true"
            style={{ left: `${(i * 37) % 90 + 5}%`, animationDelay: `${i * 140}ms` }}
          >
            {emojis[i % emojis.length]}
          </span>
        ))}
    </div>
  );
}

function Final({
  match,
  sets,
  duration,
}: {
  match: LiveMatch;
  sets: RecapSet[];
  duration: number | null;
}) {
  return (
    <div className="replay-center">
      <span className="replay-kicker">{match.winner ? 'VAINQUEUR' : 'SCORE FINAL'}</span>
      {match.winner && (
        <p className="replay-big">
          {getTeamLabel(match, match.winner === 'j1' ? 1 : 2)}
          {match.retired_player && <small>sur abandon</small>}
        </p>
      )}
      <p className="replay-score">
        {sets.map((s) => (
          <span key={s.set}>
            {s.score[0]}–{s.score[1]}
            {s.tiebreak && <sup>{Math.min(...s.tiebreak)}</sup>}
          </span>
        ))}
      </p>
      <ol className="replay-games" aria-hidden="true">
        {sets.map((s) => (
          <li key={s.set}>
            {s.games?.map((g, i) => (
              <i
                key={i}
                className={`${g.side === 'j1' ? 'team-1' : 'team-2'}${g.known ? '' : ' unknown'}`}
                style={{ animationDelay: `${i * 60}ms` }}
              />
            ))}
          </li>
        ))}
      </ol>
      {duration !== null && (
        <p className="replay-muted">{formatDuration(duration)} de jeu</p>
      )}
    </div>
  );
}
