// Supabase Edge Function — contact-form
// Réception du formulaire de contact du site vitrine (PR11, décision D7).
// Spec : docs/specs/MULTI_TENANT.md §7 + docs/briefs/web_site_brief.md §5.6.
//
// ⚠️ C'EST LA PREMIÈRE FUNCTION APPELÉE PAR UN VISITEUR NON AUTHENTIFIÉ.
// `invite-user`, `club-members` et `social-credentials` exigent toutes une session et un
// rôle : leur prologue (auth.getUser + lecture de `club_members` + contrôle de rôle) est
// délibérément ABSENT ici — il refuserait tout le monde. Ce qui le remplace : honeypot,
// bornes de longueur, validation et rate-limit par IP hachée (§5 du brief). Le contrôle de
// `clubs.status` reste, lui, en place — un club suspendu ne reçoit pas de message.
//
// Le reste du prologue (CORS, client service role, enveloppe { success, error } en
// français) est volontairement dupliqué depuis `social-credentials` : les functions Deno
// sont indépendantes, c'est le patron maison. Ne pas factoriser.
//
// L'ORDRE DE LA SÉQUENCE EST LA DÉCISION DE CONCEPTION DE CETTE FUNCTION :
// honeypot → validation → club → rate-limit → INSERT → email → 200.
// L'insert précède l'email, jamais l'inverse. Une panne Brevo, une clé expirée ou un
// domaine non vérifié ne doivent pas faire perdre le message d'un visiteur : la BASE est la
// source de vérité, l'email n'est que la notification. Répondre 200 dès que la ligne est
// écrite est la conséquence directe de ce choix — le club verra le message dans
// `/admin/messages` même si aucun email n'est jamais parti.

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { renderEmail, type EmailBrand } from '../_shared/email-template.ts';

// CORS ouvert, comme les trois autres functions : le site public appelle depuis
// `<slug>.feelike.pro` et il n'existe pas encore de wildcard à autoriser nommément.
const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers':
    'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

// Bornes de longueur (§5.2) — un message de 200 ko n'est pas un message.
const LIMITS = {
  first_name: 100,
  last_name: 100,
  email: 255,
  phone: 30,
  message: 5000,
};
const MESSAGE_MIN = 10;

// Rate-limit (§5.3) : au-delà de 5 messages en 15 minutes pour un même `ip_hash`, tous
// clubs confondus, on refuse. Compter par club laisserait un bot arroser les clubs un par un.
const RATE_LIMIT_MAX = 5;
const RATE_LIMIT_WINDOW_MS = 15 * 60 * 1000;

interface RequestBody {
  club_id?: string;
  first_name?: string;
  last_name?: string;
  email?: string;
  phone?: string;
  message?: string;
  website?: string; // honeypot — cf. plus bas
}

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' },
  });
}

// Volontairement permissive : la validation d'email par expression régulière ne peut pas
// être exacte, et un formulaire de contact n'a pas à arbitrer les cas tordus de la RFC. Ce
// filtre attrape la faute de frappe (« jean.dupont@gmail », « jean dupont@ »), pas le
// fraudeur — l'adresse sert de `replyTo`, une adresse fausse ne nuit qu'à son auteur.
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

// Secret stable partagé entre les instances pour le comptage antispam.
const IP_SALT = Deno.env.get('CONTACT_IP_SALT');

async function hashIp(ip: string): Promise<string> {
  const digest = await crypto.subtle.digest(
    'SHA-256',
    new TextEncoder().encode(`${ip}${IP_SALT}`),
  );
  return Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

// Derrière le proxy Supabase, l'IP du client est en tête de `x-forwarded-for`.
function clientIp(req: Request): string | null {
  const forwarded = req.headers.get('x-forwarded-for');
  const first = forwarded?.split(',')[0]?.trim();
  return first || null;
}

// Notification Brevo (D7 : provider FR/EU pour l'argument RGPD).
// Ne LÈVE jamais et ne fait jamais échouer la requête : à ce stade le message est déjà en
// base. Le retour dit seulement si le club a été notifié, et pourquoi non le cas échéant.
async function notifyClub(params: {
  to: string;
  clubName: string;
  brand: EmailBrand;
  firstName: string;
  lastName: string;
  email: string;
  phone: string | null;
  message: string;
}): Promise<{ sent: boolean; error: string | null }> {
  const apiKey = Deno.env.get('BREVO_API_KEY');
  const from = Deno.env.get('CONTACT_FROM_EMAIL');

  // Cas nominal tant que les prérequis Brevo (compte, clé, DNS `feelike.pro`) ne sont pas
  // en place — brief §1. On journalise et on continue : le message est enregistré.
  if (!apiKey || !from) {
    console.warn('[contact-form] BREVO_API_KEY ou CONTACT_FROM_EMAIL absent — message ' +
      'enregistré, aucune notification envoyée.');
    return { sent: false, error: 'Notification par email non configurée sur le serveur.' };
  }

  const fullName = `${params.firstName} ${params.lastName}`.trim();
  const lines = [
    `De : ${fullName} <${params.email}>`,
    params.phone ? `Téléphone : ${params.phone}` : null,
    '',
    params.message,
  ].filter((l) => l !== null);

  const rendered = renderEmail(params.brand, {
    title: 'Nouveau message depuis le site',
    paragraphs: lines.filter((line): line is string => typeof line === 'string'),
    footer: 'Répondez directement à cet email pour contacter l’expéditeur.',
  });

  try {
    const resp = await fetch('https://api.brevo.com/v3/smtp/email', {
      method: 'POST',
      headers: {
        'api-key': apiKey,
        'Content-Type': 'application/json',
        accept: 'application/json',
      },
      signal: AbortSignal.timeout(10000),
      body: JSON.stringify({
        sender: { email: from, name: params.clubName },
        to: [{ email: params.to }],
        // LE point de la décision D7 : le club répond en un clic, il ne configure rien.
        // Sans `replyTo`, la réponse partirait vers `contact@feelike.pro` — c'est-à-dire
        // nulle part — et le club croirait avoir répondu.
        replyTo: { email: params.email, name: fullName || params.email },
        subject: `Message du site — ${fullName || params.email}`,
        textContent: rendered.text,
        htmlContent: rendered.html,
      }),
    });

    if (!resp.ok) {
      console.error('[contact-form] Brevo error', { status: resp.status });
      return { sent: false, error: `Brevo a refusé l’envoi (HTTP ${resp.status}).` };
    }
    return { sent: true, error: null };
  } catch (e) {
    console.error('[contact-form] Brevo network error', String(e));
    return { sent: false, error: 'Erreur réseau lors de l’envoi de la notification.' };
  }
}

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { status: 204, headers: CORS_HEADERS });
  }

  if (req.method !== 'POST') {
    return jsonResponse(405, { success: false, error: 'Méthode non autorisée.' });
  }

  let body: RequestBody;
  try {
    body = await req.json();
  } catch {
    return jsonResponse(400, { success: false, error: 'Body JSON invalide.' });
  }

  if (!body || typeof body !== 'object' || Array.isArray(body) ||
      Object.values(body).some(value => typeof value !== 'string')) {
    return jsonResponse(400, { success: false, error: 'Champs du formulaire invalides.' });
  }

  // --- 1. Honeypot ---------------------------------------------------------
  // `website` est un champ masqué en CSS que seul un robot remplit. On répond « message
  // envoyé » et on n'écrit RIEN : on ne dit jamais à un bot qu'il a été repéré, sinon
  // l'auteur du bot corrige et revient. Le succès simulé est la mesure, pas un effet de bord.
  if (typeof body.website === 'string' && body.website.trim() !== '') {
    console.warn('[contact-form] honeypot déclenché', { club_id: body.club_id });
    return jsonResponse(200, { success: true, email_sent: false });
  }

  // --- 2. Validation -------------------------------------------------------
  // Messages en FRANÇAIS : le front les affiche tels quels (patron `lib/functions.ts`).
  const clubId = body.club_id?.trim();
  const firstName = body.first_name?.trim() ?? '';
  const lastName = body.last_name?.trim() ?? '';
  const email = body.email?.trim() ?? '';
  const phone = body.phone?.trim() || null;
  const message = body.message?.trim() ?? '';

  if (!clubId) {
    return jsonResponse(400, { success: false, error: 'Club manquant.' });
  }
  for (const [value, label, max] of [
    [firstName, 'Le prénom', LIMITS.first_name],
    [lastName, 'Le nom', LIMITS.last_name],
  ] as const) {
    if (!value) return jsonResponse(400, { success: false, error: `${label} est obligatoire.` });
    if (value.length > max) {
      return jsonResponse(400, {
        success: false,
        error: `${label} ne doit pas dépasser ${max} caractères.`,
      });
    }
  }
  if (!email) {
    return jsonResponse(400, { success: false, error: 'L’adresse email est obligatoire.' });
  }
  if (email.length > LIMITS.email || !EMAIL_RE.test(email)) {
    return jsonResponse(400, { success: false, error: 'L’adresse email n’est pas valide.' });
  }
  if (phone && phone.length > LIMITS.phone) {
    return jsonResponse(400, {
      success: false,
      error: `Le téléphone ne doit pas dépasser ${LIMITS.phone} caractères.`,
    });
  }
  if (message.length < MESSAGE_MIN) {
    return jsonResponse(400, {
      success: false,
      error: `Le message doit faire au moins ${MESSAGE_MIN} caractères.`,
    });
  }
  if (message.length > LIMITS.message) {
    return jsonResponse(400, {
      success: false,
      error: `Le message ne doit pas dépasser ${LIMITS.message} caractères.`,
    });
  }

  const supabaseUrl = Deno.env.get('SUPABASE_URL');
  const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
  if (!supabaseUrl || !serviceRoleKey || !IP_SALT) {
    return jsonResponse(500, {
      success: false,
      error: 'Configuration Supabase manquante côté serveur.',
    });
  }
  const supabaseAdmin = createClient(supabaseUrl, serviceRoleKey);

  // --- 3. Club : il existe, et il est actif --------------------------------
  const { data: club, error: clubErr } = await supabaseAdmin
    .from('clubs').select('name, status').eq('id', clubId).maybeSingle();
  if (clubErr) {
    console.error('[contact-form] club lookup error', { clubId, message: clubErr.message });
    return jsonResponse(500, { success: false, error: 'Vérification du club impossible.' });
  }
  if (!club) {
    return jsonResponse(404, { success: false, error: 'Club introuvable.' });
  }
  // Pas d'échappatoire super-admin ici, contrairement aux functions du BO : l'appelant est
  // un visiteur anonyme, il n'y a personne à qui accorder un accès de support.
  if (club.status !== 'active') {
    return jsonResponse(403, {
      success: false,
      error: 'Ce club ne reçoit pas de message pour le moment.',
    });
  }

  // --- 4. Rate-limit -------------------------------------------------------
  const ip = clientIp(req);
  // Pas d'IP lisible (appel hors proxy, en local) : on ne bloque pas et on ne stocke rien
  // — un `ip_hash` constant pour tous les appels sans IP ferait porter la limite commune à
  // des visiteurs sans rapport entre eux.
  const ipHash = ip ? await hashIp(ip) : null;

  if (ipHash) {
    const since = new Date(Date.now() - RATE_LIMIT_WINDOW_MS).toISOString();
    const { count, error: countErr } = await supabaseAdmin
      .from('contact_messages')
      .select('id', { count: 'exact', head: true })
      .eq('ip_hash', ipHash)
      .gte('created_at', since);

    if (countErr) {
      console.error('[contact-form] rate limit lookup error', { message: countErr.message });
      return jsonResponse(503, { success: false, error: 'Formulaire temporairement indisponible. Réessayez plus tard.' });
    } else if ((count ?? 0) >= RATE_LIMIT_MAX) {
      return jsonResponse(429, {
        success: false,
        error: 'Trop de messages envoyés depuis cette connexion. Réessayez dans quelques minutes.',
      });
    }
  }

  // --- 5. INSERT — avant l'email, jamais après -----------------------------
  const { error: insertErr } = await supabaseAdmin
    .from('contact_messages')
    .insert({
      club_id: clubId,
      first_name: firstName,
      last_name: lastName,
      email,
      phone,
      message,
      ip_hash: ipHash,
    });

  if (insertErr) {
    console.error('[contact-form] insert error', { clubId, message: insertErr.message });
    return jsonResponse(500, {
      success: false,
      error: 'Enregistrement du message impossible. Réessayez dans un instant.',
    });
  }

  // --- 6. Notification du club --------------------------------------------
  // Destinataire = `club_settings.config.contact.email` (contrat PR6d), et non une colonne
  // de `clubs` : les coordonnées publiques du club vivent dans le JSONB de configuration.
  const { data: settings, error: settingsErr } = await supabaseAdmin
    .from('club_settings').select('config').eq('club_id', clubId).maybeSingle();
  if (settingsErr) {
    console.error('[contact-form] settings lookup error', { clubId, message: settingsErr.message });
  }
  const recipient =
    (settings?.config as { contact?: { email?: string } } | null)?.contact?.email?.trim() || null;

  let emailSent = false;
  let emailError: string | null = null;

  if (!recipient) {
    // Le club n'a pas renseigné son email de contact dans `/admin/site`. Le message est
    // enregistré et visible au BO — il n'est pas perdu — mais personne n'est prévenu.
    console.warn('[contact-form] club sans contact.email — message enregistré, non notifié', {
      clubId,
    });
    emailError = 'Ce club n’a pas encore renseigné son adresse de contact : ' +
      'votre message a bien été enregistré, mais sa réception peut être retardée.';
  } else {
    const notified = await notifyClub({
      to: recipient,
      clubName: club.name ?? 'Club',
      brand: { name: club.name ?? 'Club', color: settings?.config?.brand?.color, logo: settings?.config?.brand?.logo },
      firstName,
      lastName,
      email,
      phone,
      message,
    });
    emailSent = notified.sent;
    emailError = notified.error;
  }

  // --- 7. 200 dès que l'insert a réussi ------------------------------------
  // `email_sent` distingue « message enregistré ET club notifié » de « message enregistré
  // seulement » — même esprit que `resendClubInvite` dans `lib/clubMembers.ts`, qui
  // distingue déjà « email parti » de « lien régénéré ». Le formulaire de la vitrine
  // (lot B) décide quoi en montrer ; il ne doit en aucun cas le traiter comme un échec.
  return jsonResponse(200, { success: true, email_sent: emailSent, email_error: emailError });
});
