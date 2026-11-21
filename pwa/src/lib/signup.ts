import { TENNIS_RANKINGS } from '../../../shared/tennisRankings';
export { TENNIS_RANKINGS };
export type SignupFields = { prenom: string; nom: string; email: string; sex: string; classement: string; password: string };
/** Fiche d'une rencontre par équipe : la compo y attend la personne qui vient de se connecter. */
export const isRencontrePath = (value: string | null | undefined) => !!value && /^\/matches-equipes\/[\w-]+$/.test(value);
// Chemins internes connus seulement (pas d'URL externe, pas de `//`) : les cours et une fiche rencontre.
export const signupReturnTo = (value: string | null) => value && (/^\/cours(?:\?|$)/.test(value) || isRencontrePath(value)) ? value : '/actu';
export function validateSignup(f: SignupFields): string | null {
  if (!f.prenom.trim() || !f.nom.trim() || f.prenom.trim().length > 100 || f.nom.trim().length > 100 || !f.email.trim()) return 'Renseignez votre prénom, nom et email.';
  if (!['female', 'male'].includes(f.sex)) return 'Choisissez votre sexe.';
  if (f.classement && !TENNIS_RANKINGS.some(r => r === f.classement)) return 'Choisissez un classement dans la liste.';
  if (f.password.length < 8) return 'Choisissez un mot de passe d’au moins 8 caractères.';
  return null;
}
export function signupError(error: unknown): string {
  const e = error as { code?: string; status?: number; message?: string };
  if (e?.code === 'user_already_exists' || e?.code === 'email_exists') return 'Cette adresse email a déjà un compte. Connectez-vous ou demandez un nouveau mot de passe.';
  if (e?.code === 'weak_password') return 'Ce mot de passe est trop faible. Choisissez un mot de passe plus long et difficile à deviner.';
  if (e?.status === 429) return 'Trop de demandes. Patientez quelques minutes avant de réessayer.';
  if (e?.message?.includes('CLUB_UNAVAILABLE')) return 'Ce club n’accepte pas d’inscriptions pour le moment.';
  if (e?.code === 'signup_disabled') return 'Les inscriptions sont actuellement fermées. Contactez le club.';
  if (e?.code === 'email_address_invalid') return 'Vérifiez votre adresse email.';
  return 'Connexion impossible. Vérifiez votre connexion internet puis réessayez.';
}

/** Erreur de connexion en français ; jamais le message brut de Supabase. */
export function loginError(error: unknown): string {
  const e = error as { code?: string; status?: number; message?: string };
  if (e?.code === 'invalid_credentials' || /invalid login credentials/i.test(e?.message ?? '')) return 'Email ou mot de passe incorrect.';
  if (e?.code === 'email_not_confirmed' || /email not confirmed/i.test(e?.message ?? '')) return 'Votre adresse email n’est pas encore confirmée. Ouvrez le lien reçu par email, puis réessayez.';
  if (e?.status === 429) return 'Trop de tentatives. Patientez quelques minutes avant de réessayer.';
  return 'Connexion impossible. Vérifiez votre connexion internet puis réessayez.';
}
