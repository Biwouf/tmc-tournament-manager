import { useState, useEffect } from 'react';
import { Routes, Route, Navigate } from 'react-router-dom';
import type { User } from '@supabase/supabase-js';
import { supabase } from './lib/supabase';
import AppHomePage from './pages/AppHomePage';
import HomePage from './pages/HomePage';
import TournamentPage from './pages/TournamentPage';
import LoginPage from './pages/LoginPage';
import ProgrammationImagePage from './pages/ProgrammationImagePage';

function App() {
  const [user, setUser] = useState<User | null | undefined>(undefined);

  useEffect(() => {
    supabase.auth.getSession().then(({ data: { session } }) => {
      setUser(session?.user ?? null);
    });

    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, session) => {
      setUser(session?.user ?? null);
    });

    return () => subscription.unsubscribe();
  }, []);

  if (user === undefined) return null;

  const auth = (el: JSX.Element) => user ? el : <Navigate to="/login" replace />;

  return (
    <Routes>
      <Route path="/login" element={user ? <Navigate to="/" replace /> : <LoginPage />} />
      <Route path="/" element={auth(<AppHomePage />)} />
      <Route path="/tmc-planning" element={auth(<HomePage user={user!} />)} />
      <Route path="/tmc-planning/:id" element={auth(<TournamentPage user={user!} />)} />
      <Route path="/programmation-image" element={auth(<ProgrammationImagePage />)} />
    </Routes>
  );
}

export default App;
