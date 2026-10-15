import { useRef, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import {
  firstEmoji,
  LIVE_REACTIONS,
  type LivePost,
} from '../../lib/liveActivity';
import LiveIcon from './LiveIcon';
import LiveSheet from './LiveSheet';

const LONG_PRESS_MS = 500;
const labelOf = (emoji: string) =>
  LIVE_REACTIONS.find(([e]) => e === emoji)?.[1] ?? emoji;

/**
 * Réactions sous un commentaire ou une photo : une par compte, retirée en touchant la sienne.
 * Toucher une autre puce (ou un appui long) montre qui a réagi.
 */
export default function PostReactions({
  post,
  signedIn,
  pending,
  onReact,
}: {
  post: LivePost;
  signedIn: boolean;
  pending: boolean;
  onReact: (emoji: string | null) => void;
}) {
  const [open, setOpen] = useState(false);
  const [who, setWho] = useState(false);
  const [keyboard, setKeyboard] = useState(false);
  const field = useRef<HTMLInputElement>(null);
  const press = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const held = useRef(false);
  const navigate = useNavigate();
  const location = useLocation();
  // Les noms ne sont renvoyés qu'aux comptes connectés.
  const canSeeWho = signedIn && post.reactions.length > 0;
  function choose(emoji: string) {
    setOpen(false);
    setKeyboard(false);
    if (!signedIn) navigate('/login', { state: { from: location.pathname } });
    else onReact(post.my_reaction === emoji ? null : emoji);
  }
  function release() {
    clearTimeout(press.current);
  }
  return (
    <div className="post-reactions">
      {post.reactions.map((r) => (
        <button
          key={r.emoji}
          className="reaction-chip"
          aria-pressed={post.my_reaction === r.emoji}
          aria-label={`${labelOf(r.emoji)} : ${r.count}`}
          disabled={pending}
          onPointerDown={() => {
            held.current = false;
            if (canSeeWho)
              press.current = setTimeout(() => {
                held.current = true;
                setWho(true);
              }, LONG_PRESS_MS);
          }}
          onPointerUp={release}
          onPointerLeave={release}
          onPointerCancel={release}
          onContextMenu={(e) => {
            if (!canSeeWho) return;
            e.preventDefault();
            setWho(true);
          }}
          onClick={() => {
            if (held.current) return;
            // Puce d'autrui : on voit qui a réagi ; la sienne se retire.
            if (signedIn && post.my_reaction !== r.emoji) setWho(true);
            else choose(r.emoji);
          }}
        >
          {r.emoji}
          <span>{r.count}</span>
        </button>
      ))}
      <button
        className="reaction-add"
        aria-label={open ? 'Fermer les réactions' : 'Réagir'}
        aria-expanded={open}
        disabled={pending}
        onClick={() => {
          if (!signedIn)
            navigate('/login', { state: { from: location.pathname } });
          else {
            setOpen(!open);
            setKeyboard(false);
          }
        }}
      >
        {open ? '×' : <LiveIcon kind="reaction" />}
      </button>
      {open && (
        <div className="post-palette" aria-label="Choisir une réaction">
          {LIVE_REACTIONS.map(([emoji, label]) => (
            <button
              key={emoji}
              aria-label={label}
              aria-pressed={post.my_reaction === emoji}
              onClick={() => choose(emoji)}
            >
              {emoji}
            </button>
          ))}
          <button
            className="reaction-more"
            aria-label="Autre emoji"
            aria-pressed={keyboard}
            onClick={() => {
              setKeyboard(true);
              // Focus synchrone, dans le geste : sinon iOS n'ouvre pas le clavier.
              field.current?.focus();
            }}
          >
            +
          </button>
          {/* Toujours monté pour être focusable dans le geste ; visible une fois demandé. */}
          <input
            ref={field}
            className={
              keyboard ? 'reaction-field' : 'reaction-field hidden-field'
            }
            aria-label="Emoji du clavier"
            placeholder="Choisissez un emoji…"
            enterKeyHint="done"
            autoComplete="off"
            onBlur={() => setKeyboard(false)}
            onChange={(e) => {
              const emoji = firstEmoji(e.target.value);
              e.target.value = '';
              if (emoji) {
                e.target.blur();
                choose(emoji);
              }
            }}
          />
        </div>
      )}
      {who && (
        <LiveSheet title="Réactions" onClose={() => setWho(false)}>
          <ul className="reaction-people">
            {post.reactions.map((r) => (
              <li key={r.emoji}>
                <span aria-label={labelOf(r.emoji)}>{r.emoji}</span>
                {r.names?.join(', ')}
              </li>
            ))}
          </ul>
        </LiveSheet>
      )}
    </div>
  );
}
