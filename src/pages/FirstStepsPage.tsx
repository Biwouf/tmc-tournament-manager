import { useState } from 'react';
import { Navigate, useSearchParams } from 'react-router-dom';
import '@fontsource-variable/manrope';
import '../components/signup/signup.css';
import '../components/firstSteps/firstSteps.css';
import FirstStepsFlow from '../components/firstSteps/FirstStepsFlow';
import { FIRST_STEPS } from '../components/firstSteps/steps';
import { useClub } from '../contexts/ClubContext';
import { useClubRole } from '../contexts/ClubRoleContext';
import { useClubConfig } from '../hooks/useClubConfig';
import { eligibleForFirstSteps, firstStepsPending } from '../lib/firstSteps';
import { eligibleForChecklist, reminderSteps } from '../lib/dashboardChecklist';

// SaaS S5 — premiers pas d'un club self-serve (`docs/specs/SAAS_ONBOARDING.md` §9). Hors de ce
// cas (club `internal`, membre, parcours terminé ou reporté) : le tableau de bord.
// S8 : `?etape=<id>` rouvre une étape reportée depuis la checklist, même parcours quitté.
export default function FirstStepsPage() {
  const { club, isSupport } = useClub();
  const { role } = useClubRole();
  const [params] = useSearchParams();
  const resume = params.get('etape');
  const allowed = eligibleForFirstSteps(club, role, isSupport) || (resume !== null && eligibleForChecklist(club, role, isSupport));
  if (!club || !allowed) return <Navigate to="/" replace />;
  return <Loaded resume={resume} />;
}

function Loaded({ resume }: { resume: string | null }) {
  const { club } = useClub();
  const { config, loading } = useClubConfig();
  // Figée au premier chargement : un rafraîchissement de jeton relit la config, et le parcours
  // ne doit ni se démonter ni repartir d'un état plus ancien que ses propres écritures.
  const [initial, setInitial] = useState<typeof config | null>(null);
  if (!loading && !initial) setInitial(config);
  if (!initial) return null;
  const resumable = reminderSteps(initial.onboarding).some((step) => step.id === resume && !initial.onboarding.completed_steps.includes(step.id));
  if (!resumable && !firstStepsPending(initial.onboarding)) return <Navigate to="/" replace />;
  return <FirstStepsFlow club={club!} config={initial} steps={FIRST_STEPS} initialStepId={resumable ? resume! : undefined} />;
}
