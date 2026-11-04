import type { ReactNode } from 'react';
import { Navigate } from 'react-router-dom';
import { useClub } from '../../contexts/ClubContext';
import { useClubRole } from '../../contexts/ClubRoleContext';
import { useClubConfig } from '../../hooks/useClubConfig';
import { eligibleForFirstSteps, firstStepsPending } from '../../lib/firstSteps';
import { FIRST_STEPS_PATH } from '../../lib/magicLink';

// SaaS S5 — ouvrir le BO d'un club self-serve ramène aux premiers pas tant qu'ils ne sont ni
// terminés ni reportés. Seul le tableau de bord passe par ici : les autres pages restent
// accessibles, et les liens « à découvrir » de l'écran final y mènent.
export default function FirstStepsGate({ children }: { children: ReactNode }) {
  const { club, isSupport } = useClub();
  const { role } = useClubRole();
  // Un club `internal` ne lit rien de plus.
  if (!eligibleForFirstSteps(club, role, isSupport)) return children;
  return <EligibleGate>{children}</EligibleGate>;
}

function EligibleGate({ children }: { children: ReactNode }) {
  const { config, loading } = useClubConfig();
  if (loading) return null;
  if (firstStepsPending(config.onboarding)) return <Navigate to={FIRST_STEPS_PATH} replace />;
  return children;
}
