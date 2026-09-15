import type { SupabaseClient } from '@supabase/supabase-js';

// Installed alongside the client, before React mounts: the recovery event can
// precede the reset page. No token is copied into storage.
export function trackPasswordRecovery(client: SupabaseClient) {
  const key = 'tmc-password-recovery';
  let recovery: { userId: string; expiresAt: number } | null = null;
  try {
    const saved = JSON.parse(sessionStorage.getItem(key) || 'null');
    if (typeof saved?.userId === 'string' && saved.expiresAt > Date.now()) recovery = saved;
  } catch { /* Storage may be unavailable in private browsing. */ }

  function clear() {
    recovery = null;
    try { sessionStorage.removeItem(key); } catch { /* In-memory fallback. */ }
  }
  // A failed/reused link must not fall back to a previously valid session.
  const params = new URLSearchParams(window.location.hash.slice(1));
  const query = new URLSearchParams(window.location.search);
  if (params.has('error') || params.has('error_code') || query.has('error') || query.has('error_code') || params.has('access_token') || query.has('code')) clear();

  client.auth.onAuthStateChange((event, session) => {
    if (event === 'PASSWORD_RECOVERY' && session) {
      recovery = { userId: session.user.id, expiresAt: Date.now() + 60 * 60 * 1000 };
      try { sessionStorage.setItem(key, JSON.stringify(recovery)); } catch { /* In-memory fallback. */ }
    } else if (event === 'SIGNED_OUT' || (session && recovery && session.user.id !== recovery.userId)) {
      clear();
    }
  });
  return {
    clear,
    isReady(userId: string) {
      return recovery?.userId === userId && recovery.expiresAt > Date.now();
    },
  };
}
