import { Routes, Route, Navigate } from 'react-router-dom';
import AppHeader from './components/layout/AppHeader';
import BottomNav from './components/layout/BottomNav';
import ActusPage from './pages/ActusPage';
import ActuDetailPage from './pages/ActuDetailPage';
import EventsPage from './pages/EventsPage';
import EventDetailPage from './pages/EventDetailPage';
import MatchesPage from './pages/MatchesPage';

export default function App() {
  return (
    <>
      <AppHeader />
      <main className="pwa-content">
        <Routes>
          <Route path="/" element={<Navigate to="/actus" replace />} />
          <Route path="/actus" element={<ActusPage />} />
          <Route path="/actus/:id" element={<ActuDetailPage />} />
          <Route path="/evenements" element={<EventsPage />} />
          <Route path="/evenements/:id" element={<EventDetailPage />} />
          <Route path="/matches" element={<MatchesPage />} />
        </Routes>
      </main>
      <BottomNav />
    </>
  );
}
