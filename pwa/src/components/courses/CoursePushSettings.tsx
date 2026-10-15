import { useEffect, useState } from 'react';
import { coursePushSupported, disableCoursePush, enableCoursePush, syncCoursePush } from '../../lib/coursePush';

export default function CoursePushSettings({ clubId, userId }: { clubId: string; userId: string }) {
  const [enabled, setEnabled] = useState(false);
  const [busy, setBusy] = useState(true);
  const [error, setError] = useState('');
  const supported = coursePushSupported();

  useEffect(() => {
    let active = true;
    setBusy(supported);
    setEnabled(false);
    setError('');
    if (supported) {
      void syncCoursePush(clubId, userId).then((value) => {
        if (active) setEnabled(value);
      }).catch(() => {
        if (active) setError('Impossible de synchroniser les notifications. Réessayez.');
      }).finally(() => { if (active) setBusy(false); });
    }
    return () => { active = false; };
  }, [clubId, userId, supported]);

  async function toggle() {
    setBusy(true);
    setError('');
    try {
      if (enabled) await disableCoursePush(clubId);
      else await enableCoursePush(clubId, userId);
      setEnabled(!enabled);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Impossible de modifier les notifications.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="booking-info">
      <strong>Notifications de cours</strong>
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
