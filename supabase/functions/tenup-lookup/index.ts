// Supabase Edge Function — tenup-lookup (onboarding « Ten'Up d'abord », brief SAAS_11 §4.3).
// Un inconnu colle le lien Ten'Up de son club AVANT de s'inscrire : on lit la seule page « Le club »
// et on renvoie de quoi afficher « C'est bien votre club ? ». Publique (`verify_jwt = false`).
//
// POST { url, turnstile_token } :
//   1. lien ramené à la racine du club (`normalizeTenupClubProfileUrl`), sinon 400 `bad_link` ;
//   2. Turnstile, sinon 403 `turnstile` ;
//   3. club déjà rattaché (`clubs.tenup_club_id`, club `pending` compris) → réponse immédiate
//      `already_on_feelike: true`, sans lecture, avec au plus le nom Ten'Up du cache ;
//   4. cache de 24 h (`tenup_lookup_cache`) → réponse sans lecture, `cached: true` ;
//   5. limite `tenup_lookup_throttle` (20 lectures / h / IP ; le cache ne compte pas) → 429 ;
//   6. worker `kind: 'club-identity'`, délai 10 s → 504 `tenup_unavailable` (délai, Queue-it, worker
//      occupé ou en erreur) ; 404 `not_found` (club inconnu de Ten'Up, page sans JSON-LD) ;
//   7. logo et bandeau copiés de `cmsclub.fft.fr` dans `content-images/_lookup/<id>/` (signature
//      PNG / JPEG / WebP, ≤ 5 Mo) : jamais d'URL Ten'Up dans la réponse ;
//   8. cache écrit, réponse avec un `lookup_token` signé (HMAC, 2 h) que `club-signup` vérifiera.
// Aucune donnée personnelle (ni téléphone, ni e-mail, ni bureau) n'est gardée ni renvoyée.
// Rien n'est journalisé de l'IP, du lien ni du contenu lu.
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { isTenupImageUrl, normalizeTenupClubProfileUrl, tenupClubIdOf, validateTenupClubProfile } from '../../../shared/tenupSite.mjs';
import { signLookupToken, validLookupSecret } from '../_shared/lookup-token.ts';

const headers = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Content-Type': 'application/json', 'Cache-Control': 'no-store',
};
const json = (status: number, body: unknown) => new Response(JSON.stringify(body), { status, headers });
const BUCKET = 'content-images';
const MAX_IMAGE = 5 * 1024 * 1024;
const CACHE_MS = 24 * 60 * 60 * 1000;
const WORKER_TIMEOUT_MS = 10_000;
const UNAVAILABLE = { error: 'Ten’Up ne répond pas pour le moment.', reason: 'tenup_unavailable' };
const FAILED = { error: 'Recherche momentanément indisponible.', reason: 'error' };

type Admin = ReturnType<typeof createClient>;
type Cached = { name: string; street: string; postal_code: string; city: string; sports: string[]; courts: number | null; logo_path: string | null; banner_path: string | null };

function imageType(bytes: Uint8Array): { type: string; ext: string } | null {
  const starts = (...sig: number[]) => sig.every((b, i) => bytes[i] === b);
  if (starts(0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a)) return { type: 'image/png', ext: 'png' };
  if (starts(0xff, 0xd8, 0xff)) return { type: 'image/jpeg', ext: 'jpg' };
  if (starts(0x52, 0x49, 0x46, 0x46) && String.fromCharCode(...bytes.slice(8, 12)) === 'WEBP') return { type: 'image/webp', ext: 'webp' };
  return null;
}

/** Même contrôle que `tenup-site` : hôte `cmsclub.fft.fr`, taille, signature. `null` : image
 * illisible, la carte affichera les initiales. */
async function copyImage(admin: Admin, tenupId: string, source: string, name: string, stamp: number): Promise<string | null> {
  if (!source || !isTenupImageUrl(source)) return null;
  try {
    const response = await fetch(source, { redirect: 'error', signal: AbortSignal.timeout(5_000), headers: { Accept: 'image/webp,image/png,image/jpeg' } });
    if (!response.ok || Number(response.headers.get('content-length') ?? 0) > MAX_IMAGE) return null;
    const bytes = new Uint8Array(await response.arrayBuffer());
    const kind = imageType(bytes);
    if (bytes.length === 0 || bytes.length > MAX_IMAGE || !kind) return null;
    const path = `_lookup/${tenupId}/${stamp}-${name}.${kind.ext}`;
    const { error } = await admin.storage.from(BUCKET).upload(path, bytes, { contentType: kind.type, cacheControl: '3600' });
    return error ? null : path;
  } catch { return null; }
}

async function sha256(value: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value));
  return Array.from(new Uint8Array(digest)).map((b) => b.toString(16).padStart(2, '0')).join('');
}

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers });
  if (req.method !== 'POST') return json(405, { error: 'Méthode non autorisée.' });
  const supabaseUrl = Deno.env.get('SUPABASE_URL');
  const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
  const turnstileSecret = Deno.env.get('TURNSTILE_SECRET_KEY');
  const lookupSecret = Deno.env.get('LOOKUP_HMAC_SECRET');
  if (!supabaseUrl || !serviceKey || !turnstileSecret || !validLookupSecret(lookupSecret)) return json(503, FAILED);

  const raw = await req.text().catch(() => '');
  if (raw.length > 4096) return json(413, { error: 'Requête trop volumineuse.' });
  let body: { url?: unknown; turnstile_token?: unknown };
  try { body = JSON.parse(raw); } catch { return json(400, { error: 'Requête invalide.' }); }

  // 1. Lien (aucun appel externe pour un lien refusé).
  let url: string;
  try { url = normalizeTenupClubProfileUrl(body?.url); } catch (err) { return json(400, { error: (err as Error).message, reason: 'bad_link' }); }
  const tenupId = tenupClubIdOf(url)!;

  // 2. Turnstile.
  const ip = req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() || req.headers.get('cf-connecting-ip') || 'unknown';
  const token = body?.turnstile_token;
  if (typeof token !== 'string' || !token || token.length > 2048) return json(403, { error: 'Vérification anti-robot requise.', reason: 'turnstile' });
  try {
    const check = await fetch('https://challenges.cloudflare.com/turnstile/v0/siteverify', {
      method: 'POST', signal: AbortSignal.timeout(5000),
      body: new URLSearchParams({ secret: turnstileSecret, response: token, ...(ip === 'unknown' ? {} : { remoteip: ip }) }),
    });
    const outcome = await check.json();
    if (!check.ok || outcome?.success !== true) return json(403, { error: 'Vérification anti-robot échouée.', reason: 'turnstile' });
  } catch { return json(503, FAILED); }

  const admin = createClient(supabaseUrl, serviceKey, { auth: { persistSession: false, autoRefreshToken: false } });
  try {
    const { data: cachedRow, error: cacheError } = await admin.from('tenup_lookup_cache')
      .select('payload, images, read_at').eq('tenup_club_id', tenupId).maybeSingle();
    if (cacheError) return json(500, FAILED);

    // 3. Déjà sur feelike : aucune donnée du club existant, seulement le nom Ten'Up déjà lu.
    const { data: taken, error: takenError } = await admin.from('clubs').select('id').eq('tenup_club_id', tenupId).limit(1);
    if (takenError) return json(500, FAILED);
    if (taken?.length) {
      const name = (cachedRow?.payload as Cached | undefined)?.name;
      return json(200, { ok: true, tenup_club_id: tenupId, already_on_feelike: true, ...(name ? { name } : {}) });
    }

    const respond = async (payload: Cached, readAt: string, cached: boolean) => {
      const publicUrl = (path: string | null) => path ? admin.storage.from(BUCKET).getPublicUrl(path).data.publicUrl : null;
      const logo = publicUrl(payload.logo_path), banner = publicUrl(payload.banner_path);
      return json(200, {
        ok: true, tenup_club_id: tenupId, name: payload.name,
        ...(payload.street ? { street: payload.street } : {}),
        ...(payload.postal_code ? { postal_code: payload.postal_code } : {}),
        ...(payload.city ? { city: payload.city } : {}),
        sports: payload.sports,
        ...(payload.courts !== null ? { courts: payload.courts } : {}),
        ...(logo ? { logo_url: logo } : {}), ...(banner ? { banner_url: banner } : {}),
        already_on_feelike: false, cached, read_at: readAt,
        lookup_token: await signLookupToken(lookupSecret, tenupId, readAt),
      });
    };

    // 4. Cache de 24 h : ni lecture ni décompte.
    if (cachedRow && Date.now() - new Date(cachedRow.read_at).getTime() < CACHE_MS) {
      return await respond(cachedRow.payload as Cached, cachedRow.read_at, true);
    }

    // 5. Limite par IP (empreinte seulement), comptée pour chaque lecture qui part vers le worker.
    const { data: allowed, error: throttleError } = await admin.rpc('tenup_lookup_throttle', { p_ip: await sha256(ip) });
    if (throttleError) return json(500, FAILED);
    if (allowed !== true) return json(429, { error: 'Trop de recherches depuis votre connexion.', reason: 'throttled' });

    // 6. Worker : la page « Le club » seule. Il lit une page à la fois : un import en cours le rend
    // occupé (429), ce qui donne ici `tenup_unavailable` ; le tunnel propose de réessayer.
    const worker = Deno.env.get('TENUP_WORKER_URL');
    const workerToken = Deno.env.get('TENUP_WORKER_TOKEN');
    if (!worker || !workerToken) return json(504, UNAVAILABLE);
    const endpoint = new URL(worker);
    if (endpoint.pathname === '/') endpoint.pathname = '/extract';
    const workerHeaders: Record<string, string> = { Authorization: `Bearer ${workerToken}`, 'Content-Type': 'application/json' };
    const bypass = Deno.env.get('TENUP_WORKER_BYPASS_TOKEN');
    if (bypass) workerHeaders['x-vercel-protection-bypass'] = bypass;
    let profile;
    try {
      const response = await fetch(endpoint, {
        method: 'POST', redirect: 'error', signal: AbortSignal.timeout(WORKER_TIMEOUT_MS), headers: workerHeaders,
        body: JSON.stringify({ kind: 'club-identity', url }),
      });
      if (response.status === 404) return json(404, { error: 'Club introuvable sur Ten’Up.', reason: 'not_found' });
      if (!response.ok) return json(504, UNAVAILABLE);
      const text = await response.text();
      if (text.length > 50_000) return json(504, UNAVAILABLE);
      profile = validateTenupClubProfile(JSON.parse(text), url);
    } catch { return json(504, UNAVAILABLE); }

    // 7. Images copiées chez nous (le tunnel ne montre jamais d'URL cmsclub).
    const stamp = Date.now();
    const [logoPath, bannerPath] = await Promise.all([
      copyImage(admin, tenupId, profile.club.logo, 'logo', stamp),
      copyImage(admin, tenupId, profile.club.banner, 'banner', stamp),
    ]);
    const payload: Cached = {
      name: profile.club.name, street: profile.club.street, postal_code: profile.club.postal_code, city: profile.club.city,
      sports: profile.club.sports, courts: profile.club.courts_count ?? null, logo_path: logoPath, banner_path: bannerPath,
    };
    const images = [logoPath, bannerPath].filter((p): p is string => Boolean(p));
    const readAt = new Date(stamp).toISOString();

    // 8. Cache, puis suppression des images de la lecture précédente (plus de 24 h).
    const { error: saveError } = await admin.from('tenup_lookup_cache')
      .upsert({ tenup_club_id: tenupId, payload, images, read_at: readAt });
    if (saveError) {
      if (images.length) await admin.storage.from(BUCKET).remove(images).catch(() => undefined);
      return json(500, FAILED);
    }
    const stale = ((cachedRow?.images ?? []) as string[]).filter((p) => !images.includes(p));
    if (stale.length) await admin.storage.from(BUCKET).remove(stale).catch(() => undefined);
    return await respond(payload, readAt, false);
  } catch {
    return json(500, FAILED);
  }
});
