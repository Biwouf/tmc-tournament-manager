import { useEffect, useState } from 'react';
import { coursePushSupported, disableCoursePush, enableCoursePush, syncCoursePush } from '../../lib/coursePush';
import CourseSheet from './CourseSheet';

function useCoursePush(clubId: string, userId: string) {
  const [enabled, setEnabled] = useState(false);
  const [busy, setBusy] = useState(true);
  const [ready, setReady] = useState(false);
  const [error, setError] = useState('');
  const supported = coursePushSupported();

  useEffect(() => {
    let active = true;
    setBusy(supported);
    setReady(false);
    setEnabled(false);
    setError('');
    if (supported) {
      void syncCoursePush(clubId, userId).then((value) => {
        if (active) setEnabled(value);
      }).catch(() => {
        if (active) setError('Impossible de synchroniser les notifications. Réessayez.');
      }).finally(() => { if (active) { setBusy(false); setReady(true); } });
    }
    return () => { active = false; };
  }, [clubId, userId, supported]);

  async function toggle(): Promise<boolean> {
    setBusy(true);
    setError('');
    try {
      if (enabled) await disableCoursePush(clubId);
      else await enableCoursePush(clubId, userId);
      setEnabled(!enabled);
      return true;
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Impossible de modifier les notifications.');
      return false;
    } finally {
      setBusy(false);
    }
  }

  return { supported, enabled, busy, ready, error, toggle };
}

export default function CoursePushSettings({ clubId, userId }: { clubId: string; userId: string }) {
  const { supported, enabled, busy, error, toggle } = useCoursePush(clubId, userId);
  return (
    <div className="booking-info">
      <strong>Cours</strong>
      <p>Recevez les réponses à vos demandes et, si vous encadrez un cours, les nouvelles demandes.</p>
      {supported ? (
        <button type="button" className="booking-button secondary" disabled={busy}
          onClick={() => void toggle()}>
          {busy ? 'En cours…' : enabled ? 'Désactiver les notifications' : 'Activer les notifications'}
        </button>
      ) : (
        <p>Notifications indisponibles ici. Sur iPhone ou iPad, ajoutez l’application à l’écran d’accueil.</p>
      )}
      {error && <p className="booking-error" role="alert">{error}</p>}
    </div>
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
