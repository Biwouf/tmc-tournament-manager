import { createContext, useContext, useEffect, useRef, useState, type ReactNode } from 'react';
import type { HeaderAction } from './headerConfig';

type Ctx = {
  action: HeaderAction | null;
  setAction: (a: HeaderAction | null) => void;
};

const HeaderActionContext = createContext<Ctx | null>(null);

export function HeaderActionProvider({ children }: { children: ReactNode }) {
  const [action, setAction] = useState<HeaderAction | null>(null);
  return (
    <HeaderActionContext.Provider value={{ action, setAction }}>
      {children}
    </HeaderActionContext.Provider>
  );
}

export function useHeaderActionState(): HeaderAction | null {
  const ctx = useContext(HeaderActionContext);
  if (!ctx) throw new Error('useHeaderActionState must be used within HeaderActionProvider');
  return ctx.action;
}

/**
 * Pose une action dans le header tant que le composant est monté.
 * `onClick` est lu via ref pour toujours pointer sur le dernier closure :
 * pas besoin de mémoïsation côté appelant.
 */
export function useHeaderAction(action: HeaderAction | null) {
  const ctx = useContext(HeaderActionContext);
  if (!ctx) throw new Error('useHeaderAction must be used within HeaderActionProvider');
  const { setAction } = ctx;

  const onClickRef = useRef<(() => void) | null>(null);
  onClickRef.current = action?.onClick ?? null;

  const kind = action?.kind ?? null;
  const label = action?.label ?? null;
  const accent = action && action.kind === 'text' ? action.accent ?? false : false;

  useEffect(() => {
    if (!kind || label === null) {
      setAction(null);
      return;
    }
    const onClick = () => onClickRef.current?.();
    const a: HeaderAction =
      kind === 'icon'
        ? { kind: 'icon', label, onClick }
        : { kind: 'text', label, onClick, accent };
    setAction(a);
  }, [setAction, kind, label, accent]);

  useEffect(() => {
    return () => setAction(null);
  }, [setAction]);
}
