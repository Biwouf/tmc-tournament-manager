// Supabase Edge Function — club-signup-purge (SaaS S2).
// Purge quotidienne des clubs self-serve jamais activés (7 jours en `pending`), appelée par
// pg_cron (supabase/scripts/club-signup-purge-cron.sql), en-tête
// `x-club-signup-purge-secret` = CLUB_SIGNUP_PURGE_SECRET.
//
// Ordre : fichiers (API Storage — la base refuse un DELETE direct sur storage.objects),
// puis club en SQL (`club_self_serve_purge`, qui revérifie l'état), puis comptes nés de
// l'inscription et sans autre appartenance (API Auth). Un échec laisse le club `pending` :
// le passage suivant reprend.
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const BUCKET = 'content-images';
const json = (status: number, body: unknown) => Response.json(body, { status, headers: { 'Cache-Control': 'no-store' } });

function sameSecret(a: string, b: string): boolean {
  const x = new TextEncoder().encode(a), y = new TextEncoder().encode(b);
  let diff = x.length ^ y.length;
  for (let i = 0; i < Math.max(x.length, y.length); i++) diff |= (x[i] ?? 0) ^ (y[i] ?? 0);
  return diff === 0;
}

Deno.serve(async (req: Request) => {
  if (req.method !== 'POST') return json(405, { error: 'Method not allowed' });
  const secret = Deno.env.get('CLUB_SIGNUP_PURGE_SECRET');
  const url = Deno.env.get('SUPABASE_URL');
  const key = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
  if (!secret || secret.length < 32 || !url || !key) return json(503, { error: 'Purge not configured' });
  if (!sameSecret(req.headers.get('x-club-signup-purge-secret') || '', secret)) return json(401, { error: 'Unauthorized' });

  const admin = createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
  const { data: clubs, error } = await admin.rpc('club_self_serve_purge_begin', { p_limit: 50 });
  if (error) return json(500, { error: 'Purge failed' });
  let purged = 0, accounts = 0, failed = 0;
  for (const clubId of (clubs || []) as string[]) {
    try {
      const folder = `${clubId}/config`;
      const { data: objects, error: listError } = await admin.storage.from(BUCKET).list(folder, { limit: 1000 });
      if (listError) throw listError;
      if (objects?.length) {
        const { error: removeError } = await admin.storage.from(BUCKET).remove(objects.map(o => `${folder}/${o.name}`));
        if (removeError) throw removeError;
      }
      const { data: users, error: purgeError } = await admin.rpc('club_self_serve_purge', { p_club: clubId });
      if (purgeError) throw purgeError;
      purged++;
      for (const userId of (users || []) as string[]) {
        const { error: deleteError } = await admin.auth.admin.deleteUser(userId);
        if (deleteError) throw deleteError;
        accounts++;
      }
    } catch {
      failed++;
      console.error('[club-signup-purge] club purge failed', { clubId });
    }
  }
  return json(failed ? 500 : 200, { purged, accounts, failed });
});
