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
import InvitePage from './pages/InvitePage';
import AcceptInvitePage from './pages/AcceptInvitePage';
import TeamMatchesPage from './pages/TeamMatchesPage';
import TeamMatchesAdminPage from './pages/TeamMatchesAdminPage';
import TeamEquipePage from './pages/TeamEquipePage';
import TeamRencontrePage from './pages/TeamRencontrePage';
import TeamRencontreForm from './components/teamMatches/TeamRencontreForm';
import { ClubProvider, useClub } from './contexts/ClubContext';
import { ClubRoleProvider, useClubRole } from './contexts/ClubRoleContext';

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
  const { club } = useClub();
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

  return (
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
      <Route path="/admin/invite" element={auth(adminOnly(<InvitePage />))} />
      <Route path="/accept-invite" element={<AcceptInvitePage />} />
    </Routes>
  );
}

function App() {
  return (
    <ClubProvider>
      <AppRoutes />
    </ClubProvider>
  );
}

export default App;
