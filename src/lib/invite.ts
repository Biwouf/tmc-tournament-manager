// Appel de l'Edge Function `invite-user`, partagé entre l'invitation d'un membre par
// l'admin d'un club (InvitePage) et l'invitation du premier admin d'un club fraîchement
// provisionné par le super-admin (SuperAdminPage).
//
// Extrait de InvitePage en PR5 : le parsing d'erreur ci-dessous (lire le vrai message
// dans le body d'une réponse non-2xx) est la seule partie non triviale, il ne doit pas
// être dupliqué.
//
// Contrat de la function (PR4) : { email, redirectTo, action, club_id, role }.
// `club_id` et `role` sont obligatoires, et l'autorisation est vérifiée côté serveur
// (admin du club demandé, ou super-admin) — le club envoyé par le front ne fait pas foi.
import { supabase } from './supabase';

export type InvokeResult =
  | { success: true; action_link?: string; already_existed?: boolean }
  | { success: false; error: string };

export async function invokeInvite(body: Record<string, unknown>): Promise<InvokeResult> {
  const { data, error: invokeErr } = await supabase.functions.invoke('invite-user', {
    body,
  });
  if (invokeErr) {
    // `invokeErr.message` est générique ("non-2xx status"). On essaie de lire
    // le body de la réponse pour récupérer le vrai message d'erreur.
    const ctx = (invokeErr as { context?: unknown }).context;
    let detail: string | null = null;
    if (ctx instanceof Response) {
      try {
        const body = await ctx.clone().json();
        if (body && typeof body.error === 'string') detail = body.error;
      } catch {
        try {
          detail = (await ctx.clone().text()) || null;
        } catch {
          // ignore
        }
      }
    }
    return { success: false, error: detail ?? invokeErr.message };
  }
  const payload = data as {
    success?: boolean;
    error?: string;
    action_link?: string;
    already_existed?: boolean;
  } | null;
  if (!payload?.success) {
    return {
      success: false,
      error: payload?.error ?? 'Erreur inconnue lors de l’envoi de l’invitation.',
    };
  }
  return {
    success: true,
    action_link: payload.action_link,
    already_existed: payload.already_existed,
  };
}
