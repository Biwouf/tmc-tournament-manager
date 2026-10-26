// Supabase Edge Function — club-signup (SaaS S2).
// Un inconnu crée son club en essai : spec docs/specs/SAAS_ONBOARDING.md.
//
// Publique, sans session : Turnstile → limite de débit → validation → compte → fichiers →
// création SQL atomique (`club_self_serve_create`) → lien magique. Le club reste `pending`
// jusqu'au premier passage par ce lien (`club_self_serve_activate`, appelé par le BO).
//
// La réponse ne dit jamais si l'adresse avait déjà un compte : même statut, même corps.
// Rien n'est journalisé de l'adresse, de l'IP, du jeton ni des fichiers.
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { signupSlugProblem } from '../../../shared/clubSlug.mjs';

const headers = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Content-Type': 'application/json', 'Cache-Control': 'no-store',
};
const json = (status: number, body: unknown) => new Response(JSON.stringify(body), { status, headers });

const BUCKET = 'content-images';
const MAX_FILE = 5 * 1024 * 1024;
// Deux images de 5 Mo et les champs texte, encodage multipart compris.
const MAX_BODY = 2 * MAX_FILE + 64 * 1024;

// Le type déclaré par le navigateur ne fait pas foi : on lit la signature du fichier.
// Pas de SVG : il porterait du script sur un bucket public.
function imageType(bytes: Uint8Array): { type: string; ext: string } | null {
  const starts = (...sig: number[]) => sig.every((b, i) => bytes[i] === b);
  if (starts(0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a)) return { type: 'image/png', ext: 'png' };
  if (starts(0xff, 0xd8, 0xff)) return { type: 'image/jpeg', ext: 'jpg' };
  if (starts(0x52, 0x49, 0x46, 0x46) && String.fromCharCode(...bytes.slice(8, 12)) === 'WEBP') return { type: 'image/webp', ext: 'webp' };
  return null;
}

async function sha256(value: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value));
  return Array.from(new Uint8Array(digest)).map(b => b.toString(16).padStart(2, '0')).join('');
}

const text = (form: FormData, key: string) => {
  const value = form.get(key);
  return typeof value === 'string' ? value.trim() : '';
};

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers });
  if (req.method !== 'POST') return json(405, { error: 'Méthode non autorisée.' });
  const url = Deno.env.get('SUPABASE_URL');
  const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
  const anonKey = Deno.env.get('SUPABASE_ANON_KEY');
  const turnstileSecret = Deno.env.get('TURNSTILE_SECRET_KEY');
  const redirect = Deno.env.get('CLUB_SIGNUP_REDIRECT_URL') || 'https://admin.feelike.pro/';
  if (!url || !serviceKey || !anonKey || !turnstileSecret) return json(503, { error: 'Inscription momentanément indisponible.' });

  if (Number(req.headers.get('content-length') || 0) > MAX_BODY) return json(413, { error: 'Fichiers trop volumineux (5 Mo maximum chacun).' });
  let form: FormData;
  try { form = await req.formData(); } catch { return json(400, { error: 'Requête invalide.' }); }

  // 1. Turnstile, avant toute écriture.
  const ip = req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() || req.headers.get('cf-connecting-ip') || 'unknown';
  const token = text(form, 'turnstile_token');
  if (!token || token.length > 2048) return json(403, { error: 'Vérification anti-robot requise.' });
  try {
    const check = await fetch('https://challenges.cloudflare.com/turnstile/v0/siteverify', {
      method: 'POST', signal: AbortSignal.timeout(5000),
      body: new URLSearchParams({ secret: turnstileSecret, response: token, ...(ip === 'unknown' ? {} : { remoteip: ip }) }),
    });
    const outcome = await check.json();
    if (!check.ok || outcome?.success !== true) return json(403, { error: 'Vérification anti-robot échouée. Réessayez.' });
  } catch { return json(503, { error: 'Vérification anti-robot indisponible. Réessayez.' }); }

  // 2. Limite de débit, par IP et par adresse (empreintes seulement). Sans IP lisible
  // (appel hors proxy), tous ces appels partagent un seul compteur : on crée des comptes,
  // la limite reste donc fermée plutôt que levée.
  const email = text(form, 'email').toLowerCase();
  const admin = createClient(url, serviceKey, { auth: { persistSession: false, autoRefreshToken: false } });
  const { data: allowed, error: throttleError } = await admin.rpc('club_self_serve_throttle',
    { p_ip: await sha256(ip), p_email: await sha256(email) });
  if (throttleError) return json(500, { error: 'Inscription momentanément indisponible.' });
  if (allowed !== true) return json(429, { error: 'Trop de tentatives. Réessayez plus tard.' });

  // 3. Validation (la base revalide tout).
  const name = text(form, 'name'), city = text(form, 'city'), slug = text(form, 'slug');
  const sport = text(form, 'sport') || 'tennis', color = text(form, 'color');
  if (name.length < 2 || name.length > 80 || !city || city.length > 80 || sport !== 'tennis' ||
      !/^#[0-9a-fA-F]{6}$/.test(color) || email.length > 254 || !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) {
    return json(400, { error: 'Informations incomplètes ou invalides.' });
  }
  const problem = signupSlugProblem(slug);
  if (problem) return json(400, { error: 'Cette adresse n’est pas disponible.', reason: problem });
  const files: { field: string; data: Uint8Array; type: string; ext: string }[] = [];
  for (const [key, field] of [['logo', 'logo'], ['photo', 'hero-image']]) {
    const value = form.get(key);
    if (value === null || value === '') continue;
    if (typeof value === 'string') return json(400, { error: 'Fichier invalide.' });
    if (value.size > MAX_FILE) return json(413, { error: 'Fichiers trop volumineux (5 Mo maximum chacun).' });
    const data = new Uint8Array(await value.arrayBuffer());
    const kind = imageType(data);
    if (!kind) return json(400, { error: 'Image attendue : PNG, JPEG ou WebP.' });
    files.push({ field, data, ...kind });
  }

  // 4. Compte : créé s'il n'existe pas, sinon réutilisé. Marqué pour que la purge ne
  // supprime jamais qu'un compte né de cette inscription.
  let createdAccount: string | null = null;
  const { data: created, error: accountError } = await admin.auth.admin.createUser({
    email, email_confirm: true, app_metadata: { created_via: 'club_signup' },
  });
  if (created?.user) createdAccount = created.user.id;
  else if (accountError?.code !== 'email_exists' && accountError?.status !== 422) {
    return json(500, { error: 'Inscription momentanément indisponible.' });
  }

  // 5. Fichiers, même bucket et même convention que la configuration du site.
  const clubId = crypto.randomUUID();
  const stamp = Date.now();
  const uploaded: Record<string, string> = {};
  const rollback = async () => {
    const paths = Object.values(uploaded);
    if (paths.length) await admin.storage.from(BUCKET).remove(paths).catch(() => undefined);
    if (createdAccount) await admin.auth.admin.deleteUser(createdAccount).catch(() => undefined);
  };
  for (const file of files) {
    const path = `${clubId}/config/${stamp}-${file.field}.${file.ext}`;
    const { error } = await admin.storage.from(BUCKET).upload(path, file.data, { contentType: file.type, cacheControl: '3600' });
    if (error) { await rollback(); return json(500, { error: 'Envoi des images impossible. Réessayez.' }); }
    uploaded[file.field] = path;
  }
  const publicUrl = (field: string) => uploaded[field] ? admin.storage.from(BUCKET).getPublicUrl(uploaded[field]).data.publicUrl : null;

  // 6. Club, réglages et appartenance en une transaction.
  const { data: result, error: createError } = await admin.rpc('club_self_serve_create', {
    p_club: clubId, p_email: email, p_name: name, p_city: city, p_sport: sport, p_slug: slug,
    p_color: color, p_logo: publicUrl('logo'), p_hero_image: publicUrl('hero-image'),
  });
  if (createError) {
    await rollback();
    if (createError.code === 'PT409') return json(409, { error: 'Cette adresse est déjà prise.', reason: 'taken' });
    if (createError.code === 'PT400') return json(400, { error: 'Informations incomplètes ou invalides.' });
    return json(500, { error: 'Inscription momentanément indisponible.' });
  }
  // Rejeu sur un club déjà en attente : les nouveaux fichiers ne servent pas.
  if (result?.created === false && Object.keys(uploaded).length) {
    await admin.storage.from(BUCKET).remove(Object.values(uploaded)).catch(() => undefined);
  }

  // 7. Lien magique, envoyé par le hook `send-auth-email` (gabarit « Gardez votre club »).
  const target = new URL(redirect);
  target.searchParams.set('inscription', slug);
  const publicClient = createClient(url, anonKey, { auth: { persistSession: false, autoRefreshToken: false } });
  const { error: linkError } = await publicClient.auth.signInWithOtp({
    email, options: { shouldCreateUser: false, emailRedirectTo: target.href },
  });
  if (linkError) return json(502, { error: 'L’e-mail n’a pas pu être envoyé. Réessayez dans une minute.' });
  return json(200, { ok: true });
});
