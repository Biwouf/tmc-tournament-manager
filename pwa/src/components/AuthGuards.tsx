import { useEffect, useState, type ReactElement } from 'react';
import { Navigate, useLocation } from 'react-router-dom';
import { useAuth } from '../hooks/useAuth';
import { useCourseContext } from '../hooks/useCourses';
import { leaveAfterSignOut, signOutTarget } from '../lib/signOutTarget';
import { AppLoading } from './layout/LoadState';

function LoginRedirect() {
  const location = useLocation();
  const [target] = useState(signOutTarget);
  useEffect(() => leaveAfterSignOut(null), []);
  if (target) return <Navigate to={target} replace />;
  return <Navigate to="/login" replace state={{ from: location.pathname + location.search }} />;
}

// Tout compte connecté, membre ou non : /profil doit rester ouvert à un compte en attente,
// refusé ou retiré, sinon il n'a aucun moyen de se déconnecter.
export function RequireUser({ children }: { children: ReactElement }) {
  const { user, loading } = useAuth();
  if (loading) return <AppLoading />;
  if (!user) return <LoginRedirect />;
  return children;
}

// Pages réservées aux membres (ou gestionnaires) du club.
export function RequireAuth({ children }: { children: ReactElement }) {
  const { user, loading } = useAuth();
  const membership = useCourseContext();
  if (loading) return <AppLoading />;
  if (!user) return <LoginRedirect />;
  if (membership.isPending) return <p className="p-6" role="status">Vérification de votre accès…</p>;
  if (membership.isError) return <div className="p-6" role="alert">Vérification de l’accès impossible. <button className="min-h-11 text-primary underline" onClick={() => void membership.refetch()}>Réessayer</button></div>;
  if (!membership.data?.is_member && !membership.data?.can_manage) return <Navigate to="/actu" replace />;
  return children;
}
