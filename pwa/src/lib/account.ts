import type { User } from '@supabase/supabase-js';
import type { AvatarPerson } from '../components/Avatar';
import { supabase } from './supabase';
import { uiMessage } from './uiMessage';
import { loginError, signupError } from './signup';
import { passwordRecoveryRedirect } from './passwordRecoveryRedirect';
import { ACCOUNT_COPY as T } from '../../../shared/accountCopy.mjs';
import type { Profile, Sex } from './courses';

export type ProfileFields = { prenom: string; nom: string; sex: Sex; classement?: string | null };

/**
 * Enregistre son propre profil (RPC `account_save_profile`, migration 2026112102), membre ou non.
 * `classement` absent : inchangé ; `null` : effacé. Renvoie la nouvelle révision.
 */
export async function saveProfile(fields: ProfileFields, revision: number): Promise<number> {
  const { data, error } = await supabase
    .rpc('account_save_profile', {
      p_prenom: fields.prenom.trim(),
      p_nom: fields.nom.trim(),
      p_sex: fields.sex,
      p_revision: revision,
      ...(fields.classement === undefined ? {} : { p_classement: fields.classement ?? '' }),
    })
    .abortSignal(AbortSignal.timeout(15000));
  if (error) throw new Error(error.message);
  return (data as { revision: number }).revision;
}

export const isConflict = (error: unknown) => error instanceof Error && error.message.includes('VERSION_CONFLICT');

/**
 * Vrai si le profil relu contient déjà ce qu'on voulait enregistrer : un premier essai abandonné
 * (délai dépassé) a pu aboutir, la nouvelle tentative ne doit pas passer pour un conflit.
 */
export function alreadySaved(fields: ProfileFields, profile: Profile | null): profile is Profile {
  return !!profile && profile.prenom === fields.prenom.trim() && profile.nom === fields.nom.trim() && profile.sex === fields.sex
    && (fields.classement === undefined || (profile.classement ?? null) === (fields.classement || null));
}

export function accountError(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);
  if (message.includes('VERSION_CONFLICT')) return T.conflict;
  if (message.includes('VALIDATION_ERROR')) return T.invalid;
  return uiMessage(error, T.saveFailed);
}

/** Erreur d'Auth : le message de Supabase (anglais, parfois sans mot reconnu par `uiMessage`) n'est jamais montré. */
export const authMessage = (error: unknown, fallback: string) =>
  uiMessage(error instanceof TypeError || error instanceof DOMException ? error : null, fallback);

export type PasswordResult = { ok: true; message: string } | { ok: false; error: string; reauth?: boolean };

/**
 * Change le mot de passe après vérification de l'actuel (reconnexion avec l'e-mail du compte),
 * puis ferme au besoin les sessions des autres appareils. Jamais de message brut de Supabase.
 */
export async function changePassword(email: string, current: string, next: string, others: boolean): Promise<PasswordResult> {
  if (next.length < 8) return { ok: false, error: T.passwordShort };
  if (next === current) return { ok: false, error: T.passwordSame };
  try {
    const check = await supabase.auth.signInWithPassword({ email, password: current });
    if (check.error) {
      const wrong = check.error.code === 'invalid_credentials' || /invalid login/i.test(check.error.message);
      return { ok: false, error: wrong ? T.passwordWrong : loginError(check.error) };
    }
    const { error } = await supabase.auth.updateUser({ password: next });
    if (error) {
      if (error.code === 'reauthentication_needed' || /reauthentication/i.test(error.message)) return { ok: false, error: T.passwordReauth, reauth: true };
      if (error.code === 'same_password' || /different from the old/i.test(error.message)) return { ok: false, error: T.passwordSame };
      return { ok: false, error: error.code === 'weak_password' ? signupError(error) : authMessage(error, T.passwordFailed) };
    }
  } catch (error) {
    return { ok: false, error: authMessage(error, T.passwordFailed) };
  }
  if (!others) return { ok: true, message: T.passwordSaved };
  // Le mot de passe est changé : un échec ici ne doit pas le faire croire refusé.
  const failed = await supabase.auth.signOut({ scope: 'others' }).then(r => !!r.error, () => true);
  return { ok: true, message: failed ? T.passwordOthersFailed : T.passwordSavedOthers };
}

/** Envoie le lien de réinitialisation à l'e-mail du compte. Renvoie un message d'erreur, ou `null`. */
export async function sendPasswordReset(email: string, clubSlug?: string): Promise<string | null> {
  try {
    const { error } = await supabase.auth.resetPasswordForEmail(email, {
      redirectTo: passwordRecoveryRedirect(window.location.origin, clubSlug),
    });
    if (!error) return null;
    return error.status === 429 ? T.tooManyRequests : authMessage(error, T.passwordResetFailed);
  } catch (error) {
    return authMessage(error, T.passwordResetFailed);
  }
}

/**
 * Personne connectée : profil s'il est chargé, sinon métadonnées de l'inscription (session).
 * Sans nom : `null` tant que le profil charge, puis l'e-mail.
 */
export function sessionPerson(user: User, profile: Profile | null | undefined, loaded: boolean): AvatarPerson | null {
  const signup = (user.user_metadata?.club_signup ?? {}) as { prenom?: string; nom?: string };
  const prenom = profile?.prenom || signup.prenom || '';
  const nom = profile?.nom || signup.nom || '';
  if (!prenom && !nom) return loaded ? { id: user.id, prenom: user.email } : null;
  return { id: user.id, prenom, nom };
}
