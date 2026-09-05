import { useState, useEffect, type ReactElement } from 'react';
import { Routes, Route, Navigate, useParams, useLocation } from 'react-router-dom';
import type { User } from '@supabase/supabase-js';
import { supabase } from './lib/supabase';
import AppHomePage from './pages/AppHomePage';
import HomePage from './pages/HomePage';
import TournamentPage from './pages/TournamentPage';
import LoginPage from './pages/LoginPage';
import ProgrammationImagePage from './pages/ProgrammationImagePage';
import EventsPage from './pages/EventsPage';
import EventForm from './components/EventForm';
import LiveScorePage from './pages/LiveScorePage';
import LiveMatchPage from './pages/LiveMatchPage';
import LiveMatchForm from './components/LiveMatchForm';
import ActusPage from './pages/ActusPage';
import ActuForm from './components/ActuForm';
import MembersPage from './pages/MembersPage';
import SiteConfigPage from './pages/SiteConfigPage';
import AcceptInvitePage from './pages/AcceptInvitePage';
import SuperAdminPage from './pages/SuperAdminPage';
import TeamMatchesPage from './pages/TeamMatchesPage';
import TeamMatchesAdminPage from './pages/TeamMatchesAdminPage';
import TeamEquipePage from './pages/TeamEquipePage';
import TeamRencontrePage from './pages/TeamRencontrePage';
import TeamRencontreForm from './components/teamMatches/TeamRencontreForm';
import { ClubProvider, useClub, exitSupportClub } from './contexts/ClubContext';
import { ClubRoleProvider, useClubRole } from './contexts/ClubRoleContext';
import { useClubConfig } from './hooks/useClubConfig';
import { useClubTheme } from './hooks/useClubTheme';

function RedirectTournament() {
  const { id } = useParams();
  return <Navigate to={`/tmc-planning/${id}`} replace />;
}

// PR4 — routes atteignables sans être membre du club courant : la session est
// valide, c'est le club qui ne l'est pas (cf. NoClubAccess).
const UNGUARDED_PATHS = ['/login', '/accept-invite'];

// PR4 — un compte authentifié mais non membre du club résolu par le hostname
// n'obtient plus un BO monté aux listes vides (écritures rejetées par la RLS sans
// explication) : on refuse l'accès, avec de quoi se déconnecter.
function NoClubAccess({ clubName }: { clubName: string | null }) {
  return (
    <div className="flex min-h-screen items-center justify-center bg-background px-4">
      <div className="w-full max-w-md rounded-2xl border bg-card/90 p-8 text-center shadow-sm">
        <h1 className="text-xl font-semibold tracking-tight text-card-foreground">
          Accès refusé
        </h1>
        <p className="mt-3 text-sm text-muted-foreground">
          Votre compte n’a pas accès au back-office
          {clubName ? ` de ${clubName}` : ''}. Demandez à un administrateur du club de
          vous inviter, ou connectez-vous avec un autre compte.
        </p>
        <button
          onClick={() => supabase.auth.signOut()}
          className="mt-6 w-full rounded-lg border border-border bg-card px-4 py-2 text-sm font-medium text-muted-foreground transition hover:bg-muted"
        >
          Se déconnecter
        </button>
      </div>
    </div>
  );
}

// PR5 §7 — le club affiché vient de l'override de support, pas du hostname. Bandeau
// permanent : sans lui, on croit être dans son club et on y publie une actu.
function SupportBanner({ clubName, suspended }: { clubName: string; suspended: boolean }) {
  return (
    <div className="sticky top-0 z-50 flex flex-wrap items-center justify-between gap-3 border-b border-amber-500/40 bg-amber-500/15 px-4 py-2 text-sm text-amber-900">
      <span>
        <span className="font-semibold">Support</span> — vous consultez{' '}
        <span className="font-medium">{clubName}</span>
        {suspended ? ' (suspendu)' : ''}.
      </span>
      <button
        onClick={exitSupportClub}
        className="rounded-lg border border-amber-600/40 bg-amber-50/60 px-3 py-1 text-xs font-semibold text-amber-900 transition hover:bg-amber-100"
      >
        Quitter
      </button>
    </div>
  );
}

function AppRoutes() {
  const [user, setUser] = useState<User | null | undefined>(undefined);
  const { loading: clubLoading } = useClub();

  useEffect(() => {
    supabase.auth.getSession().then(({ data: { session } }) => {
      setUser(session?.user ?? null);
    });

    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, session) => {
      setUser(session?.user ?? null);
    });

    return () => subscription.unsubscribe();
  }, []);

  if (user === undefined || clubLoading) return null;

  // Le provider de rôle est monté ici : après résolution de l'auth ET du club,
  // une seule fois pour toute l'app (MULTI_TENANT.md §4).
  return (
    <ClubRoleProvider>
      <GuardedRoutes user={user} />
    </ClubRoleProvider>
  );
}

function GuardedRoutes({ user }: { user: User | null }) {
  const { club, isSupport } = useClub();
  const { role, isMember, isSuperAdmin, loading: roleLoading } = useClubRole();
  const { pathname } = useLocation();

  if (user && roleLoading) return null;

  if (user && !isMember && !isSuperAdmin && !UNGUARDED_PATHS.includes(pathname)) {
    return <NoClubAccess clubName={club?.name ?? null} />;
  }

  const auth = (el: ReactElement) => user ? el : <Navigate to="/login" replace />;
  // Un super-admin non membre entre en support avec le rôle effectif 'admin'.
  const adminOnly = (el: ReactElement) =>
    isSuperAdmin || role === 'admin' ? el : <Navigate to="/" replace />;
  // La console est une surface PLATEFORME : `isSuperAdmin` seul, jamais role === 'admin'
  // (le super-admin n'est pas un rôle de club). L'URL est devinable, carte masquée ou non.
  const superAdminOnly = (el: ReactElement) =>
    isSuperAdmin ? el : <Navigate to="/" replace />;

  return (
    <>
      {isSupport && user && club && (
        <SupportBanner clubName={club.name} suspended={club.status !== 'active'} />
      )}
      <Routes>
        <Route path="/login" element={user ? <Navigate to="/" replace /> : <LoginPage />} />
        <Route path="/" element={auth(<AppHomePage />)} />
        <Route path="/tmc-planning" element={auth(<HomePage user={user!} />)} />
        <Route path="/tmc-planning/:id" element={auth(<TournamentPage user={user!} />)} />
        <Route path="/tournament/:id" element={<RedirectTournament />} />
        <Route path="/programmation-image" element={auth(<ProgrammationImagePage />)} />
        <Route path="/events" element={auth(<EventsPage />)} />
        <Route path="/events/new" element={auth(<EventForm />)} />
        <Route path="/events/:id/edit" element={auth(<EventForm />)} />
        <Route path="/live-score" element={auth(<LiveScorePage />)} />
        <Route path="/live-score/new" element={auth(<LiveMatchForm />)} />
        <Route path="/live-score/:id" element={auth(<LiveMatchPage />)} />
        <Route path="/actus" element={auth(<ActusPage />)} />
        <Route path="/actus/new" element={auth(<ActuForm />)} />
        <Route path="/actus/:id/edit" element={auth(<ActuForm />)} />
        <Route path="/team-matches" element={auth(<TeamMatchesPage />)} />
        <Route path="/team-matches/admin" element={auth(<TeamMatchesAdminPage />)} />
        <Route path="/team-matches/equipe/:id" element={auth(<TeamEquipePage />)} />
        <Route path="/team-matches/rencontre/new" element={auth(<TeamRencontreForm />)} />
        <Route path="/team-matches/rencontre/:id" element={auth(<TeamRencontrePage />)} />
        <Route path="/team-matches/rencontre/:id/edit" element={auth(<TeamRencontreForm />)} />
        <Route path="/admin/members" element={auth(adminOnly(<MembersPage />))} />
        <Route path="/admin/site" element={auth(adminOnly(<SiteConfigPage />))} />
        {/* PR5-bis — l'écran Membres absorbe l'ancienne page d'invitation ; l'URL est
            documentée dans le README et peut traîner dans un favori. */}
        <Route path="/admin/invite" element={<Navigate to="/admin/members" replace />} />
        <Route path="/super-admin" element={auth(superAdminOnly(<SuperAdminPage />))} />
        <Route path="/accept-invite" element={<AcceptInvitePage />} />
      </Routes>
    </>
  );
}

// Monté au-dessus du garde d'auth, pour que l'écran « Accès refusé » de PR4 et tout écran
// rendu hors des routes soient déjà aux couleurs du club.
//
// ⚠️ `club_settings` n'est lisible que par un compte authentifié : l'écran de LOGIN garde donc
// les valeurs d'`index.css`, et les couleurs arrivent à la connexion (le hook relit sur
// `onAuthStateChange`). Même limite que le logo et le nom du club depuis PR7-bis.
function ClubTheme() {
  const { config } = useClubConfig();
  useClubTheme(config);
  return null;
}

function App() {
  return (
    <ClubProvider>
      <ClubTheme />
      <AppRoutes />
    </ClubProvider>
  );
}

export default App;
