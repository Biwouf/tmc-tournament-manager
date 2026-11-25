// Onboarding « Ten'Up d'abord », P2 (brief SAAS_11 §3.4, §6.1) — code à 6 chiffres reçu par e-mail,
// saisi dans l'onglet : tunnel d'inscription et page de connexion. Sans React, testé sous Node.
// Le code et l'adresse ne sont jamais journalisés.
import type { SupabaseClient } from '@supabase/supabase-js';

/** Durée de vie du code (réglage Auth « Email OTP Expiration » = 600 s). */
export const CODE_TTL_MS = 10 * 60 * 1000;
/** Délai entre deux envois : la limite par défaut de GoTrue pour une même adresse. */
export const RESEND_DELAY_S = 60;
/**
 * Refus tolérés sur un même code. GoTrue ne limite que par IP (30 vérifications / 5 min) : au-delà,
 * l'écran impose un nouveau code (l'envoi remplace l'ancien).
 */
export const MAX_CODE_TRIES = 5;

/** Heure de l'envoi (hors rendu : horloge des gestionnaires d'événement). */
export const sentNow = () => Date.now();

/** Saisie ou collage (« 481 902 », « 481-902 ») : les chiffres seulement, 6 au plus. */
export const cleanCode = (value: string) => value.replace(/\D/g, '').slice(0, 6);

export type CodeResult = 'ok' | 'wrong' | 'expired' | 'throttled' | 'failed';
export const CODE_MESSAGES = {
  wrong: 'Ce code ne correspond pas. Vérifiez-le ou demandez-en un nouveau.',
  expired: 'Ce code a expiré. Nous vous en envoyons un nouveau.',
  throttled: 'Trop d’essais. Réessayez dans quelques minutes.',
  /** M2 : 5 refus sur le même code → un nouveau code s'impose. */
  exhausted: 'Trop d’essais avec ce code. Demandez-en un nouveau.',
  exhaustedSent: 'Trop d’essais avec ce code. Nous vous en envoyons un nouveau.',
  failed: 'Connexion impossible. Vérifiez votre réseau, puis réessayez.',
} as const;

/**
 * Réponse de `verifyOtp` → l'état du champ. GoTrue répond la même chose (403 `otp_expired`, « Token
 * has expired or is invalid ») pour un code faux et un code expiré : on les distingue par l'heure du
 * dernier envoi. 429 → trop d'essais ; pas de statut (réseau) ou 5xx → réessayer.
 */
export function codeResult(error: { status?: number } | null, sentAt: number | null, now = Date.now()): CodeResult {
  if (!error) return 'ok';
  const status = error.status ?? 0;
  if (status === 429) return 'throttled';
  if (status >= 400 && status < 500) return sentAt !== null && now - sentAt >= CODE_TTL_MS ? 'expired' : 'wrong';
  return 'failed';
}

/** Secondes avant de pouvoir renvoyer le code (0 : tout de suite). */
export function resendWait(sentAt: number | null, now = Date.now()): number {
  if (sentAt === null) return 0;
  return Math.max(0, Math.ceil((sentAt + RESEND_DELAY_S * 1000 - now) / 1000));
}

/** Annonce du décompte pour les lecteurs d'écran : toutes les 15 s au plus (critère P2), puis la fin. */
export function resendAnnouncement(wait: number): string | null {
  if (wait === 0) return 'Vous pouvez renvoyer le code.';
  return wait % 15 === 0 ? `Renvoi du code possible dans ${wait} secondes.` : null;
}

/**
 * Vérifie le code dans l'onglet : `verifyOtp({ type: 'email' })` ouvre la session (claim `amr`
 * = `otp`, accepté par `club_self_serve_activate`). `sentAt` sépare un code faux d'un code expiré.
 */
export async function verifyEmailCode(client: SupabaseClient, email: string, code: string, sentAt: number | null): Promise<CodeResult> {
  try {
    const { error } = await client.auth.verifyOtp({ email: email.trim().toLowerCase(), token: code, type: 'email' });
    if (error) console.warn('[email-code] Verification refused', { status: error.status, code: error.code });
    return codeResult(error, sentAt);
  } catch { return 'failed'; }
}
