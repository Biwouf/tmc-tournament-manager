// Copie de src/components/AnimatedScoreCell.tsx (BO). À synchroniser manuellement.

import { useLayoutEffect, useRef, useState } from 'react';

interface Props {
  value: number;
  tb?: number | null;
  animate?: boolean;
  durationMs?: number;
  className?: string;
  tbClassName?: string;
}

interface FlipState {
  prev: number;
  cur: number;
  runId: number;
}

function FlipV({ prev, next, durationMs }: { prev: number; next: number; durationMs: number }) {
  const [phase, setPhase] = useState<0 | 1>(0);
  useLayoutEffect(() => {
    const id = window.setTimeout(() => setPhase(1), durationMs / 2);
    return () => window.clearTimeout(id);
  }, [durationMs]);
  const half = durationMs / 2;
  return (
    <span className="absolute inset-0">
      <span
        className="absolute inset-0 flex items-center justify-center"
        style={{
          transformOrigin: 'center center',
          transform: phase === 0 ? 'scaleY(1)' : 'scaleY(0)',
          transition: `transform ${half}ms cubic-bezier(.5,0,1,.5)`,
        }}
      >
        {prev}
      </span>
      <span
        className="absolute inset-0 flex items-center justify-center"
        style={{
          transformOrigin: 'center center',
          transform: phase === 1 ? 'scaleY(1)' : 'scaleY(0)',
          transition: `transform ${half}ms cubic-bezier(0,.5,.5,1)`,
        }}
      >
        {next}
      </span>
    </span>
  );
}

export default function AnimatedScoreCell({
  value,
  tb = null,
  animate = true,
  durationMs = 400,
  className = '',
  tbClassName = '',
}: Props) {
  const [flipState, setFlipState] = useState<FlipState | null>(null);
  const [haloKey, setHaloKey] = useState(0);
  const runIdRef = useRef(0);
  const prevValueRef = useRef<number | undefined>(undefined);

  useLayoutEffect(() => {
    const prev = prevValueRef.current;
    prevValueRef.current = value;
    if (!animate) return;
    if (prev === undefined) return;
    if (prev === value) return;

    runIdRef.current += 1;
    const runId = runIdRef.current;
    setFlipState({ prev, cur: value, runId });
    setHaloKey((k) => k + 1);

    const t = window.setTimeout(() => {
      setFlipState((s) => (s && s.runId === runId ? null : s));
    }, durationMs);
    return () => window.clearTimeout(t);
  }, [value, animate, durationMs]);

  return (
    <span className={`relative inline-flex items-center justify-center ${className}`}>
      {flipState ? (
        <FlipV
          key={flipState.runId}
          prev={flipState.prev}
          next={flipState.cur}
          durationMs={durationMs}
        />
      ) : (
        <span>{value}</span>
      )}
      {tb !== null && tb !== undefined && (
        <sup className={tbClassName}>{tb}</sup>
      )}
      {haloKey > 0 && (
        <span
          key={haloKey}
          aria-hidden
          className="absolute inset-0 rounded-[inherit] pointer-events-none animate-score-cell-ring"
        />
      )}
    </span>
  );
}
