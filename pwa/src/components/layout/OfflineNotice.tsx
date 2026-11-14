import { useEffect, useState } from 'react';

/**
 * Bandeau hors ligne (PR5 du brief UX, 14/11/2026). L'app installée s'ouvre sans réseau
 * (coquille en cache, `navigateFallback`) mais les données ne se rafraîchissent plus : on le
 * dit, plutôt que de laisser croire à une liste vide ou figée.
 */
export default function OfflineNotice() {
  const [offline, setOffline] = useState(() => typeof navigator !== 'undefined' && !navigator.onLine);

  useEffect(() => {
    const update = () => setOffline(!navigator.onLine);
    window.addEventListener('online', update);
    window.addEventListener('offline', update);
    return () => {
      window.removeEventListener('online', update);
      window.removeEventListener('offline', update);
    };
  }, []);

  return (
    <div role="status" aria-live="polite">
      {offline && (
        <p className="sticky top-0 z-30 border-b border-border bg-card px-4 py-2.5 text-[13px] font-semibold text-foreground">
          Vous êtes hors ligne.{' '}
          <span className="font-medium text-muted-foreground">Les informations affichées peuvent ne pas être à jour.</span>
        </p>
      )}
    </div>
  );
}
