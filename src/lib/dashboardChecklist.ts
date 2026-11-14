// SaaS S8 — tableau de bord d'un club self-serve : bandeau d'essai et checklist « Pour finir
// d'installer le club ». Règles pures, testées sans React (`tests/dashboard-checklist.test.mjs`).
// Spec : `docs/specs/SAAS_ONBOARDING.md` §12.
import { siteGaps } from '../../shared/siteReadiness.mjs';
import type { ClubConfig, OnboardingState } from './clubConfig';
import type { Club } from '../contexts/ClubContext';
import type { ClubRole } from '../contexts/ClubRoleContext';
import { trialDaysLeft, trialLabel } from './firstSteps';

/** Clubs self-serve (essai ou abonnés), ouverts par un admin, hors support. Rien pour `internal`. */
export function eligibleForChecklist(club: Club | null, role: ClubRole | null, isSupport: boolean): boolean {
  return !isSupport && role === 'admin' && club?.created_via === 'self_serve' && club.plan !== 'internal';
}

export type TrialBanner = { label: string; urgent: boolean };

/** « Essai · N jours restants », accent à J-7, « Votre essai se termine aujourd'hui » à J0. Pas de bouton avant S9. */
export function trialBanner(club: Club | null, now = new Date()): TrialBanner | null {
  if (club?.plan !== 'trial') return null;
  const days = trialDaysLeft(club.trial_ends_at, now);
  if (days === 0) return { label: 'Votre essai se termine aujourd’hui', urgent: true };
  return { label: trialLabel(club.trial_ends_at, now), urgent: days === null || days <= 7 };
}

/** Étapes des premiers pas qu'on peut reprendre depuis la checklist (ids de `FIRST_STEPS`). */
export const REMINDER_STEPS = [
  { id: 'actu', title: 'Votre première actu', detail: 'Annoncez l’arrivée de l’app à vos adhérents.' },
  { id: 'equipes', title: 'Vos équipes', detail: 'Importez vos équipes et leur calendrier depuis Ten’Up.' },
  { id: 'affiches', title: 'Votre affiche', detail: 'Générez l’affiche des rencontres du week-end.' },
] as const;

/** Reportée : le parcours a été quitté sans la terminer. Terminée depuis la checklist : elle y reste. */
export function reminderSteps(state: OnboardingState) {
  const left = Boolean(state.postponed_at || state.finished_at);
  return REMINDER_STEPS.filter(({ id }) =>
    (left && !state.completed_steps.includes(id)) || state.resumed_steps.includes(id));
}

export const firstStepPath = (id: string) => `/premiers-pas?etape=${id}`;

export type ChecklistItemId = 'site' | 'publish' | 'team' | 'share' | 'password' | `step:${string}`;
export type ChecklistItem = {
  id: ChecklistItemId;
  title: string;
  detail: string;
  done: boolean;
  /** Facultatif : hors compteur, ne retient pas la carte. */
  optional?: boolean;
};

export type ChecklistFacts = {
  config: ClubConfig;
  sitePublished: boolean;
  /** Un autre admin, ou une invitation en cours ; null tant que la liste des membres n'est pas lue. */
  team: boolean | null;
  /** null : élément masqué (compte qui n'est pas né du tunnel, donc déjà doté d'un mot de passe). */
  passwordSet: boolean | null;
};

const list = (items: string[]) => items.length > 1 ? `${items.slice(0, -1).join(', ')} et ${items.at(-1)}` : items[0];

export function checklistItems({ config, sitePublished, team, passwordSet }: ChecklistFacts): ChecklistItem[] {
  const gaps = siteGaps(config);
  const items: ChecklistItem[] = [
    {
      id: 'site', title: 'Compléter votre site', done: gaps.length === 0,
      detail: gaps.length ? `Il manque : ${list(gaps)}.` : 'Accueil, tarifs et contact sont prêts.',
    },
    {
      id: 'publish', title: 'Publier le site', done: sitePublished,
      detail: sitePublished
        ? 'Votre site est ouvert aux moteurs de recherche.'
        : 'Il reste invisible des moteurs de recherche tant que vous ne l’ouvrez pas.',
    },
    {
      id: 'team', title: 'Inviter votre bureau', done: team === true,
      detail: 'Un président, un trésorier, un enseignant : chacun avec son accès.',
    },
    {
      id: 'share', title: 'Partager l’app aux adhérents', done: Boolean(config.onboarding.app_shared_at),
      detail: 'Le lien ou le QR code, sur le groupe du club.',
    },
    ...reminderSteps(config.onboarding).map((step): ChecklistItem => ({
      id: `step:${step.id}`, title: step.title, detail: step.detail, done: config.onboarding.completed_steps.includes(step.id),
    })),
  ];
  if (passwordSet !== null) {
    items.push({
      id: 'password', title: 'Choisir un mot de passe', optional: true, done: passwordSet,
      detail: 'Facultatif : le lien reçu par e-mail suffit pour vous connecter.',
    });
  }
  return items;
}

export function checklistProgress(items: ChecklistItem[]): { done: number; total: number } {
  const counted = items.filter((item) => !item.optional);
  return { done: counted.filter((item) => item.done).length, total: counted.length };
}

/** La carte disparaît quand tout, hors facultatif, est fait. */
export function checklistComplete(items: ChecklistItem[]): boolean {
  const { done, total } = checklistProgress(items);
  return done === total;
}

/** « Choisir un mot de passe » : seulement pour un compte né du tunnel (S4), qui n'en a pas. */
export function passwordState(user: { app_metadata?: Record<string, unknown>; user_metadata?: Record<string, unknown> } | null): boolean | null {
  if (!user || user.app_metadata?.created_via !== 'club_signup') return null;
  return user.user_metadata?.password_set === true;
}

/** Message prêt à coller sur le groupe du club. */
export function shareMessage(clubName: string, host: string): string {
  return `${clubName} a son app ! Résultats, rencontres, actus et live score : https://${host} — ouvrez le lien puis « Ajouter à l’écran d’accueil ».`;
}

/** Mêmes règles qu'`AcceptInvitePage` : 6 caractères au moins, confirmation identique. */
export function passwordProblem(password: string, confirm: string): string | null {
  if (password.length < 6) return 'Mot de passe trop court (6 caractères minimum).';
  if (password !== confirm) return 'Les mots de passe ne correspondent pas.';
  return null;
}

/** `updateUser({ password })` → message. GoTrue peut exiger une connexion récente. */
export function passwordUpdateError(error: { code?: string; message?: string }): string {
  if (error.code === 'reauthentication_needed') return 'Pour des raisons de sécurité, reconnectez-vous avec un nouveau lien, puis réessayez.';
  if (error.code === 'same_password') return 'C’est déjà votre mot de passe.';
  if (error.code === 'weak_password') return 'Mot de passe trop faible : allongez-le ou variez les caractères.';
  return error.message || 'Enregistrement impossible. Réessayez.';
}
