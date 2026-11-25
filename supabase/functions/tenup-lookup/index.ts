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
//   6. worker `kind: 'club-identity'`, délai 10 s, relancé chaque seconde tant qu'il est occupé → 504 `tenup_unavailable` (délai, Queue-it, worker
//      occupé ou en erreur) ; 404 `not_found` (club inconnu de Ten'Up, page sans JSON-LD) ;
//   7. logo et bandeau copiés de `cmsclub.fft.fr` dans `content-images/_lookup/<id>/` (signature
//      PNG / JPEG / WebP, ≤ 5 Mo) : jamais d'URL Ten'Up dans la réponse ;
//   8. logo « retouché » (W3, brief §13.4) : le worker le nettoie (`kind: 'logo'`, sharp), délai 4 s,
//      variantes PNG déposées à côté de l'original ; échec → original seul, jamais d'erreur ;
//   9. cache écrit, réponse avec un `lookup_token` signé (HMAC, 2 h) que `club-signup` vérifiera.
//
// POST { lookup_token, teams: true } (P2, ligne « N équipes en championnat » de la carte 02) : après
// l'identité, le tunnel demande la page des rencontres du club. Jeton vérifié (il prouve une lecture
// Turnstile récente), compte du cache (24 h), sinon limite par IP puis worker `kind: 'club'`. Le
// worker ne lit qu'une page à la fois : occupé, lent ou en erreur → `{ teams: null }` (la ligne
// n'apparaît pas), jamais d'erreur bloquante.
// Aucune donnée personnelle (ni téléphone, ni e-mail, ni bureau) n'est gardée ni renvoyée.
// Rien n'est journalisé de l'IP, du lien ni du contenu lu.
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { isTenupImageUrl, normalizeTenupClubProfileUrl, tenupClubIdOf, validateTenupClubProfile } from '../../../shared/tenupSite.mjs';
import { LOGO_VARIANTS, validateLogoResult } from '../../../shared/tenupLogo.mjs';
import { validateTenupClub } from '../../../shared/tenupClub.mjs';
import { signLookupToken, validLookupSecret, verifyLookupToken } from '../_shared/lookup-token.ts';
import { clientIp } from '../_shared/client-ip.ts';

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
/** W3 : nettoyage du logo, ~0,3 s mesuré ; au-delà, la carte garde l'original. */
const LOGO_TIMEOUT_MS = 4_000;
const MAX_LOGO_RESPONSE = 4 * 1024 * 1024;
/** Retours PR #277, M6 : le worker ne lit qu'une page à la fois. Occupé (429), l'identité attend son
 *  tour dans son délai de 10 s : une lecture facultative « équipes » (~4 s) ne fait plus échouer celle
 *  d'un autre visiteur. La lecture « équipes », elle, renonce aussitôt. */
const BUSY_RETRY_MS = 1_000;
/** P2 : page des rencontres, ~3 à 6 s mesurés ; au-delà, la carte s'affiche sans la ligne. */
const TEAMS_TIMEOUT_MS = 12_000;
const UNAVAILABLE = { error: 'Ten’Up ne répond pas pour le moment.', reason: 'tenup_unavailable' };
const FAILED = { error: 'Recherche momentanément indisponible.', reason: 'error' };

type Admin = ReturnType<typeof createClient>;
type LogoChanges = { background: 'black' | 'white' | 'color' | null; trimmed: boolean; upscaled: boolean };
type LogoSource = { width: number; height: number; format: string };
type Cached = {
  name: string; street: string; postal_code: string; city: string; sports: string[]; courts: number | null; logo_path: string | null; banner_path: string | null;
  /** W3 : absents d'une lecture antérieure ou d'un nettoyage en échec (la carte garde l'original). */
  logo_verdict?: 'cleaned' | 'unchanged' | 'monogram';
  logo_clean_path?: string; logo_variants?: Record<string, string>; logo_changes?: LogoChanges;
  logo_palette?: string[]; logo_source?: LogoSource;
  /** P2 : équipes et championnats de la page des rencontres, lus après l'identité. */
  teams_count?: number; championships_count?: number; teams_read_at?: string;
};
type LogoOutcome = Pick<Cached, 'logo_verdict' | 'logo_clean_path' | 'logo_variants' | 'logo_changes' | 'logo_palette' | 'logo_source'>;

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

/**
 * W3 : le worker nettoie le logo (`kind: 'logo'`, sharp) ; les variantes PNG sont déposées dans
 * `_lookup/<id>/<ts>-logo-<variante>.png`. Délai, réponse hors contrat, dépôt incomplet → `{}` :
 * l'original reste, sans erreur.
 */
async function pimpLogo(admin: Admin, call: (body: unknown, ms: number) => Promise<Response>, tenupId: string, source: string, stamp: number): Promise<LogoOutcome> {
  if (!source || !isTenupImageUrl(source)) return {};
  let result;
  try {
    const response = await call({ kind: 'logo', url: source }, LOGO_TIMEOUT_MS);
    if (!response.ok) return {};
    const text = await response.text();
    if (text.length > MAX_LOGO_RESPONSE) return {};
    result = validateLogoResult(JSON.parse(text));
  } catch { return {}; }
  if (!result) return {};
  const base: LogoOutcome = { logo_verdict: result.verdict, ...(result.palette.length ? { logo_palette: result.palette } : {}), ...(result.source ? { logo_source: result.source } : {}) };
  if (result.verdict !== 'cleaned' || !result.variants) return base;
  const variants = result.variants as Record<string, string>;
  const paths: Record<string, string> = {};
  const uploads = await Promise.all(LOGO_VARIANTS.map(async (name) => {
    const path = `_lookup/${tenupId}/${stamp}-logo-${name}.png`;
    const bytes = Uint8Array.from(atob(variants[name]), (c) => c.charCodeAt(0));
    const { error } = await admin.storage.from(BUCKET).upload(path, bytes, { contentType: 'image/png', cacheControl: '3600' });
    if (!error) paths[name] = path;
    return !error;
  }));
  if (!uploads.every(Boolean)) {
    const done = Object.values(paths);
    if (done.length) await admin.storage.from(BUCKET).remove(done).catch(() => undefined);
    return {};
  }
  return { ...base, logo_clean_path: paths['clean-1024'], logo_variants: paths, logo_changes: result.changes };
}

type Worker = { call: (body: unknown, ms: number) => Promise<Response> } | null;
function workerFrom(env: (key: string) => string | undefined): Worker {
  const worker = env('TENUP_WORKER_URL');
  const workerToken = env('TENUP_WORKER_TOKEN');
  if (!worker || !workerToken) return null;
  const endpoint = new URL(worker);
  if (endpoint.pathname === '/') endpoint.pathname = '/extract';
  const workerHeaders: Record<string, string> = { Authorization: `Bearer ${workerToken}`, 'Content-Type': 'application/json' };
  const bypass = env('TENUP_WORKER_BYPASS_TOKEN');
  if (bypass) workerHeaders['x-vercel-protection-bypass'] = bypass;
  return { call: (body: unknown, ms: number) => fetch(endpoint, {
    method: 'POST', redirect: 'error', signal: AbortSignal.timeout(ms), headers: workerHeaders, body: JSON.stringify(body),
  }) };
}

/** P2 : « N équipes en championnat » (carte 02). Jamais bloquant : `teams: null` dès qu'un doute. */
async function teamsCount(admin: Admin, req: Request, secret: string, token: unknown): Promise<Response> {
  const proof = await verifyLookupToken(secret, token);
  if (!proof) return json(400, { error: 'Lecture expirée.', reason: 'lookup_expired' });
  const tenupId = proof.tenup_club_id;
  const none = json(200, { ok: true, teams: null });
  const { data: row, error } = await admin.from('tenup_lookup_cache').select('payload, images, read_at').eq('tenup_club_id', tenupId).maybeSingle();
  if (error || !row) return none;
  const payload = row.payload as Cached;
  if (Number.isInteger(payload.teams_count) && payload.teams_read_at && Date.now() - new Date(payload.teams_read_at).getTime() < CACHE_MS) {
    return json(200, { ok: true, teams: payload.teams_count, championships: payload.championships_count ?? null, cached: true });
  }
  const { data: allowed, error: throttleError } = await admin.rpc('tenup_lookup_throttle', { p_ip: await sha256(clientIp(req)) });
  if (throttleError) return none;
  if (allowed !== true) return json(429, { error: 'Trop de recherches depuis votre connexion.', reason: 'throttled' });
  const worker = workerFrom((key) => Deno.env.get(key));
  if (!worker) return none;
  let page;
  try {
    // Occupé (429), lent, Queue-it, réponse hors contrat : la ligne n'apparaît pas.
    const response = await worker.call({ kind: 'club', url: `https://tenup.fft.fr/club/${tenupId}/competitions/rencontres` }, TEAMS_TIMEOUT_MS);
    if (!response.ok) return none;
    const text = await response.text();
    if (text.length > 500_000) return none;
    page = validateTenupClub(JSON.parse(text));
  } catch { return none; }
  const teams = page.teams.length;
  const championships = new Set(page.teams.map((team: { competition: string }) => team.competition)).size;
  await admin.from('tenup_lookup_cache').upsert({ ...row, tenup_club_id: tenupId,
    payload: { ...payload, teams_count: teams, championships_count: championships, teams_read_at: new Date().toISOString() } });
  return json(200, { ok: true, teams, championships, cached: false });
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
  let body: { url?: unknown; turnstile_token?: unknown; lookup_token?: unknown; teams?: unknown };
  try { body = JSON.parse(raw); } catch { return json(400, { error: 'Requête invalide.' }); }

  // P2 : nombre d'équipes, sur preuve d'une lecture récente (le jeton remplace Turnstile).
  if (body?.teams === true) {
    try {
      return await teamsCount(createClient(supabaseUrl, serviceKey, { auth: { persistSession: false, autoRefreshToken: false } }), req, lookupSecret, body.lookup_token);
    } catch { return json(200, { ok: true, teams: null }); }
  }

  // 1. Lien (aucun appel externe pour un lien refusé).
  let url: string;
  try { url = normalizeTenupClubProfileUrl(body?.url); } catch (err) { return json(400, { error: (err as Error).message, reason: 'bad_link' }); }
  const tenupId = tenupClubIdOf(url)!;

  // 2. Turnstile.
  const ip = clientIp(req); // `cf-connecting-ip` d'abord : réécrit par Cloudflare, non falsifiable
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
      // W3 : le logo retouché n'existe qu'à côté de l'original copié.
      const variants = logo && payload.logo_variants && LOGO_VARIANTS.every((name) => typeof payload.logo_variants?.[name] === 'string')
        ? Object.fromEntries(LOGO_VARIANTS.map((name) => [name, publicUrl(payload.logo_variants![name])])) : null;
      const verdict = logo && payload.logo_verdict && (payload.logo_verdict !== 'cleaned' || variants) ? payload.logo_verdict : null;
      return json(200, {
        ok: true, tenup_club_id: tenupId, name: payload.name,
        ...(payload.street ? { street: payload.street } : {}),
        ...(payload.postal_code ? { postal_code: payload.postal_code } : {}),
        ...(payload.city ? { city: payload.city } : {}),
        sports: payload.sports,
        ...(payload.courts !== null ? { courts: payload.courts } : {}),
        ...(logo ? { logo_url: logo } : {}), ...(banner ? { banner_url: banner } : {}),
        ...(verdict ? { logo_verdict: verdict } : {}),
        ...(verdict && payload.logo_palette?.length ? { logo_palette: payload.logo_palette } : {}),
        ...(verdict && payload.logo_source ? { logo_source: payload.logo_source } : {}),
        ...(verdict === 'cleaned' && variants ? { logo_clean_url: variants['clean-1024'], logo_variants: variants, logo_changes: payload.logo_changes } : {}),
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

    // 6. Worker : la page « Le club » seule. Il lit une page à la fois : occupé (429), on attend son
    // tour dans les 10 s ; au-delà, `tenup_unavailable` et le tunnel propose de réessayer.
    const worker = workerFrom((key) => Deno.env.get(key));
    if (!worker) return json(504, UNAVAILABLE);
    const callWorker = worker.call;
    let profile;
    try {
      const deadline = Date.now() + WORKER_TIMEOUT_MS;
      let response = await callWorker({ kind: 'club-identity', url }, WORKER_TIMEOUT_MS);
      while (response.status === 429 && Date.now() + BUSY_RETRY_MS < deadline) {
        await response.body?.cancel();
        await new Promise((resolve) => setTimeout(resolve, BUSY_RETRY_MS));
        response = await callWorker({ kind: 'club-identity', url }, Math.max(1, deadline - Date.now()));
      }
      if (response.status === 404) return json(404, { error: 'Club introuvable sur Ten’Up.', reason: 'not_found' });
      if (!response.ok) return json(504, UNAVAILABLE);
      const text = await response.text();
      if (text.length > 50_000) return json(504, UNAVAILABLE);
      profile = validateTenupClubProfile(JSON.parse(text), url);
    } catch { return json(504, UNAVAILABLE); }

    // 7. Images copiées chez nous (le tunnel ne montre jamais d'URL cmsclub). 8. En même temps, le
    // logo nettoyé : APRÈS la lecture d'identité (le worker ne lit qu'une page à la fois), sans
    // Chromium, 4 s au plus ; ses variantes ne valent que si l'original est copié.
    const stamp = Date.now();
    const [logoPath, bannerPath, pimped] = await Promise.all([
      copyImage(admin, tenupId, profile.club.logo, 'logo', stamp),
      copyImage(admin, tenupId, profile.club.banner, 'banner', stamp),
      pimpLogo(admin, callWorker, tenupId, profile.club.logo, stamp),
    ]);
    const logo: LogoOutcome = logoPath ? pimped : {};
    if (!logoPath && pimped.logo_variants) await admin.storage.from(BUCKET).remove(Object.values(pimped.logo_variants)).catch(() => undefined);
    const payload: Cached = {
      name: profile.club.name, street: profile.club.street, postal_code: profile.club.postal_code, city: profile.club.city,
      sports: profile.club.sports, courts: profile.club.courts_count ?? null, logo_path: logoPath, banner_path: bannerPath, ...logo,
    };
    const images = [logoPath, bannerPath, ...Object.values(logo.logo_variants ?? {})].filter((p): p is string => Boolean(p));
    const readAt = new Date(stamp).toISOString();

    // 9. Cache, puis suppression des images de la lecture précédente (plus de 24 h).
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
