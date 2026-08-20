// Appel générique d'une Edge Function Supabase, avec le parsing d'erreur non trivial :
// sur une réponse non-2xx, `invokeErr.message` est générique ("non-2xx status") et le
// vrai message — en français, destiné à l'UI — se trouve dans le body.
//
// Extrait de `lib/invite.ts` en PR5-bis, quand une 2ᵉ function (`club-members`) a eu
// besoin du même traitement : ce parsing doit être écrit une seule fois.
import { supabase } from './supabase';

// Les functions maison répondent toutes l'enveloppe { success, error } (+ leur payload).
export type EdgeResult<T> = ({ success: true } & T) | { success: false; error: string };

export async function invokeEdgeFunction<T>(
  name: string,
  body: Record<string, unknown>,
  fallbackError = 'Erreur inconnue lors de l’appel au serveur.',
): Promise<EdgeResult<T>> {
  const { data, error: invokeErr } = await supabase.functions.invoke(name, { body });
  if (invokeErr) {
    const ctx = (invokeErr as { context?: unknown }).context;
    let detail: string | null = null;
    if (ctx instanceof Response) {
      try {
        const parsed = await ctx.clone().json();
        if (parsed && typeof parsed.error === 'string') detail = parsed.error;
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
  const payload = data as ({ success?: boolean; error?: string } & T) | null;
  if (!payload?.success) {
    return { success: false, error: payload?.error ?? fallbackError };
  }
  return payload as { success: true } & T;
}
