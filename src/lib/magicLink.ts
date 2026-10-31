// SaaS S4 — connexion et activation par lien magique, sans mot de passe.
import type { SupabaseClient } from '@supabase/supabase-js';
import type { Club } from '../contexts/ClubContext';

/** Écran d'arrivée après l'activation d'un club self-serve (provisoire en S4, S5 le remplace). */
export const FIRST_STEPS_PATH = '/premiers-pas';

/** `error_code` d'un lien d'auth refusé (fragment en implicite, requête en PKCE), sinon null. */
export function authLinkError(href: string): string | null {
  const url = new URL(href);
  const hash = new URLSearchParams(url.hash.slice(1));
  const code = hash.get('error_code') || url.searchParams.get('error_code');
  if (code) return code;
  return hash.has('error') || url.searchParams.has('error') ? 'unspecified_code' : null;
}

// Lu au chargement du module, avant toute redirection du routeur : supabase-js laisse l'erreur
// dans l'URL, mais un `<Navigate to="/login">` la perdrait.
export const initialLinkError = authLinkError(window.location.href);

/** Club visé par `?inscription=<slug>` (posé par `club-signup`), même règle que le hook d'e-mail. */
export function inscriptionSlug(href: string): string | null {
  const hints = new URL(href).searchParams.getAll('inscription');
  return hints.length === 1 && /^[a-z0-9-]{3,32}$/.test(hints[0]) ? hints[0] : null;
}

/** Club ouvert d'office : celui de `?inscription`, puis le choix de la session, puis le seul club actif. */
export function pickAdminClub(clubs: Club[], saved: string | null, inscription: string | null): { club?: Club; firstSteps: boolean } {
  const fresh = inscription ? clubs.find(club => club.slug === inscription) : undefined;
  if (fresh) return { club: fresh, firstSteps: true };
  return { club: clubs.find(club => club.id === saved) ?? (clubs.length === 1 ? clubs[0] : undefined), firstSteps: false };
}

/** Retour du lien : la racine de cet hôte, avec le club d'inscription s'il est connu. */
export function magicLinkRedirect(origin: string, inscription: string | null): string {
  return `${origin}/` + (inscription ? `?inscription=${encodeURIComponent(inscription)}` : '');
}

/**
 * Envoie un lien de connexion. `shouldCreateUser: false` : le BO reste sur invitation, aucun
 * compte n'est créé. Réponse identique que l'adresse ait un compte ou non (GoTrue refuse une
 * adresse inconnue en 4xx) ; seuls la limite de débit et une panne sont signalées.
 */
export async function requestMagicLink(client: SupabaseClient, email: string, emailRedirectTo: string): Promise<'sent' | 'rate_limited' | 'failed'> {
  try {
    const { error } = await client.auth.signInWithOtp({ email: email.trim(), options: { shouldCreateUser: false, emailRedirectTo } });
    if (!error) return 'sent';
    // Identifiants seulement : jamais l'adresse ni la réponse brute.
    console.warn('[magic-link] Request failed', { status: error.status, code: error.code });
    if (error.status === 429) return 'rate_limited';
    return error.status && error.status < 500 ? 'sent' : 'failed';
  } catch {
    return 'failed';
  }
}

export const MAGIC_LINK_MESSAGES = {
  sent: 'Si un compte correspond à cette adresse, vous allez recevoir un lien de connexion. Pensez à vérifier vos spams.',
  rate_limited: 'Trop de demandes. Patientez quelques minutes avant de réessayer.',
  failed: 'L’envoi n’a pas pu aboutir. Vérifiez votre connexion puis réessayez.',
} as const;
