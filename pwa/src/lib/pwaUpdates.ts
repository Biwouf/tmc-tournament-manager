/** Keep updates waiting until this window explicitly agrees to reload. */
export function startPwaUpdates(onAvailable: () => void) {
  const sw = navigator.serviceWorker;
  let disposed = false;
  let registration: ServiceWorkerRegistration | undefined;
  let checking = false;
  let lastCheck = -Infinity;
  let controller = sw.controller;
  let changed = false;
  let reloadRequested = false;
  let reloading = false;
  const reloadOnce = () => {
    if (reloading || disposed) return;
    reloading = true;
    reloadRequested = false;
    window.clearTimeout(activationTimer);
    window.location.reload();
  };
  let activationTimer: number | undefined;
  let rejectActivation: ((error: Error) => void) | undefined;
  const cleanups: Array<() => void> = [];

  const notifyWaiting = () => {
    if (!disposed && registration?.waiting && sw.controller) onAvailable();
  };
  const watchInstalling = () => {
    const worker = registration?.installing;
    if (!worker) return;
    const onState = () => {
      if (worker.state === 'installed') notifyWaiting();
    };
    worker.addEventListener('statechange', onState);
    cleanups.push(() => worker.removeEventListener('statechange', onState));
  };
  const onControllerChange = () => {
    const previous = controller;
    controller = sw.controller;
    // The very first installation is not an application update.
    if (!previous || !controller || previous === controller) return;
    changed = true;
    if (reloadRequested) {
      reloadOnce();
    } else onAvailable(); // Another tab activated it: preserve this tab's work.
  };
  sw.addEventListener('controllerchange', onControllerChange);

  const check = async () => {
    if (disposed || checking || document.visibilityState !== 'visible' || !navigator.onLine) return;
    notifyWaiting();
    if (changed) onAvailable();
    if (Date.now() - lastCheck < 30_000) return;
    checking = true;
    lastCheck = Date.now();
    try {
      if (!registration) {
        const result = await sw.register('/sw.js', { scope: '/', updateViaCache: 'none' });
        if (disposed) return;
        registration = result;
        registration.addEventListener('updatefound', watchInstalling);
        watchInstalling();
        notifyWaiting();
      }
      await registration.update();
    } catch {
      // Offline/transient failures must not interrupt the app. Retry on the next check.
    } finally {
      checking = false;
    }
  };
  const onResume = () => { void check(); };
  document.addEventListener('visibilitychange', onResume);
  window.addEventListener('focus', onResume);
  window.addEventListener('online', onResume);
  const interval = window.setInterval(onResume, 5 * 60_000);
  void check();

  return {
    async applyUpdate(): Promise<void> {
      if (reloading || disposed) return;
      if (changed) {
        reloadOnce();
        return;
      }
      const waiting = registration?.waiting;
      if (!waiting) throw new Error('La mise à jour n’est pas encore prête. Réessayez dans un instant.');
      reloadRequested = true;
      return new Promise<void>((_resolve, reject) => {
        rejectActivation = reject;
        activationTimer = window.setTimeout(() => {
          reloadRequested = false;
          reject(new Error('La mise à jour prend plus de temps que prévu. Réessayez.'));
        }, 15_000);
        waiting.postMessage({ type: 'SKIP_WAITING' });
      });
    },
    dispose() {
      disposed = true;
      window.clearInterval(interval);
      window.clearTimeout(activationTimer);
      rejectActivation?.(new Error('Update listener disposed'));
      registration?.removeEventListener('updatefound', watchInstalling);
      sw.removeEventListener('controllerchange', onControllerChange);
      document.removeEventListener('visibilitychange', onResume);
      window.removeEventListener('focus', onResume);
      window.removeEventListener('online', onResume);
      cleanups.forEach(cleanup => cleanup());
    },
  };
}
