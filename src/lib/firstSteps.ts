// SaaS S5 — règles des premiers pas : qui les voit, où en est le club, et l'écriture de l'avancement.
import { parseClubConfig, type OnboardingState } from './clubConfig';
import { updateClubConfigKey } from './clubConfigWrite';
import type { Club } from '../contexts/ClubContext';
import type { ClubRole } from '../contexts/ClubRoleContext';

/** Club self-serve en essai, ouvert par l'un de ses admins. Le support ne passe jamais par là. */
export function eligibleForFirstSteps(club: Club | null, role: ClubRole | null, isSupport: boolean): boolean {
  return !isSupport && role === 'admin' && club?.plan === 'trial' && club.created_via === 'self_serve';
}

/** Ni terminés ni reportés. */
export function firstStepsPending(state: OnboardingState): boolean {
  return !state.finished_at && !state.postponed_at;
}

type StepLike = { isDone: (state: OnboardingState) => boolean; final?: boolean };

type ResumableStep = StepLike & { id: string };

/** L'étape où reprendre : la première ni terminée ni passée, sinon la dernière. */
export function currentStepIndex(steps: ResumableStep[], state: OnboardingState): number {
  const index = steps.findIndex((step) => !step.isDone(state) && !state.skipped_steps.includes(step.id));
  return index === -1 ? steps.length - 1 : index;
}

/** « Étape X sur N » (l'écran final ne compte pas) et avancement de la barre, depuis la liste. */
export function stepProgress(steps: StepLike[], index: number): { number: number; total: number; percent: number } {
  const total = steps.filter((step) => !step.final).length;
  return { number: index + 1, total, percent: total ? Math.round((Math.min(index, total) / total) * 100) : 100 };
}

export function trialLabel(trialEndsAt: string | null, now = new Date()): string {
  if (!trialEndsAt) return 'Essai';
  const days = Math.ceil((new Date(trialEndsAt).getTime() - now.getTime()) / 86_400_000);
  if (days <= 0) return 'Essai terminé';
  return `Essai · ${days} jour${days > 1 ? 's' : ''} restant${days > 1 ? 's' : ''}`;
}

/** Adresse de la PWA du club, cf. `resolveClubSlug`. */
export function clubAppHost(slug: string): string {
  return `app-${slug}.feelike.pro`;
}

export type OnboardingWrite = { state: OnboardingState; error?: undefined } | { state?: undefined; error: string };

async function writeOnboarding(clubId: string | null, change: (current: OnboardingState) => OnboardingState): Promise<OnboardingWrite> {
  if (!clubId) return { error: 'Club introuvable — enregistrement impossible.' };
  let state: OnboardingState | undefined;
  const result = await updateClubConfigKey(clubId, 'onboarding', (existing) => {
    state = change(parseClubConfig({ onboarding: existing }).onboarding);
    return state;
  });
  if (!result.success) return { error: result.errors.join(' ') };
  return { state: state! };
}

export function completeFirstStep(clubId: string | null, stepId: string): Promise<OnboardingWrite> {
  return writeOnboarding(clubId, (current) => ({
    ...current,
    completed_steps: current.completed_steps.includes(stepId) ? current.completed_steps : [...current.completed_steps, stepId],
    skipped_steps: current.skipped_steps.filter((id) => id !== stepId),
  }));
}

/** « Passer cette étape » : reportée, pas terminée. La reprise la saute ; S8 la reproposera. */
export function skipFirstStep(clubId: string | null, stepId: string): Promise<OnboardingWrite> {
  return writeOnboarding(clubId, (current) => ({
    ...current,
    skipped_steps: current.skipped_steps.includes(stepId) ? current.skipped_steps : [...current.skipped_steps, stepId],
  }));
}

export function postponeFirstSteps(clubId: string | null): Promise<OnboardingWrite> {
  return writeOnboarding(clubId, (current) => ({ ...current, postponed_at: new Date().toISOString() }));
}

export function finishFirstSteps(clubId: string | null): Promise<OnboardingWrite> {
  return writeOnboarding(clubId, (current) => ({ ...current, finished_at: new Date().toISOString() }));
}
