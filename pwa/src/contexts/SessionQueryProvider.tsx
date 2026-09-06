import { useState, type ReactNode } from 'react';
import { QueryClientProvider } from '@tanstack/react-query';
import { useAuth } from '../hooks/useAuth';
import { createPwaQueryClient } from '../lib/queryClient';

function SessionCache({ children }: { children: ReactNode }) {
  const [client] = useState(createPwaQueryClient);
  return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
}

export function SessionQueryProvider({ children }: { children: ReactNode }) {
  const { user, loading } = useAuth();
  if (loading) return null;
  // Un autre compte (ou une déconnexion) repart sans les données de la session précédente.
  // TOKEN_REFRESHED / SIGNED_IN du même compte conservent le cache et les écrans montés.
  return <SessionCache key={user?.id ?? 'anon'}>{children}</SessionCache>;
}
