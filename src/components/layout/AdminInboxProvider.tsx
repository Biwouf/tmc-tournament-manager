import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { useLocation } from 'react-router-dom';
import { supabase } from '../../lib/supabase';
import { AdminInboxContext, type AdminInbox } from '../../lib/adminInbox';
import { onInboxChanged } from '../../lib/inboxSignal';
import { useClub } from '../../contexts/ClubContext';
import { useClubRole } from '../../contexts/ClubRoleContext';

// PR-BO2 — une seule lecture d'`admin_inbox` pour l'accueil et la barre latérale. Relue au retour
// du focus, à l'arrivée sur l'accueil et après une action (`notifyInboxChanged`). Rien pour un
// non-admin : la base répondrait 42501.
export default function AdminInboxProvider({ children }: { children: ReactNode }) {
  const { clubId } = useClub();
  const { role, isSuperAdmin } = useClubRole();
  const onHome = useLocation().pathname === '/';
  const enabled = isSuperAdmin || role === 'admin';
  const [state, setState] = useState<{ inbox: AdminInbox | null; error: boolean }>({ inbox: null, error: false });
  const latest = useRef(0);

  const refresh = useCallback(() => {
    if (!clubId || !enabled) return;
    // La dernière demande gagne : une lecture partie avant une action ne doit pas écraser la suivante.
    const request = ++latest.current;
    supabase.rpc('admin_inbox', { p_club: clubId }).then(({ data, error }) => {
      if (request !== latest.current) return;
      if (error) console.error('[admin_inbox]', error);
      // Échec : les derniers comptes connus restent affichés.
      setState((previous) => (error ? { inbox: previous.inbox, error: true } : { inbox: data as AdminInbox, error: false }));
    });
  }, [clubId, enabled]);

  useEffect(() => refresh(), [refresh, onHome]);

  useEffect(() => {
    const stop = onInboxChanged(refresh);
    window.addEventListener('focus', refresh);
    return () => {
      stop();
      window.removeEventListener('focus', refresh);
    };
  }, [refresh]);

  const value = useMemo(() => ({ ...state, refresh }), [state, refresh]);
  return <AdminInboxContext.Provider value={value}>{children}</AdminInboxContext.Provider>;
}
