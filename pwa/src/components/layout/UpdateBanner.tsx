import { useEffect, useRef, useState } from 'react';
import { startPwaUpdates } from '../../lib/pwaUpdates';

export default function UpdateBanner() {
  const updater = useRef<ReturnType<typeof startPwaUpdates> | null>(null);
  const [available, setAvailable] = useState(false);
  const [updating, setUpdating] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    if (!import.meta.env.PROD || !('serviceWorker' in navigator)) return;
    const instance = startPwaUpdates(() => setAvailable(true));
    updater.current = instance;
    return () => {
      updater.current = null;
      instance.dispose();
    };
  }, []);

  if (!available) return null;

  const apply = async () => {
    const instance = updater.current;
    if (!instance || updating) return;
    setUpdating(true);
    setError('');
    try {
      await instance.applyUpdate();
    } catch (cause) {
      if (updater.current !== instance) return;
      setUpdating(false);
      setError(cause instanceof Error ? cause.message : 'Impossible d’actualiser. Réessayez.');
    }
  };

  return (
    <aside aria-label="Mise à jour de l’application" className="sticky top-0 z-30 border-b border-border bg-card px-4 py-3 shadow-sm">
      <div className="mx-auto flex max-w-3xl flex-wrap items-center justify-between gap-3">
        <div className="min-w-0 flex-1 basis-44" role="status">
          <p className="text-sm font-bold">Nouvelle version disponible</p>
          <p className="mt-0.5 text-xs text-muted-foreground">Cliquez sur le bouton &quot;Actualiser&quot;</p>
        </div>
        <button type="button" onClick={() => void apply()} disabled={updating}
          className="min-h-11 rounded-xl bg-primary px-4 text-sm font-bold text-primary-foreground focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring disabled:opacity-60">
          {updating ? 'Actualisation…' : 'Actualiser'}
        </button>
        {error && <p role="alert" className="w-full text-sm text-foreground">{error}</p>}
      </div>
    </aside>
  );
}
