import { useEffect, useRef, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import {
  activityCommand,
  LIVE_REACTIONS,
  type LiveReaction,
} from '../../lib/liveActivity';

export default function LiveReactions({
  matchId,
  clubId,
  userId,
  canSend,
  receive,
  bursts,
  remove,
}: {
  matchId: string;
  clubId: string;
  userId: string | null;
  canSend: boolean;
  receive: (event: LiveReaction) => void;
  bursts: { id: string; user: string; emoji: string; combo: boolean }[];
  remove: (id: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const [error, setError] = useState('');
  const [pending, setPending] = useState(0);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const palette = useRef<HTMLDivElement>(null);
  const button = useRef<HTMLButtonElement>(null);
  const lifetime = useRef(0);
  const navigate = useNavigate();
  const location = useLocation();
  function keepOpen() {
    clearTimeout(timer.current);
    timer.current = setTimeout(() => {
      if (palette.current?.contains(document.activeElement))
        button.current?.focus();
      setOpen(false);
    }, 3000);
  }
  useEffect(() => {
    if (open) keepOpen();
    return () => clearTimeout(timer.current);
  }, [open]);
  useEffect(() => {
    const version = ++lifetime.current;
    return () => {
      lifetime.current = version + 1;
    };
  }, [matchId, userId]);
  async function send(emoji: string) {
    if (!userId) return;
    keepOpen();
    setError('');
    const version = lifetime.current;
    const id = crypto.randomUUID();
    setPending((n) => n + 1);
    // Le feedback local répond au geste. L'événement serveur est dédupliqué par id.
    receive({
      id,
      user_id: userId,
      match_id: matchId,
      emoji,
      created_at: new Date().toISOString(),
    });
    try {
      await activityCommand(matchId, clubId, 'reaction', { id, emoji });
    } catch (e) {
      if (version === lifetime.current)
        setError(e instanceof Error ? e.message : 'Réaction non envoyée.');
    } finally {
      if (version === lifetime.current) setPending((n) => n - 1);
    }
  }
  return (
    <div className="spectator-dock">
      <div className="reaction-anchor">
        {canSend && open && (
          <div
            ref={palette}
            onPointerDown={keepOpen}
            onFocus={keepOpen}
            className="reaction-palette"
            aria-label="Choisir une réaction"
          >
            {LIVE_REACTIONS.map(([emoji, label]) => (
              <button
                key={emoji}
                aria-label={label}
                onClick={() => void send(emoji)}
              >
                {emoji}
              </button>
            ))}
          </div>
        )}
        <div className="floating-bursts" aria-hidden="true">
          {bursts.map((b, i) => (
            <span
              key={b.id}
              className={b.combo ? 'emoji-combo' : 'emoji-single'}
              style={b.combo ? undefined : { left: `${(i % 4) * 10}px` }}
              onAnimationEnd={(e) => {
                if (e.target === e.currentTarget) remove(b.id);
              }}
            >
              {b.combo ? (
                <>
                  <i className="combo-ghost ghost-one">{b.emoji}</i>
                  <i className="combo-ghost ghost-two">{b.emoji}</i>
                  <i className="combo-ghost ghost-three">{b.emoji}</i>
                  <i className="combo-halo" />
                  <b className="combo-hero">{b.emoji}</b>
                  <i className="combo-spark spark-one">✦</i>
                  <i className="combo-spark spark-two">✦</i>
                  <small>×4</small>
                </>
              ) : (
                b.emoji
              )}
            </span>
          ))}
        </div>
        {canSend && (
          <button
            ref={button}
            className="reaction-toggle"
            aria-expanded={open}
            aria-label={open ? 'Fermer les réactions' : 'Ouvrir les réactions'}
            onClick={() => {
              if (!userId)
                navigate('/login', { state: { from: location.pathname } });
              else setOpen(!open);
            }}
          >
            {open ? '⌄' : '❤️'}
          </button>
        )}
        {error && (
          <p role="alert" className="reaction-error">
            {error}
            {pending === 0 && (
              <button onClick={() => setError('')}>Fermer</button>
            )}
          </p>
        )}
      </div>
    </div>
  );
}
