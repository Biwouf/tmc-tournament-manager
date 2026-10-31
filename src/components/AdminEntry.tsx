import { lazy, Suspense, useEffect, useState, type ReactNode } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { supabase } from '../lib/supabase';
import { CLUB_FIELDS, SUPPORT_CLUB_KEY, type Club } from '../contexts/ClubContext';
import { FIRST_STEPS_PATH, inscriptionSlug, magicLinkRedirect, MAGIC_LINK_MESSAGES, pickAdminClub, requestMagicLink } from '../lib/magicLink';
import LoginPage from '../pages/LoginPage';
import AcceptInvitePage from '../pages/AcceptInvitePage';
import PasswordRecoveryPage from '../pages/PasswordRecoveryPage';
import SuperAdminPage from '../pages/SuperAdminPage';

// SaaS S3 — chunk à part : ses polices et sa feuille ne pèsent pas sur le reste du BO.
const SignupTunnelPage = lazy(() => import('../pages/SignupTunnelPage'));

// Ce sélecteur ne donne aucun droit : appartenance relue au chargement, puis garde BO + RLS.
export default function AdminEntry({ children }: { children: (club?: Club, support?: boolean) => ReactNode }) {
  const { pathname } = useLocation();
  // SaaS S3 — le tunnel d'inscription ne dépend d'aucun club ni d'aucune session : il passe
  // avant la résolution du BO central (pas d'activation, pas de liste de clubs, pas de bandeau
  // de compte), quel que soit l'hôte — y compris le serveur de dev.
  if (pathname === '/inscription') return <Suspense fallback={null}><SignupTunnelPage /></Suspense>;
  if (window.location.hostname.toLowerCase().replace(/\.$/, '') !== 'admin.feelike.pro') return children();
  return <CentralAdmin>{children}</CentralAdmin>;
}
function CentralAdmin({ children }: { children: (club?: Club, support?: boolean) => ReactNode }) {
  const { pathname } = useLocation();
  const navigate = useNavigate();
  const [userId, setUserId] = useState<string | null | undefined>(undefined);
  const [email, setEmail] = useState('');
  const [state, setState] = useState<{ userId: string; clubs: Club[]; superAdmin: boolean; awaiting?: Club } | null>(null);
  const [selected, setSelected] = useState<Club | undefined>();
  const [support, setSupport] = useState(false);
  const [error, setError] = useState(false);
  useEffect(() => {
    let active = true;
    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, session) => {
      if (!active) return;
      if (!session) { setState(null); setSelected(undefined); setSupport(false); localStorage.removeItem(SUPPORT_CLUB_KEY); }
      setUserId(session?.user.id ?? null); setEmail(session?.user.email ?? '');
    });
    supabase.auth.getSession().then(({ data, error }) => {
      if (active) { if (error) setError(true); setUserId(data.session?.user.id ?? null); setEmail(data.session?.user.email ?? ''); }
    }).catch(() => { if (active) setError(true); });
    return () => { active = false; subscription.unsubscribe(); };
  }, []);
  useEffect(() => {
    if (!userId) return;
    let active = true;
    async function load() {
      // SaaS S2 : premier passage par le lien magique → les clubs self-serve en attente de
      // ce compte passent actifs (essai de 30 jours) AVANT d'être listés. Idempotent et
      // sans effet sinon ; un échec ne doit pas fermer l'accès aux clubs déjà actifs.
      const activation = await supabase.rpc('club_self_serve_activate');
      if (activation.error) console.error('[AdminEntry] activation self-serve indisponible');
      const [members, profile] = await Promise.all([
        supabase.from('club_members').select('club_id').eq('user_id', userId!),
        supabase.from('profiles').select('is_super_admin').eq('id', userId!).maybeSingle(),
      ]);
      if (members.error || profile.error) throw new Error('Accès indisponible');
      const superAdmin = profile.data?.is_super_admin === true;
      const ids = (members.data || []).map(row => row.club_id);
      const clubs: Club[] = [], pending: Club[] = [];
      if (ids.length) {
        // SaaS S4 : les clubs `pending` du compte (visibles de leurs seuls membres) ne s'ouvrent
        // pas, mais permettent d'expliquer l'activation au lieu d'un sélecteur vide.
        const result = await supabase.from('clubs').select(CLUB_FIELDS).in('id', ids).in('status', ['active', 'pending']).order('name');
        if (result.error) throw result.error;
        for (const club of (result.data || []) as Club[]) (club.status === 'active' ? clubs : pending).push(club);
      }
      let choice: Club | undefined;
      let inSupport = false;
      const override = localStorage.getItem(SUPPORT_CLUB_KEY);
      if (override && superAdmin) {
        const result = await supabase.from('clubs').select(CLUB_FIELDS).eq('id', override).maybeSingle();
        if (result.error) throw result.error;
        choice = (result.data as Club | null) || undefined;
        inSupport = !!choice;
      }
      if (override && !choice) localStorage.removeItem(SUPPORT_CLUB_KEY);
      // SaaS S4 : `?inscription=<slug>` (lien « Gardez votre club ») ouvre ce club et mène aux
      // premiers pas ; sans lui, un compte à un seul club actif y entre sans sélecteur. Lien
      // ouvert sans activation (claim `amr` refusé, ex. connexion par mot de passe) : message.
      const inscription = inscriptionSlug(window.location.href);
      const awaiting = choice ? undefined : pending.find(club => club.slug === inscription) ?? (clubs.length ? undefined : pending[0]);
      const picked = choice || awaiting ? { club: undefined, firstSteps: false } : pickAdminClub(clubs, sessionStorage.getItem(`feelike_admin_club:${userId}`), inscription);
      choice ??= picked.club;
      if (!active) return;
      if (picked.club) sessionStorage.setItem(`feelike_admin_club:${userId}`, picked.club.id);
      setSelected(choice); setSupport(inSupport); setError(false);
      setState({ userId: userId!, clubs, superAdmin, awaiting });
      if (picked.firstSteps) navigate(FIRST_STEPS_PATH, { replace: true });
    }
    load().catch(() => { if (active) setError(true); });
    return () => { active = false; };
    // `navigate` change à chaque navigation : le mettre ici relancerait la lecture des clubs.
    // eslint-disable-next-line react-hooks/exhaustive-deps
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
        <h1 className="text-2xl font-semibold">{state.clubs.length || !state.awaiting ? 'Choisir un club' : 'Activez votre club'}</h1>
        {!!state.clubs.length && <p className="mt-2 text-sm text-muted-foreground">Ouvrez le back-office du club que vous souhaitez gérer.</p>}
        {state.awaiting ? <AwaitingActivation club={state.awaiting} email={email} />
          : !state.clubs.length && <p className="mt-6">Aucun club actif associé à votre compte. Demandez à votre club de vous inviter.</p>}
        <div className="mt-6 grid gap-3">{state.clubs.map(club => <button key={club.id}
          className="rounded-xl border bg-card p-5 text-left font-medium hover:bg-muted"
          onClick={() => { sessionStorage.setItem(`feelike_admin_club:${userId}`, club.id); setSelected(club); navigate('/'); }}>{club.name}</button>)}</div>
      </main>}
  </>;
}
// SaaS S4 — seul le lien magique active un club `pending` : on le renvoie à l'adresse du compte.
function AwaitingActivation({ club, email }: { club: Club; email: string }) {
  const [busy, setBusy] = useState(false);
  const [sent, setSent] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  async function resend() {
    setBusy(true);
    const result = await requestMagicLink(supabase, email, magicLinkRedirect(window.location.origin, club.slug));
    setSent(result === 'sent');
    setNotice(result === 'sent' ? `Un nouveau lien a été envoyé à ${email}.` : MAGIC_LINK_MESSAGES[result]);
    setBusy(false);
  }
  return <div className="mt-6 rounded-xl border bg-card p-5">
    <p className="font-medium">Ouvrez le lien reçu par e-mail pour activer votre club « {club.name} ».</p>
    <p className="mt-2 text-sm text-muted-foreground">Seul ce lien démarre votre essai : une connexion par mot de passe ne suffit pas.</p>
    {notice && <p role="status" className="mt-4 text-sm">{notice}</p>}
    {!sent && <button disabled={busy} onClick={resend}
      className="mt-4 rounded-lg bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground disabled:opacity-60">Recevoir un nouveau lien</button>}
  </div>;
}
