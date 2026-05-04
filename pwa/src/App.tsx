import type { ReactElement } from 'react';
import { Routes, Route, Navigate, useLocation } from 'react-router-dom';
import AppHeader from './components/layout/AppHeader';
import BottomNav from './components/layout/BottomNav';
import ActusPage from './pages/ActusPage';
import ActuDetailPage from './pages/ActuDetailPage';
import EventsPage from './pages/EventsPage';
import EventDetailPage from './pages/EventDetailPage';
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
    <>
      <AppHeader />
      <main className="pwa-content">
        <Routes>
          <Route path="/" element={<Navigate to="/actus" replace />} />
          <Route path="/login" element={<LoginPage />} />
          <Route path="/actus" element={<ActusPage />} />
          <Route path="/actus/:id" element={<ActuDetailPage />} />
          <Route path="/evenements" element={<EventsPage />} />
          <Route path="/evenements/:id" element={<EventDetailPage />} />
          <Route path="/matches" element={<MatchesPage />} />
          <Route path="/matches/new" element={<RequireAuth><NewMatchPage /></RequireAuth>} />
          <Route path="/matches/:id/score" element={<RequireAuth><LiveMatchPage /></RequireAuth>} />
        </Routes>
      </main>
      <BottomNav />
    </>
  );
}
