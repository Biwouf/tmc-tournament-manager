import { useEffect, useState, type ReactNode } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { supabase } from '../lib/supabase';
import { SUPPORT_CLUB_KEY, type Club } from '../contexts/ClubContext';
import LoginPage from '../pages/LoginPage';
import AcceptInvitePage from '../pages/AcceptInvitePage';
import PasswordRecoveryPage from '../pages/PasswordRecoveryPage';
import SuperAdminPage from '../pages/SuperAdminPage';

// Ce sélecteur ne donne aucun droit : appartenance relue au chargement, puis garde BO + RLS.
export default function AdminEntry({ children }: { children: (club?: Club, support?: boolean) => ReactNode }) {
  if (window.location.hostname.toLowerCase().replace(/\.$/, '') !== 'admin.feelike.pro') return children();
  return <CentralAdmin>{children}</CentralAdmin>;
}
function CentralAdmin({ children }: { children: (club?: Club, support?: boolean) => ReactNode }) {
  const { pathname } = useLocation();
  const navigate = useNavigate();
  const [userId, setUserId] = useState<string | null | undefined>(undefined);
  const [state, setState] = useState<{ userId: string; clubs: Club[]; superAdmin: boolean } | null>(null);
  const [selected, setSelected] = useState<Club | undefined>();
  const [support, setSupport] = useState(false);
  const [error, setError] = useState(false);
  useEffect(() => {
    let active = true;
    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, session) => {
      if (!active) return;
      if (!session) { setState(null); setSelected(undefined); setSupport(false); localStorage.removeItem(SUPPORT_CLUB_KEY); }
      setUserId(session?.user.id ?? null);
    });
    supabase.auth.getSession().then(({ data, error }) => {
      if (active) { if (error) setError(true); setUserId(data.session?.user.id ?? null); }
    }).catch(() => { if (active) setError(true); });
    return () => { active = false; subscription.unsubscribe(); };
  }, []);
  useEffect(() => {
    if (!userId) return;
    let active = true;
    async function load() {
      const [members, profile] = await Promise.all([
        supabase.from('club_members').select('club_id').eq('user_id', userId!),
        supabase.from('profiles').select('is_super_admin').eq('id', userId!).maybeSingle(),
      ]);
      if (members.error || profile.error) throw new Error('Accès indisponible');
      const superAdmin = profile.data?.is_super_admin === true;
      const ids = (members.data || []).map(row => row.club_id);
      let clubs: Club[] = [];
      if (ids.length) {
        const result = await supabase.from('clubs').select('id, slug, name, sport, status').in('id', ids).eq('status', 'active').order('name');
        if (result.error) throw result.error;
        clubs = result.data || [];
      }
      let choice: Club | undefined;
      let inSupport = false;
      const override = localStorage.getItem(SUPPORT_CLUB_KEY);
      if (override && superAdmin) {
        const result = await supabase.from('clubs').select('id, slug, name, sport, status').eq('id', override).maybeSingle();
        if (result.error) throw result.error;
        choice = result.data || undefined;
        inSupport = !!choice;
      }
      if (override && !choice) localStorage.removeItem(SUPPORT_CLUB_KEY);
      const saved = sessionStorage.getItem(`feelike_admin_club:${userId}`);
      choice ??= clubs.find(club => club.id === saved);
      if (!active) return;
      setSelected(choice); setSupport(inSupport); setError(false);
      setState({ userId: userId!, clubs, superAdmin });
    }
    load().catch(() => { if (active) setError(true); });
    return () => { active = false; };
  }, [userId]);
  // Ces parcours restent accessibles sans club, y compris pendant l'activation du compte.
  if (pathname === '/accept-invite') return <AcceptInvitePage />;
  if (pathname === '/forgot-password') return <PasswordRecoveryPage key="forgot" />;
  if (pathname === '/reset-password') return <PasswordRecoveryPage key="reset" reset />;
  if (error) return <div className="p-8 text-center"><h1>Connexion momentanément indisponible</h1><button onClick={() => window.location.reload()}>Réessayer</button></div>;
  if (userId === null) return <LoginPage />;
  if (!userId || state?.userId !== userId) return <p role="status" className="p-8 text-center">Chargement de vos clubs…</p>;
  const change = () => {
    sessionStorage.removeItem(`feelike_admin_club:${userId}`);
    localStorage.removeItem(SUPPORT_CLUB_KEY);
    setSelected(undefined); setSupport(false); navigate('/');
  };
  return <>
    <div className="flex flex-wrap items-center justify-between gap-3 border-b bg-card px-4 py-3 text-sm">
      <span className="font-semibold">{selected?.name || 'Feelike · Administration'}</span>
      <div className="flex gap-4">
        {selected && <button onClick={change}>Changer de club</button>}
        {state.superAdmin && <button onClick={() => navigate('/super-admin')}>Console plateforme</button>}
        <button onClick={() => { change(); void supabase.auth.signOut(); }}>Se déconnecter</button>
      </div>
    </div>
    {pathname === '/super-admin' && state.superAdmin ? <SuperAdminPage /> : selected
      ? <div key={`${userId}:${selected.id}`}>{children(selected, support)}</div>
      : <main className="mx-auto max-w-xl p-6 sm:p-10">
        <h1 className="text-2xl font-semibold">Choisir un club</h1>
        <p className="mt-2 text-sm text-muted-foreground">Ouvrez le back-office du club que vous souhaitez gérer.</p>
        {!state.clubs.length && <p className="mt-6">Aucun club actif associé à votre compte. Demandez à votre club de vous inviter.</p>}
        <div className="mt-6 grid gap-3">{state.clubs.map(club => <button key={club.id}
          className="rounded-xl border bg-card p-5 text-left font-medium hover:bg-muted"
          onClick={() => { sessionStorage.setItem(`feelike_admin_club:${userId}`, club.id); setSelected(club); navigate('/'); }}>{club.name}</button>)}</div>
      </main>}
  </>;
}
