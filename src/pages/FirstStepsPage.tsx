import { useState } from 'react';
import { Navigate } from 'react-router-dom';
import '@fontsource-variable/manrope';
import '../components/signup/signup.css';
import '../components/firstSteps/firstSteps.css';
import FirstStepsFlow from '../components/firstSteps/FirstStepsFlow';
import { FIRST_STEPS } from '../components/firstSteps/steps';
import { useClub } from '../contexts/ClubContext';
import { useClubRole } from '../contexts/ClubRoleContext';
import { useClubConfig } from '../hooks/useClubConfig';
import { eligibleForFirstSteps, firstStepsPending } from '../lib/firstSteps';

// SaaS S5 — premiers pas d'un club self-serve (`docs/specs/SAAS_ONBOARDING.md` §9). Hors de ce
// cas (club `internal`, membre, parcours terminé ou reporté) : le tableau de bord.
export default function FirstStepsPage() {
  const { club, isSupport } = useClub();
  const { role } = useClubRole();
  if (!club || !eligibleForFirstSteps(club, role, isSupport)) return <Navigate to="/" replace />;
  return <Loaded />;
}

function Loaded() {
  const { club } = useClub();
  const { config, loading } = useClubConfig();
  // Figée au premier chargement : un rafraîchissement de jeton relit la config, et le parcours
  // ne doit ni se démonter ni repartir d'un état plus ancien que ses propres écritures.
  const [initial, setInitial] = useState<typeof config | null>(null);
  if (!loading && !initial) setInitial(config);
  if (!initial) return null;
  if (!firstStepsPending(initial.onboarding)) return <Navigate to="/" replace />;
  return <FirstStepsFlow club={club!} config={initial} steps={FIRST_STEPS} />;
}
