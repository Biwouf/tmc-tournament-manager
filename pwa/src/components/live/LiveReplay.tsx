import { useEffect, useRef, useState, type CSSProperties, type ReactNode } from 'react';
import type { LiveMatch, LiveMatchWinner } from '../../types';
import { getTeamLabel } from '../../liveScoreRules';
import { livePhotoUrl } from '../../lib/liveActivity';
import { formatDuration } from '../../lib/liveDurations';
import {
  matchHighlight,
  progression,
  recapSets,
  replayFrames,
  winnerFirst,
  type LiveRecap,
  type ProgressSet,
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
  const progress = progression(sets);
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
      duration: CURVE_START + curveTiming(progress).ms + FINISH_MS,
      render: (elapsed) => (
        <Final
          match={match}
          sets={sets}
          progress={progress}
          duration={duration}
          elapsed={elapsed}
        />
      ),
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
        {scene.render(ended ? scene.duration : elapsed)}
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

type Progress = ReturnType<typeof progression>;
const CURVE_START = 600;
const GAME_MS = 280;
const SET_PAUSE = 800;
const CURVE_MAX = 11000;
const FINISH_MS = 3200;
const W = 320;
const H = 180;
const PAD_L = 4;
const PAD_R = 16;
const GAP = 22;
const TOP = 22;
const BOTTOM = 8;

/** Durée du tracé : un temps par jeu, une pause à chaque fin de set, plafonnée. */
function curveTiming(p: Progress) {
  const pauses = SET_PAUSE * Math.max(0, p.sets.length - 1);
  const game = Math.min(GAME_MS, (CURVE_MAX - pauses) / (p.total || 1));
  return { game, ms: p.total * game + pauses };
}

/** Jeux tracés après `t` ms de tracé. */
function revealAt(p: Progress, t: number) {
  const { game } = curveTiming(p);
  let left = t;
  for (const [i, s] of p.sets.entries()) {
    const ms = (s.to - s.from) * game;
    if (left <= ms) return s.from + left / game;
    left -= ms;
    if (i < p.sets.length - 1) {
      if (left <= SET_PAUSE) return s.to;
      left -= SET_PAUSE;
    }
  }
  return p.total;
}

function Final({
  match,
  sets,
  progress,
  duration,
  elapsed,
}: {
  match: LiveMatch;
  sets: RecapSet[];
  progress: Progress;
  duration: number | null;
  elapsed: number;
}) {
  const { total, events } = progress;
  const parts = progress.sets;
  const reveal = reducedMotion() ? total : revealAt(progress, Math.max(0, elapsed - CURVE_START));
  const done = reveal >= total;
  const winner = match.winner;
  const team = (side: LiveMatchWinner | null) =>
    side === 'j1' ? 'team-1' : side === 'j2' ? 'team-2' : '';
  const width = W - PAD_L - PAD_R - GAP * Math.max(0, parts.length - 1);
  const px = (x: number, i: number) => PAD_L + i * GAP + (x / (total || 1)) * width;
  const games = Math.max(
    6,
    ...parts.filter((p) => !p.set.superTiebreak).map((p) => Math.max(...p.set.score)),
  );
  const py = (v: number, p: ProgressSet) =>
    H - BOTTOM - (v / (p.set.superTiebreak ? Math.max(1, ...p.set.score) : games)) * (H - TOP - BOTTOM);
  // Jeux de chaque joueur, interpolés le long du segment en cours.
  const valueAt = (p: ProgressSet, x: number): [number, number] => {
    const i = Math.max(1, p.points.findIndex((q) => q.x >= x));
    const [a, b] = [p.points[i - 1], p.points[i] ?? p.points[i - 1]];
    const t = b.x === a.x ? 1 : (x - a.x) / (b.x - a.x);
    return [0, 1].map((k) => a.games[k] + (b.games[k] - a.games[k]) * t) as [number, number];
  };
  const countAt = (p: ProgressSet, x: number) =>
    p.points.filter((q) => q.x <= x + 1e-6).pop()!.games;
  const path = (p: ProgressSet, k: 0 | 1, from = p.from, to = p.to) =>
    p.points
      .filter((q) => q.x >= from && q.x <= to)
      .map((q, i) => `${i ? 'L' : 'M'}${px(q.x, parts.indexOf(p))} ${py(q.games[k], p)}`)
      .join(' ');
  // Tracé par morceaux connus / inconnus, le second en pointillés.
  const pieces = (p: ProgressSet, k: 0 | 1) => {
    const i = parts.indexOf(p);
    const out: { known: boolean; d: string }[] = [];
    p.points.slice(1).forEach((q, j) => {
      const prev = p.points[j];
      const piece = out[out.length - 1];
      const to = `L${px(q.x, i)} ${py(q.games[k], p)}`;
      if (piece?.known === q.known) piece.d += ` ${to}`;
      else out.push({ known: q.known, d: `M${px(prev.x, i)} ${py(prev.games[k], p)} ${to}` });
    });
    return out;
  };
  const current = Math.max(0, parts.findIndex((p) => reveal <= p.to));
  const reached = events.filter((e) => e.x <= reveal);
  const partAt = (x: number) => parts.find((p) => x > p.from && x <= p.to) ?? parts[0];
  const pointOf = (side: LiveMatchWinner, x: number) => {
    const p = partAt(x);
    const k = side === 'j1' ? 0 : 1;
    return { x: px(x, parts.indexOf(p)), y: py(valueAt(p, x)[k], p) };
  };

  const caption = (() => {
    if (done && winner)
      return {
        id: 'match',
        side: winner,
        text: match.retired_player
          ? `🏆 Victoire de ${shortName(match, winner)} sur abandon`
          : `🏆 Jeu, set et match · ${shortName(match, winner)}`,
      };
    const e = reached[reached.length - 1];
    if (!e) return null;
    if (e.kind === 'streak') {
      const n = Math.min(e.to, Math.floor(reveal)) - e.from;
      return { id: e.id, side: e.side, text: `🔥 ${n} jeux d'affilée · ${shortName(match, e.side)}` };
    }
    const label = e.set.superTiebreak ? 'Super tie-break' : `Set ${e.set.set}`;
    const score = `${Math.max(...e.set.score)}–${Math.min(...e.set.score)}`;
    return {
      id: e.id,
      side: e.side,
      text: e.side ? `${label} pour ${shortName(match, e.side)} · ${score}` : `${label} · ${score}`,
    };
  })();

  return (
    <div className="replay-center replay-final">
      <span className="replay-kicker">{winner ? 'VAINQUEUR' : 'SCORE FINAL'}</span>
      {winner && (
        <p className="replay-big">
          {getTeamLabel(match, winner === 'j1' ? 1 : 2)}
          {match.retired_player && <small>sur abandon</small>}
        </p>
      )}
      <p className="replay-score">
        {sets.map((s) => (
          <span key={s.set}>
            {winnerFirst(s.score, winner).join('–')}
            {s.tiebreak && <sup>{Math.min(...s.tiebreak)}</sup>}
          </span>
        ))}
      </p>
      {duration !== null && (
        <p className="replay-muted">{formatDuration(duration)} de jeu</p>
      )}
      {total > 0 && (
        <figure className="replay-curve" aria-hidden="true">
          <figcaption>
            <span className="team-1">● {shortName(match, 'j1')}</span>
            <span className="team-2">● {shortName(match, 'j2')}</span>
          </figcaption>
          <svg viewBox={`0 0 ${W} ${H}`}>
            <defs>
              <clipPath id="replay-reveal">
                <rect x="0" y="0" width={px(reveal, current) + 0.01} height={H} />
              </clipPath>
            </defs>
            {parts.map((p, i) => {
              if (i > current) return null;
              const finished = reveal >= p.to;
              const x = Math.min(reveal, p.to);
              const now = valueAt(p, x);
              const count = countAt(p, x);
              const high = now[0] >= now[1] ? 0 : 1;
              const label = p.set.superTiebreak ? 'Super TB' : `Set ${p.set.set}`;
              const setEvent = events.find((e) => e.kind === 'set' && e.set === p.set);
              return (
                <g key={p.set.set}>
                  <line
                    className="replay-axis"
                    x1={px(p.from, i)}
                    x2={px(p.to, i)}
                    y1={py(0, p)}
                    y2={py(0, p)}
                  />
                  <text
                    key={finished ? 'score' : 'label'}
                    className={`replay-set ${finished ? team(setEvent?.side ?? null) : ''}`}
                    x={(px(p.from, i) + px(p.to, i)) / 2}
                    y={11}
                  >
                    {finished ? winnerFirst(p.set.score, winner).join('–') : label}
                  </text>
                  <g clipPath="url(#replay-reveal)">
                    {([1, 0] as const).map((k) =>
                      pieces(p, k).map((piece, j) => (
                        <path
                          key={`${k}:${j}`}
                          className={`replay-line team-${k + 1}${piece.known ? '' : ' unknown'}`}
                          d={piece.d}
                        />
                      )),
                    )}
                    {events.map(
                      (e) =>
                        e.kind === 'streak' &&
                        e.from < p.to &&
                        e.to > p.from && (
                          <path
                            key={e.id}
                            className={`replay-streak ${team(e.side)}`}
                            d={path(p, e.side === 'j1' ? 0 : 1, Math.max(p.from, e.from), Math.min(p.to, e.to))}
                          />
                        ),
                    )}
                  </g>
                  {([1, 0] as const).map((k) => (
                    <g key={k} className={`team-${k + 1}`}>
                      <circle className="replay-head" cx={px(x, i)} cy={py(now[k], p)} r="3.5" />
                      <text
                        className="replay-count"
                        x={px(x, i) + 6}
                        y={py(now[k], p) + (k === high ? -5 : 12)}
                      >
                        {count[k]}
                      </text>
                    </g>
                  ))}
                </g>
              );
            })}
            {reached.map((e) => {
              if (e.kind === 'set' && (e.x >= total || !e.side)) return null;
              const p = pointOf(e.side!, e.x);
              return (
                <circle
                  key={e.id}
                  className={`replay-spark ${team(e.side)}`}
                  cx={p.x}
                  cy={p.y}
                  r={e.kind === 'streak' ? 10 : 7}
                />
              );
            })}
            {done && winner && (
              <g
                className={`replay-finish ${team(winner)}`}
                transform={`translate(${pointOf(winner, total).x} ${pointOf(winner, total).y})`}
              >
                <circle className="ring" r="6" />
                <circle className="ring late" r="6" />
                {!reducedMotion() &&
                  Array.from({ length: 10 }, (_, i) => (
                    <line
                      key={i}
                      className="ray"
                      x1="0"
                      x2="6"
                      y1="0"
                      y2="0"
                      style={{ '--a': `${i * 36 + 18}deg` } as CSSProperties}
                    />
                  ))}
                <circle className="core" r="5" />
              </g>
            )}
          </svg>
        </figure>
      )}
      <p className={`replay-caption ${caption ? team(caption.side) : ''}`} key={caption?.id}>
        {caption?.text}
      </p>
    </div>
  );
}
