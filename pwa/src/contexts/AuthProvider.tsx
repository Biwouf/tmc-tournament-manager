import { useEffect, useState, type ReactNode } from 'react';
import { supabase } from '../lib/supabase';
import { AuthContext, type AuthState } from '../hooks/useAuth';

export function AuthProvider({ children }: { children: ReactNode }) {
  const [auth, setAuth] = useState<AuthState>({ user: null, loading: true });
  useEffect(() => {
    // INITIAL_SESSION couvre aussi la restauration : pas de second getSession().
    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, session) => {
      setAuth({ user: session?.user ?? null, loading: false });
    });
    return () => subscription.unsubscribe();
  }, []);
  return <AuthContext.Provider value={auth}>{children}</AuthContext.Provider>;
}
