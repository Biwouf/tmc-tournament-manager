import { useLayoutEffect, type RefObject } from 'react';
import { useLocation, useNavigationType } from 'react-router-dom';

// Position de défilement par entrée d'historique (et, en repli, par chemin + query).
// La PWA défile dans ses propres conteneurs (`<main class="pwa-content">`, le conteneur du
// pull-to-refresh) : la restauration native du navigateur, qui ne vise que la fenêtre, ne s'y
// applique pas. Sans ce module, un Retour depuis une fiche remontait la liste en haut.
const positions = new Map<string, number>();
const RESTORE_MS = 2000; // le temps que la liste en cache (ou rechargée) se rende.

/** State à passer à un `navigate` qui revient vers une page déjà vue sans « Retour » natif. */
export const RESTORE_SCROLL = { restoreScroll: true } as const;

/**
 * Mémorise le défilement de `ref` (conteneur nommé `scope`) pour l'entrée d'historique courante et le restaure quand on
 * y revient (Retour du navigateur ou de l'app). Une nouvelle navigation repart en haut.
 */
export function useScrollMemory(ref: RefObject<HTMLElement | null>, scope: string) {
  const location = useLocation();
  const navigationType = useNavigationType();

  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    // Une clé par conteneur : le <main> et la liste d'une même page défilent chacun de leur côté.
    const entryKey = `${scope}:${location.key}`;
    const pathKey = `${scope}:path:${location.pathname}${location.search}`;
    const comingBack = navigationType === 'POP'
      || !!(location.state as { restoreScroll?: boolean } | null)?.restoreScroll;
    const target = comingBack ? positions.get(entryKey) ?? positions.get(pathKey) : undefined;

    let timer: ReturnType<typeof setTimeout> | undefined;
    const deadline = Date.now() + RESTORE_MS;
    const stop = () => clearTimeout(timer);
    if (target == null) {
      el.scrollTop = 0;
    } else {
      // La liste peut être plus courte au premier rendu : on réessaie jusqu'à pouvoir y aller.
      const apply = () => {
        el.scrollTop = target;
        if (Math.abs(el.scrollTop - target) > 2 && Date.now() < deadline) timer = setTimeout(apply, 16);
      };
      apply();
    }
    // Le geste de l'utilisateur l'emporte sur une restauration encore en cours.
    el.addEventListener('touchstart', stop, { passive: true });
    el.addEventListener('wheel', stop, { passive: true });
    const save = () => {
      positions.set(entryKey, el.scrollTop);
      positions.set(pathKey, el.scrollTop);
    };
    el.addEventListener('scroll', save, { passive: true });
    // Filet : on fige aussi la position au clic qui déclenche la navigation (capture, donc avant
    // le changement de page), sans dépendre du dernier événement `scroll`.
    document.addEventListener('click', save, true);
    return () => {
      stop();
      el.removeEventListener('touchstart', stop);
      el.removeEventListener('wheel', stop);
      el.removeEventListener('scroll', save);
      document.removeEventListener('click', save, true);
    };
    // Une fois par entrée d'historique.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [location.key]);
}
