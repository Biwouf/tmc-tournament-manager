// Supabase Edge Function — invite-user
// Envoie une invitation par email à un nouvel utilisateur.
// Spec : docs/briefs/INVITE_ONLY_AUTH.md

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers':
    'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

interface RequestBody {
  email?: string;
  redirectTo?: string;
  // 'send' (défaut) : envoie l'email d'invitation via Supabase.
  // 'generate-link' : ne déclenche pas d'email, retourne juste le lien à copier.
  action?: 'send' | 'generate-link';
}

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' },
  });
}

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { status: 204, headers: CORS_HEADERS });
  }

  if (req.method !== 'POST') {
    return jsonResponse(405, { success: false, error: 'Méthode non autorisée.' });
  }

  // --- Auth ---
  const authHeader = req.headers.get('Authorization') ?? '';
  if (!authHeader.toLowerCase().startsWith('bearer ')) {
    return jsonResponse(401, {
      success: false,
      error: 'Erreur d’authentification — reconnectez-vous.',
    });
  }

  const supabaseUrl = Deno.env.get('SUPABASE_URL');
  const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');

  if (!supabaseUrl || !serviceRoleKey) {
    return jsonResponse(500, {
      success: false,
      error: 'Configuration Supabase manquante côté serveur.',
    });
  }

  // Vérifie que le JWT correspond bien à un user authentifié.
  const supabaseAuthClient = createClient(supabaseUrl, serviceRoleKey, {
    global: { headers: { Authorization: authHeader } },
  });
  const { data: userData, error: userErr } = await supabaseAuthClient.auth.getUser();
  if (userErr || !userData?.user) {
    return jsonResponse(401, {
      success: false,
      error: 'Erreur d’authentification — reconnectez-vous.',
    });
  }

  // --- Body ---
  let body: RequestBody;
  try {
    body = await req.json();
  } catch {
    return jsonResponse(400, { success: false, error: 'Body JSON invalide.' });
  }
  const email = body.email?.trim();
  if (!email) {
    return jsonResponse(400, { success: false, error: 'Email manquant.' });
  }
  const redirectTo = body.redirectTo?.trim();
  const action = body.action ?? 'send';

  // --- Invitation via service role ---
  // Supabase rejette les redirectTo absents de la whitelist (Auth → URL Configuration),
  // c'est la whitelist côté dashboard qui fait foi pour la sécurité.
  const supabaseAdmin = createClient(supabaseUrl, serviceRoleKey);

  if (action === 'generate-link') {
    // Bypass de l'email (rate limit du SMTP par défaut, ou partage manuel).
    const { data, error: linkErr } = await supabaseAdmin.auth.admin.generateLink({
      type: 'invite',
      email,
      options: redirectTo ? { redirectTo } : undefined,
    });
    if (linkErr || !data?.properties?.action_link) {
      console.error('[invite-user] generateLink error', {
        email,
        redirectTo,
        message: linkErr?.message,
        status: (linkErr as { status?: number } | null)?.status,
      });
      return jsonResponse(400, {
        success: false,
        error: linkErr?.message ?? 'Génération du lien impossible.',
      });
    }
    return jsonResponse(200, {
      success: true,
      action_link: data.properties.action_link,
    });
  }

  const { error: inviteErr } = await supabaseAdmin.auth.admin.inviteUserByEmail(
    email,
    redirectTo ? { redirectTo } : undefined,
  );
  if (inviteErr) {
    console.error('[invite-user] inviteUserByEmail error', {
      email,
      redirectTo,
      message: inviteErr.message,
      status: (inviteErr as { status?: number }).status,
      name: inviteErr.name,
    });
    return jsonResponse(400, { success: false, error: inviteErr.message });
  }

  return jsonResponse(200, { success: true });
});
