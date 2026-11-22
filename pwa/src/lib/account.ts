import { supabase } from './supabase';
import { uiMessage } from './uiMessage';
import { ACCOUNT_COPY as T } from '../../../shared/accountCopy.mjs';
import type { Sex } from './courses';

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

export function accountError(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);
  if (message.includes('VERSION_CONFLICT')) return T.conflict;
  if (message.includes('VALIDATION_ERROR') || message.includes('check constraint')) return T.invalid;
  return uiMessage(error, T.saveFailed);
}

/**
 * Change le mot de passe après vérification de l'actuel (reconnexion avec l'e-mail du compte).
 * Renvoie un message d'erreur en français, ou `null` si c'est fait.
 */
export async function changePassword(email: string, current: string, next: string): Promise<string | null> {
  if (next.length < 8) return T.passwordShort;
  if (next === current) return T.passwordSame;
  try {
    const check = await supabase.auth.signInWithPassword({ email, password: current });
    if (check.error) return /invalid login|invalid_credentials/i.test(check.error.message) ? T.passwordWrong : uiMessage(check.error, T.passwordFailed);
    const { error } = await supabase.auth.updateUser({ password: next });
    if (!error) return null;
    if (/different from the old|same_password/i.test(error.message)) return T.passwordSame;
    return uiMessage(error, T.passwordFailed);
  } catch (error) {
    return uiMessage(error, T.passwordFailed);
  }
}
