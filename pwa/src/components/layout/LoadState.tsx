import type { ReactNode } from 'react';

// États de chargement et d'erreur partagés (brief UX PWA, PR3, maquettes `etat-erreur` et
// `etat-skeleton`, 15/11/2026). Jamais d'écran blanc ni de liste vide trompeuse : un squelette
// calqué sur la page, ou un message en français avec « Réessayer ».

/** Échec du premier chargement : rien à montrer, on propose de réessayer. */
export function LoadError({ title, message = 'Vérifiez votre connexion, puis réessayez.', onRetry, retrying = false }: {
  title: string;
  message?: string;
  onRetry?: () => void;
  retrying?: boolean;
}) {
  return (
    <div className="load-error" role="alert">
      <div className="icon" aria-hidden="true">
        <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round"><circle cx="12" cy="12" r="9" /><path d="M12 8v5M12 16h.01" /></svg>
      </div>
      <h2>{title}</h2>
      <p>{message}</p>
      {onRetry && <button type="button" onClick={onRetry} disabled={retrying}>{retrying ? 'Chargement…' : 'Réessayer'}</button>}
    </div>
  );
}

/** Données déjà affichées mais dont l'actualisation échoue : bandeau discret. */
export function StaleNotice({ onRetry, children = 'Actualisation impossible, les informations ne sont peut-être plus à jour.' }: {
  onRetry: () => void;
  children?: ReactNode;
}) {
  return (
    <p className="stale-notice" role="status">
      {children}{' '}
      <button type="button" onClick={onRetry}>Réessayer</button>
    </p>
  );
}

/** Cartes fantômes à la hauteur des vraies, le temps du premier chargement. */
export function CardSkeleton({ count = 3, height = 112, label = 'Chargement…' }: { count?: number; height?: number; label?: string }) {
  return (
    <div className="flex flex-col gap-4" role="status" aria-label={label}>
      {Array.from({ length: count }, (_, i) => <div key={i} className="sk rounded-xl" style={{ height }} />)}
    </div>
  );
}

/** Page entière en attente (session, club) : fond de l'app et indicateur, jamais un blanc. */
export function AppLoading() {
  return (
    <div className="flex min-h-[60vh] flex-1 items-center justify-center" role="status" aria-label="Chargement…">
      <span className="h-7 w-7 animate-spin rounded-full border-[3px] border-primary/25 border-t-primary" aria-hidden="true" />
    </div>
  );
}
