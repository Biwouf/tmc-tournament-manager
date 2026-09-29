import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
const headers = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Content-Type': 'application/json', 'Cache-Control': 'no-store',
};
const json = (status: number, body: unknown) => new Response(JSON.stringify(body), { status, headers });
Deno.serve(async req => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers });
  if (req.method !== 'POST') return json(405, { error: 'Méthode non autorisée.' });
  try {
    const authorization = req.headers.get('Authorization');
    if (!authorization?.startsWith('Bearer ')) return json(401, { error: 'Connexion requise.' });
    const client = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_ANON_KEY')!, { global: { headers: { Authorization: authorization } } });
    const { data: { user }, error: authError } = await client.auth.getUser();
    if (authError || !user) return json(401, { error: 'Session expirée. Reconnectez-vous.' });
    // The worker address is deployment configuration, never client-controlled.
    const worker = Deno.env.get('TENUP_WORKER_URL');
    const token = Deno.env.get('TENUP_WORKER_TOKEN');
    if (!worker || !token) return json(503, { error: 'La synchronisation Ten’Up n’est pas encore disponible. La saisie manuelle reste possible.' });
    const raw = await req.text();
    if (raw.length > 2048) return json(413, { error: 'Requête trop volumineuse.' });
    let body;
    try { body = JSON.parse(raw); } catch { return json(400, { error: 'Requête invalide.' }); }
    const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
    if (!uuid.test(body.club_id) || !uuid.test(body.rencontre_id) || typeof body.url !== 'string') return json(400, { error: 'Requête invalide.' });
    const url = body.url.trim().replace(/\/$/, '');
    // SQL checks membership, club status, rate limit, URL and existing binding.
    const { data: preview, error } = await client.rpc('team_tenup_begin', { p_club: body.club_id, p_rencontre: body.rencontre_id, p_url: url });
    if (error) return json(error.code === '42501' ? 403 : 400, { error: error.message });
    const response = await fetch(new URL('/extract', worker), {
      method: 'POST', redirect: 'error', signal: AbortSignal.timeout(50_000),
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }, body: JSON.stringify({ url }),
    });
    if (!response.ok) return json(502, { error: 'Ten’Up est indisponible ou la feuille n’est pas complète. Réessayez plus tard ou saisissez les résultats manuellement.' });
    const data = await response.text();
    if (data.length > 50_000) return json(502, { error: 'Feuille Ten’Up illisible.' });
    const payload = JSON.parse(data);
    if (!Array.isArray(payload.lines) || payload.lines.length > 6 || !Array.isArray(payload.teams) || payload.teams.length !== 2) return json(502, { error: 'Feuille Ten’Up illisible.' });
    const admin = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!);
    const { error: saveError } = await admin.from('team_tenup_previews').update({ payload }).eq('id', preview.id).eq('actor_id', user.id);
    if (saveError) return json(500, { error: 'Impossible de préparer l’aperçu.' });
    return json(200, { id: preview.id, url, ...payload });
  } catch {
    return json(502, { error: 'Synchronisation indisponible. Réessayez plus tard ; aucun résultat n’a été modifié.' });
  }
});
