import { useState, useEffect } from 'react';
import { Routes, Route, Navigate } from 'react-router-dom';
import type { User } from '@supabase/supabase-js';
import { supabase } from './lib/supabase';
import HomePage from './pages/HomePage';
import TournamentPage from './pages/TournamentPage';
import LoginPage from './pages/LoginPage';

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

  return (
    <Routes>
      <Route path="/login" element={user ? <Navigate to="/" replace /> : <LoginPage />} />
      <Route path="/" element={user ? <HomePage user={user} /> : <Navigate to="/login" replace />} />
      <Route path="/tournament/:id" element={user ? <TournamentPage user={user} /> : <Navigate to="/login" replace />} />
    </Routes>
  );
}

export default App;
