import { createContext, useContext, type ReactNode } from 'react';
import type { Site } from '../lib/site';

const SiteContext = createContext<Site | null>(null);

/** Snapshot propre à cette requête, partagé à l'identique avec l'hydratation. */
export function SiteProvider({ children, site }: { children: ReactNode; site: Site }) {
  return <SiteContext.Provider value={site}>{children}</SiteContext.Provider>;
}
// eslint-disable-next-line react-refresh/only-export-components -- Hook associé au contexte du provider.
export function useSite(): Site {
  const value = useContext(SiteContext);
  if (!value) throw new Error('useSite() doit être appelé sous <SiteProvider>');
  return value;
}
