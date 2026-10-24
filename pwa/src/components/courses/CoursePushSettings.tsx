import { useEffect, useState } from 'react';
import { usePush } from '../../hooks/usePush';
import CourseSheet from './CourseSheet';
import PushSwitchRow from '../PushSwitchRow';

function useCoursePush(clubId: string, userId: string) {
  const push = usePush(clubId, userId);
  const enabled = Boolean(push.prefs?.courses);
  return { ...push, enabled, toggle: () => push.set('courses', !enabled) };
}

// Ligne « Cours » de la liste Notifications de Mon profil.
export default function CoursePushSettings({ clubId, userId }: { clubId: string; userId: string }) {
  const { supported, enabled, busy, error, toggle } = useCoursePush(clubId, userId);
  return (
    <PushSwitchRow title="Cours" description="Réponses à vos demandes et nouvelles demandes."
      checked={enabled} disabled={!supported || busy} onToggle={() => void toggle()} error={error} />
  );
}

const PROMPTS = {
  request: {
    title: 'Être prévenu de la réponse ?',
    text: 'Activez les notifications pour savoir dès que le club accepte ou refuse votre demande.',
  },
  manage: {
    title: 'Être prévenu des nouvelles demandes ?',
    text: 'Activez les notifications pour recevoir chaque nouvelle demande sur les cours que vous encadrez.',
  },
};
type PromptReason = keyof typeof PROMPTS;

function laterKey(reason: PromptReason, userId: string) {
  return `course-push-prompt:${reason}:${userId}`;
}
function askedLater(reason: PromptReason, userId: string): boolean {
  try { return localStorage.getItem(laterKey(reason, userId)) === '1'; }
  catch { return false; }
}

// Proposes activation when it is useful. Renders nothing on an unsupported device, when
// notifications are already on, when the system permission was refused, or after « Plus tard ».
// With onClose, the prompt is a sheet and onClose is also called when there is nothing to show.
export function CoursePushPrompt({ clubId, userId, reason, onClose }: {
  clubId: string;
  userId: string;
  reason: PromptReason;
  onClose?: () => void;
}) {
  const { supported, enabled, busy, ready, error, toggle } = useCoursePush(clubId, userId);
  const [hidden, setHidden] = useState(() => askedLater(reason, userId)
    || (typeof Notification !== 'undefined' && Notification.permission === 'denied'));
  const [done, setDone] = useState(false);
  const pointless = !supported || hidden || (ready && enabled && !done);

  useEffect(() => {
    if (pointless) onClose?.();
  }, [pointless, onClose]);

  if (pointless || !ready) return null;
  const close = () => { setHidden(true); onClose?.(); };
  const { title, text } = PROMPTS[reason];
  const content = done ? (
    <div className="booking-info success">
      <p role="status">Notifications activées. Vous pouvez les gérer depuis votre profil.</p>
      {onClose && <button type="button" className="booking-button secondary booking-wide" onClick={close}>Fermer</button>}
    </div>
  ) : (
    <div className="booking-info">
      {!onClose && <strong>{title}</strong>}
      <p>{text}</p>
      <div className="booking-actions">
        <button type="button" className="booking-button secondary" disabled={busy} onClick={() => {
          try { localStorage.setItem(laterKey(reason, userId), '1'); } catch { /* best effort */ }
          close();
        }}>Plus tard</button>
        {/* Called directly from the click: iOS only grants permission inside a user gesture. */}
        <button type="button" className="booking-button primary" disabled={busy} onClick={() => {
          void toggle().then((ok) => { if (ok) setDone(true); });
        }}>{busy ? 'En cours…' : 'Activer'}</button>
      </div>
      {error && <p className="booking-error" role="alert">{error}</p>}
    </div>
  );
  return onClose ? <CourseSheet title={title} onClose={close} busy={busy}>{content}</CourseSheet> : content;
}
