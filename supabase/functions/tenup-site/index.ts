// SaaS S8b — lecture du profil Ten'Up d'un club pour préremplir son site (brief SAAS_10_S8b).
//
// POST { club_id, url }          : lecture au premier plan (lien collé dans `/admin/site`).
// POST { club_id, background }   : lecture en tâche de fond, à la fin de l'import des équipes, avec
//                                   l'identifiant Ten'Up déjà enregistré ; réponse immédiate (202).
// Contrôle SQL d'abord (`club_tenup_site_begin` : admin, pas `internal`, une lecture réussie par
// club et par 24 h, 3 échecs au plus), puis le worker (`kind: 'club-profile'`), la validation de
// sa réponse, la copie des images dans `content-images/<club>/config/` et la proposition, écrite
// avec la clé service. Rien n'est écrit dans `club_settings.config` : l'admin relit et enregistre.
// Aucun journal du contenu lu (noms du bureau).
import { normalizeTenupClubProfileUrl, tenupClubIdOf, validateTenupClubProfile, isTenupImageUrl } from '../../../shared/tenupSite.mjs';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const headers = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Content-Type': 'application/json', 'Cache-Control': 'no-store',
};
const json = (status: number, body: unknown) => new Response(JSON.stringify(body), { status, headers });
const BUCKET = 'content-images';
const MAX_IMAGE = 5 * 1024 * 1024;
const UNAVAILABLE = 'Ten’Up n’a pas pu être lu pour le moment. Réessayez plus tard, ou remplissez le site à la main.';

// Signature, pas le type annoncé : PNG, JPEG ou WebP seulement (pas de SVG sur un bucket public).
function imageType(bytes: Uint8Array): { type: string; ext: string } | null {
  const starts = (...sig: number[]) => sig.every((b, i) => bytes[i] === b);
  if (starts(0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a)) return { type: 'image/png', ext: 'png' };
  if (starts(0xff, 0xd8, 0xff)) return { type: 'image/jpeg', ext: 'jpg' };
  if (starts(0x52, 0x49, 0x46, 0x46) && String.fromCharCode(...bytes.slice(8, 12)) === 'WEBP') return { type: 'image/webp', ext: 'webp' };
  return null;
}

type Admin = ReturnType<typeof createClient>;

/** Copie une image du CMS FFT dans le bucket du club. Les images Ten'Up sont déjà servies
 * optimisées (WebP de 8 à 75 Ko relevés le 14/11/2026) : pas de recompression, mais la taille et
 * la signature sont contrôlées. `null` : image illisible, signalée à la relecture. */
async function copyImage(admin: Admin, clubId: string, source: string, name: string): Promise<{ url: string; path: string } | null> {
  if (!isTenupImageUrl(source)) return null;
  try {
    const response = await fetch(source, { redirect: 'error', signal: AbortSignal.timeout(10_000), headers: { Accept: 'image/webp,image/png,image/jpeg' } });
    if (!response.ok || Number(response.headers.get('content-length') ?? 0) > MAX_IMAGE) return null;
    const bytes = new Uint8Array(await response.arrayBuffer());
    const kind = imageType(bytes);
    if (bytes.length === 0 || bytes.length > MAX_IMAGE || !kind) return null;
    const path = `${clubId}/config/${Date.now()}-tenup-${name}.${kind.ext}`;
    const { error } = await admin.storage.from(BUCKET).upload(path, bytes, { contentType: kind.type, cacheControl: '3600' });
    if (error) return null;
    return { url: admin.storage.from(BUCKET).getPublicUrl(path).data.publicUrl, path };
  } catch { return null; }
}

async function readProfile(admin: Admin, clubId: string, tenupId: string, readId: string) {
  const fail = async () => {
    await admin.from('club_tenup_site_reads').update({ status: 'failed' }).eq('id', readId);
    return null;
  };
  try {
    const worker = Deno.env.get('TENUP_WORKER_URL');
    const token = Deno.env.get('TENUP_WORKER_TOKEN');
    if (!worker || !token) return await fail();
    const endpoint = new URL(worker);
    if (endpoint.pathname === '/') endpoint.pathname = '/extract';
    const workerHeaders: Record<string, string> = { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' };
    const bypass = Deno.env.get('TENUP_WORKER_BYPASS_TOKEN');
    if (bypass) workerHeaders['x-vercel-protection-bypass'] = bypass;
    const url = `https://tenup.fft.fr/club/${tenupId}`;
    const response = await fetch(endpoint, {
      method: 'POST', redirect: 'error', signal: AbortSignal.timeout(50_000), headers: workerHeaders,
      body: JSON.stringify({ kind: 'club-profile', url }),
    });
    if (!response.ok) return await fail();
    const raw = await response.text();
    if (raw.length > 300_000) return await fail();
    const profile = validateTenupClubProfile(JSON.parse(raw), url);

    // Les images de la proposition précédente non enregistrée ne servent plus à rien.
    const { data: previous } = await admin.from('club_tenup_site_proposals').select('images, status').eq('club_id', clubId).maybeSingle();
    const logo = profile.club.logo ? await copyImage(admin, clubId, profile.club.logo, 'logo') : null;
    const banner = profile.club.banner ? await copyImage(admin, clubId, profile.club.banner, 'bandeau') : null;
    const image_errors = [profile.club.logo && !logo ? 'logo' : null, profile.club.banner && !banner ? 'banner' : null].filter(Boolean);
    const payload = { ...profile, club: { ...profile.club, logo: logo?.url ?? '', banner: banner?.url ?? '' }, image_errors };
    const images = [logo?.path, banner?.path].filter(Boolean);
    const { error } = await admin.from('club_tenup_site_proposals').upsert({
      club_id: clubId, tenup_club_id: tenupId, payload, images, status: 'ready', read_at: new Date().toISOString(),
    });
    if (error) {
      if (images.length) await admin.storage.from(BUCKET).remove(images);
      return await fail();
    }
    if (previous?.status === 'ready' && previous.images?.length) await admin.storage.from(BUCKET).remove(previous.images);
    await admin.from('club_tenup_site_reads').update({ status: 'done' }).eq('id', readId);
    await admin.from('clubs').update({ tenup_club_id: tenupId }).eq('id', clubId);
    return payload;
  } catch {
    return await fail();
  }
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers });
  if (req.method !== 'POST') return json(405, { error: 'Méthode non autorisée.' });
  try {
    const authorization = req.headers.get('Authorization');
    if (!authorization?.startsWith('Bearer ')) return json(401, { error: 'Connexion requise.' });
    const raw = await req.text();
    if (raw.length > 2048) return json(413, { error: 'Requête trop volumineuse.' });
    let body;
    try { body = JSON.parse(raw); } catch { return json(400, { error: 'Requête invalide.' }); }
    const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
    if (!body || typeof body !== 'object' || !uuid.test(body.club_id)) return json(400, { error: 'Requête invalide.' });
    const background = body.background === true;
    let tenupId: string | null = null;
    if (!background) {
      try { tenupId = tenupClubIdOf(normalizeTenupClubProfileUrl(body.url)); } catch (err) { return json(400, { error: (err as Error).message }); }
    }
    const client = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_ANON_KEY')!, { global: { headers: { Authorization: authorization } } });
    const { data: { user }, error: authError } = await client.auth.getUser();
    if (authError || !user) return json(401, { error: 'Session expirée. Reconnectez-vous.' });
    if (!Deno.env.get('TENUP_WORKER_URL') || !Deno.env.get('TENUP_WORKER_TOKEN')) {
      return json(503, { error: 'La lecture Ten’Up n’est pas encore disponible. Remplissez le site à la main.' });
    }
    const { data: begun, error } = await client.rpc('club_tenup_site_begin', { p_club: body.club_id, p_tenup_id: tenupId, p_background: background });
    if (error) return json(error.code === '42501' ? 403 : 400, { error: error.message });
    if (!begun?.started) return json(200, { started: false, reason: begun?.reason ?? null });
    const admin = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!);
    const read = readProfile(admin, body.club_id, begun.tenup_club_id, begun.read_id);
    if (background) {
      // Le fondateur est encore dans les premiers pas : on ne le fait pas attendre.
      (globalThis as { EdgeRuntime?: { waitUntil: (p: Promise<unknown>) => void } }).EdgeRuntime?.waitUntil(read);
      return json(202, { started: true });
    }
    const payload = await read;
    return payload ? json(200, { started: true, payload }) : json(502, { error: UNAVAILABLE });
  } catch {
    return json(502, { error: UNAVAILABLE });
  }
});
