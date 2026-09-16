import { TENNIS_RANKINGS } from '../../../shared/tennisRankings';
export { TENNIS_RANKINGS };
export type SignupFields = { prenom: string; nom: string; email: string; sex: string; classement: string; password: string; confirm: string };
export const signupReturnTo = (value: string | null) => value && /^\/cours(?:\?|$)/.test(value) ? value : '/actu';
export function validateSignup(f: SignupFields): string | null {
  if (!f.prenom.trim() || !f.nom.trim() || f.prenom.trim().length > 100 || f.nom.trim().length > 100 || !f.email.trim()) return 'Renseignez votre prénom, nom et email.';
  if (!['female', 'male'].includes(f.sex)) return 'Choisissez votre sexe.';
  if (f.classement && !TENNIS_RANKINGS.some(r => r === f.classement)) return 'Choisissez un classement dans la liste.';
  if (f.password.length < 8) return 'Choisissez un mot de passe d’au moins 8 caractères.';
  if (f.password !== f.confirm) return 'Les mots de passe ne correspondent pas.';
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
