import { useState } from 'react';
import type { LivePost } from '../../lib/liveActivity';
export function PollForm({
  busy,
  error,
  onSubmit,
}: {
  busy: boolean;
  error: string;
  onSubmit: (body: string, options: string[]) => Promise<boolean>;
}) {
  const [body, setBody] = useState('');
  const [options, setOptions] = useState(['', '']);
  const choices = options.map((o) => o.trim());
  const valid =
    body.trim().length > 0 &&
    choices.every(Boolean) &&
    new Set(choices.map((o) => o.toLocaleLowerCase())).size === choices.length;
  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        if (valid) void onSubmit(body.trim(), choices);
      }}
    >
      <label htmlFor="poll-question">Votre question</label>
      <input
        id="poll-question"
        autoFocus
        maxLength={140}
        value={body}
        onChange={(e) => setBody(e.target.value)}
        required
        disabled={busy}
        placeholder="Qui va remporter ce match ?"
      />
      <div className="option-inputs">
        {options.map((option, i) => (
          <div key={i}>
            <label htmlFor={`poll-option-${i}`}>Réponse {i + 1}</label>
            <div>
              <input
                id={`poll-option-${i}`}
                maxLength={60}
                required
                value={option}
                disabled={busy}
                onChange={(e) =>
                  setOptions((o) =>
                    o.map((v, j) => (j === i ? e.target.value : v)),
                  )
                }
              />
              {options.length > 2 && (
                <button
                  type="button"
                  className="icon-button"
                  aria-label={`Retirer la réponse ${i + 1}`}
                  disabled={busy}
                  onClick={() => setOptions((o) => o.filter((_, j) => j !== i))}
                >
                  ×
                </button>
              )}
            </div>
          </div>
        ))}
      </div>
      {options.length < 4 && (
        <button
          type="button"
          className="add-option"
          disabled={busy}
          onClick={() => setOptions((o) => [...o, ''])}
        >
          + Ajouter une réponse
        </button>
      )}
      <p className="sheet-intro">
        Une réponse par compte. Plusieurs sondages peuvent rester ouverts.
      </p>
      {error && (
        <p role="alert" className="live-error">
          {error}
        </p>
      )}
      <button className="primary-button" disabled={busy || !valid}>
        {busy ? 'Publication…' : 'Publier le sondage'}
      </button>
    </form>
  );
}
export function PollAnswers({
  post,
  userId,
  busy,
  canManage,
  onVote,
  onClosePoll,
  onLogin,
}: {
  post: LivePost;
  userId: string | null;
  busy: boolean;
  canManage: boolean;
  onVote: (index: number) => void;
  onClosePoll: () => void;
  onLogin: () => void;
}) {
  return (
    <div className="expanded-poll">
      <p className="poll-question">{post.body}</p>
      <p className="poll-byline">
        {post.author_name} ·{' '}
        {post.closed ? 'Sondage terminé' : 'Une réponse par personne'}
      </p>
      <div className="poll-options">
        {post.options.map((option, i) => {
          const percent =
            post.counts && post.total > 0
              ? Math.round((post.counts[i] / post.total) * 100)
              : 0;
          return (
            <button
              key={i}
              className={post.my_vote === i ? 'selected' : ''}
              aria-pressed={post.my_vote === i}
              disabled={post.closed || busy}
              onClick={() => (userId ? onVote(i) : onLogin())}
            >
              {post.counts && (
                <span className="poll-bar" style={{ width: `${percent}%` }} />
              )}
              <span className="option-label">
                {post.my_vote === i ? '✓ ' : ''}
                {option}
              </span>
              {post.counts && <b>{percent}%</b>}
            </button>
          );
        })}
      </div>
      <div className="poll-footer">
        <span>
          {post.total} vote{post.total !== 1 ? 's' : ''}
        </span>
        {canManage && !post.closed && (
          <button disabled={busy} onClick={onClosePoll}>
            Clôturer
          </button>
        )}
      </div>
      {!post.closed && (
        <p className="sheet-intro">
          {post.my_vote !== null
            ? 'Vous pouvez changer votre réponse jusqu’à la clôture.'
            : userId
              ? 'Répondez pour découvrir les résultats.'
              : 'Connectez-vous pour répondre.'}
        </p>
      )}
    </div>
  );
}
