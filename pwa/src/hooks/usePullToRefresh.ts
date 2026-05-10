import { useEffect, useRef, useState } from 'react';

const THRESHOLD = 80;

interface Options {
  onRefresh: () => Promise<void>;
  isRefreshing: boolean;
  containerRef: React.RefObject<HTMLElement | null>;
}

export function usePullToRefresh({ onRefresh, isRefreshing, containerRef }: Options): {
  pullProgress: number;
  isDragging: boolean;
} {
  const [pullProgress, setPullProgress] = useState(0);
  const [isDragging, setIsDragging] = useState(false);

  const onRefreshRef = useRef(onRefresh);
  const isRefreshingRef = useRef(isRefreshing);

  useEffect(() => {
    onRefreshRef.current = onRefresh;
  }, [onRefresh]);

  useEffect(() => {
    isRefreshingRef.current = isRefreshing;
  }, [isRefreshing]);

  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;

    let startY: number | null = null;
    let currentDelta = 0;
    let activePointerId: number | null = null;

    const onPointerDown = (e: PointerEvent) => {
      if (e.pointerType !== 'touch') return;
      if (isRefreshingRef.current) return;
      if (el.scrollTop > 0) return;
      startY = e.clientY;
      currentDelta = 0;
      activePointerId = e.pointerId;
      setIsDragging(true);
    };

    const onPointerMove = (e: PointerEvent) => {
      if (startY === null || e.pointerId !== activePointerId) return;
      const delta = e.clientY - startY;
      currentDelta = delta;
      if (delta <= 0) {
        setPullProgress(0);
        return;
      }
      setPullProgress(Math.min(delta / THRESHOLD, 1));
    };

    const finishGesture = (e: PointerEvent) => {
      if (startY === null || e.pointerId !== activePointerId) return;
      const delta = currentDelta;
      startY = null;
      currentDelta = 0;
      activePointerId = null;
      setIsDragging(false);
      if (delta >= THRESHOLD) {
        setPullProgress(1);
        onRefreshRef.current().finally(() => {
          setPullProgress(0);
        });
      } else {
        setPullProgress(0);
      }
    };

    // Bloque le scroll natif (et le pointercancel qu'il déclenche) tant
    // qu'on est en pull actif au top du conteneur.
    const onTouchMove = (e: TouchEvent) => {
      if (startY === null) return;
      const touch = e.touches[0];
      if (!touch) return;
      const delta = touch.clientY - startY;
      if (delta > 0) {
        e.preventDefault();
      }
    };

    // pointerdown sur le conteneur (porte d'entrée du geste)
    el.addEventListener('pointerdown', onPointerDown);
    // touchmove non-passif pour pouvoir preventDefault et empêcher le
    // scroll engine du navigateur d'annuler la séquence pointer.
    el.addEventListener('touchmove', onTouchMove, { passive: false });
    // move / up / cancel au niveau document : insensible à un éventuel
    // arrêt de propagation, drag natif, pointer capture implicite, etc.
    document.addEventListener('pointermove', onPointerMove);
    document.addEventListener('pointerup', finishGesture);
    document.addEventListener('pointercancel', finishGesture);

    return () => {
      el.removeEventListener('pointerdown', onPointerDown);
      el.removeEventListener('touchmove', onTouchMove);
      document.removeEventListener('pointermove', onPointerMove);
      document.removeEventListener('pointerup', finishGesture);
      document.removeEventListener('pointercancel', finishGesture);
    };
  }, [containerRef]);

  return { pullProgress, isDragging };
}
