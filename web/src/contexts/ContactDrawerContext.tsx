// Le drawer de contact est ouvert depuis partout : le CTA du header, le menu mobile, les deux
// boutons du hero, les bannières CTA de l'accueil et des tarifs, le bouton flottant. Un
// contexte minuscule évite de faire descendre un `onContact` à travers les cinq pages.
import { createContext, useCallback, useContext, useMemo, useState, type ReactNode } from 'react';

type ContactDrawerValue = { open: boolean; openDrawer: () => void; closeDrawer: () => void };

const ContactDrawerContext = createContext<ContactDrawerValue | null>(null);

export function ContactDrawerProvider({ children }: { children: ReactNode }) {
  const [open, setOpen] = useState(false);
  const openDrawer = useCallback(() => setOpen(true), []);
  const closeDrawer = useCallback(() => setOpen(false), []);
  const value = useMemo(() => ({ open, openDrawer, closeDrawer }), [open, openDrawer, closeDrawer]);
  return <ContactDrawerContext.Provider value={value}>{children}</ContactDrawerContext.Provider>;
}

export function useContactDrawer(): ContactDrawerValue {
  const value = useContext(ContactDrawerContext);
  if (!value) throw new Error('useContactDrawer() doit être appelé sous <ContactDrawerProvider>');
  return value;
}
