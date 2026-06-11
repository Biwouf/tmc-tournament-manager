import type { ReactElement } from 'react';
import { Routes, Route, Navigate, useLocation } from 'react-router-dom';
import AppHeader from './components/layout/AppHeader';
import { HeaderActionProvider } from './components/layout/HeaderActionContext';
import BottomNav from './components/layout/BottomNav';
import InstallBanner from './components/install/InstallBanner';
import ActuPage from './pages/ActuPage';
import ActuDetailPage from './pages/ActuDetailPage';
import EventDetailPage from './pages/EventDetailPage';
import MatchesEquipesPage from './pages/MatchesEquipesPage';
import MatchesPage from './pages/MatchesPage';
import LoginPage from './pages/LoginPage';
import NewMatchPage from './pages/NewMatchPage';
import LiveMatchPage from './pages/LiveMatchPage';
import { useAuth } from './hooks/useAuth';

function RequireAuth({ children }: { children: ReactElement }) {
  const { user, loading } = useAuth();
  const location = useLocation();
  if (loading) return null;
  if (!user) {
    return <Navigate to="/login" replace state={{ from: location.pathname }} />;
  }
  return children;
}

export default function App() {
  return (
    <HeaderActionProvider>
      <AppHeader />
      <main className="pwa-content">
        <Routes>
          <Route path="/" element={<Navigate to="/actu" replace />} />
          <Route path="/login" element={<LoginPage />} />

          {/* Actu (fusionné) — sous-onglets gérés dans la page */}
          <Route path="/actu" element={<ActuPage />} />
          <Route path="/actus/:id" element={<ActuDetailPage />} />
          <Route path="/evenements/:id" element={<EventDetailPage />} />

          {/* Match équipes (lecture) */}
          <Route path="/matches-equipes" element={<MatchesEquipesPage />} />

          {/* Live (inchangé) */}
          <Route path="/matches" element={<MatchesPage />} />
          <Route path="/matches/new" element={<RequireAuth><NewMatchPage /></RequireAuth>} />
          <Route path="/matches/:id/score" element={<RequireAuth><LiveMatchPage /></RequireAuth>} />

          {/* Compat : anciennes URLs → redirection */}
          <Route path="/actus" element={<Navigate to="/actu?tab=actus" replace />} />
          <Route path="/evenements" element={<Navigate to="/actu?tab=events" replace />} />
        </Routes>
      </main>
      <InstallBanner />
      <BottomNav />
    </HeaderActionProvider>
  );
}
