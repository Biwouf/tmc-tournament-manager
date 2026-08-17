// Supabase Edge Function — invite-user
// Envoie une invitation par email à un nouvel utilisateur, et le rattache au club
// invitant avec le rôle choisi.
// Spec : docs/briefs/INVITE_ONLY_AUTH.md + docs/specs/MULTI_TENANT.md (§4, D5)
//
// Multi-tenant (PR4) : `club_id` + `role` sont obligatoires. L'appelant doit être
// admin du club demandé (ou super-admin) — c'est ce contrôle, et non le club envoyé
// par le front, qui détermine le rattachement. La ligne `club_members` est créée dès
// l'émission de l'invitation : `inviteUserByEmail` / `generateLink` créent le compte
// `auth.users` immédiatement, et l'invité ne peut pas se connecter avant d'avoir
// choisi son mot de passe. Rien à faire à l'acceptation.

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers':
    'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

const CLUB_ROLES = ['admin', 'manager', 'member'] as const;
type ClubRole = (typeof CLUB_ROLES)[number];

interface RequestBody {
  email?: string;
  redirectTo?: string;
  // 'send' (défaut) : envoie l'email d'invitation via Supabase.
  // 'generate-link' : ne déclenche pas d'email, retourne juste le lien à copier.
  action?: 'send' | 'generate-link';
  club_id?: string;
  role?: string;
}

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' },
  });
}

// Supabase répond `email_exists` (422) quand l'email a déjà un compte auth.users.
// Le code d'erreur n'est apparu que dans les versions récentes de GoTrue : on teste
// aussi le message pour ne pas dépendre de la version déployée.
function isEmailExists(err: { code?: string; message?: string } | null): boolean {
  if (!err) return false;
  if (err.code === 'email_exists') return true;
  const msg = err.message?.toLowerCase() ?? '';
  return msg.includes('already been registered') || msg.includes('already exists');
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
  const callerId = userData.user.id;

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
  const clubId = body.club_id?.trim();
  if (!clubId) {
    return jsonResponse(400, { success: false, error: 'Club manquant.' });
  }
  const role = body.role?.trim() as ClubRole | undefined;
  if (!role || !CLUB_ROLES.includes(role)) {
    return jsonResponse(400, {
      success: false,
      error: `Rôle invalide — attendu : ${CLUB_ROLES.join(', ')}.`,
    });
  }
  const redirectTo = body.redirectTo?.trim();
  const action = body.action ?? 'send';

  const supabaseAdmin = createClient(supabaseUrl, serviceRoleKey);

  // --- Autorisation : admin du club demandé, ou super-admin ---
  // Lecture en service role (la RLS `club_members_select_own` ne verrait que le
  // caller, ce qui suffit ici, mais on ne dépend pas du JWT du client).
  const [{ data: membership, error: membershipErr }, { data: profile, error: profileErr }] =
    await Promise.all([
      supabaseAdmin
        .from('club_members')
        .select('role')
        .eq('club_id', clubId)
        .eq('user_id', callerId)
        .maybeSingle(),
      supabaseAdmin
        .from('profiles')
        .select('is_super_admin')
        .eq('id', callerId)
        .maybeSingle(),
    ]);

  if (membershipErr || profileErr) {
    console.error('[invite-user] authorization lookup error', {
      callerId,
      clubId,
      membership: membershipErr?.message,
      profile: profileErr?.message,
    });
    return jsonResponse(500, {
      success: false,
      error: 'Vérification des droits impossible.',
    });
  }

  const isSuperAdmin = profile?.is_super_admin === true;
  if (!isSuperAdmin && membership?.role !== 'admin') {
    return jsonResponse(403, {
      success: false,
      error:
        'Seul un administrateur de ce club peut inviter un utilisateur.',
    });
  }

  // Rattachement au club. Un compte créé sans appartenance est exactement le bug
  // que PR4 corrige : un échec ici doit remonter en erreur, pas passer en silence.
  const attachMember = async (userId: string): Promise<Response | null> => {
    const { error } = await supabaseAdmin
      .from('club_members')
      .upsert({ club_id: clubId, user_id: userId, role }, { onConflict: 'club_id,user_id' });
    if (error) {
      console.error('[invite-user] club_members upsert error', {
        email,
        clubId,
        role,
        userId,
        message: error.message,
      });
      return jsonResponse(500, {
        success: false,
        error:
          'Le compte a été créé mais son rattachement au club a échoué. Contactez l’administrateur de la plateforme.',
      });
    }
    return null;
  };

  // Compte déjà existant (invité sur un 2ᵉ club) : on ne renvoie pas d'email, on
  // rattache le compte existant. `auth.admin.listUsers()` n'expose pas de filtre par
  // email, d'où l'appel direct à l'endpoint admin GoTrue : `filter` y est une
  // recherche partielle (email/téléphone) → on revérifie l'égalité stricte. Si une
  // version de GoTrue ignorait `filter`, on retombe sur les 100 premiers comptes,
  // dans lesquels l'égalité stricte cherche quand même.
  const attachExistingAccount = async (): Promise<Response> => {
    const res = await fetch(
      `${supabaseUrl}/auth/v1/admin/users?per_page=100&filter=${encodeURIComponent(email)}`,
      { headers: { apikey: serviceRoleKey, Authorization: `Bearer ${serviceRoleKey}` } },
    );
    const payload = res.ok
      ? ((await res.json()) as { users?: { id: string; email?: string }[] })
      : null;
    const existing = payload?.users?.find(
      (u) => u.email?.toLowerCase() === email.toLowerCase(),
    );
    if (!existing) {
      console.error('[invite-user] existing account lookup failed', {
        email,
        clubId,
        status: res.status,
      });
      return jsonResponse(400, {
        success: false,
        error:
          'Un compte existe déjà avec cet email, mais il n’a pas pu être retrouvé pour le rattacher au club.',
      });
    }
    const failure = await attachMember(existing.id);
    if (failure) return failure;
    return jsonResponse(200, { success: true, already_existed: true });
  };

  // --- Invitation via service role ---
  // Supabase rejette les redirectTo absents de la whitelist (Auth → URL Configuration),
  // c'est la whitelist côté dashboard qui fait foi pour la sécurité.

  if (action === 'generate-link') {
    // Bypass de l'email (rate limit du SMTP par défaut, ou partage manuel).
    const { data, error: linkErr } = await supabaseAdmin.auth.admin.generateLink({
      type: 'invite',
      email,
      options: redirectTo ? { redirectTo } : undefined,
    });
    if (isEmailExists(linkErr)) return await attachExistingAccount();
    if (linkErr || !data?.properties?.action_link || !data.user?.id) {
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
    const failure = await attachMember(data.user.id);
    if (failure) return failure;
    return jsonResponse(200, {
      success: true,
      action_link: data.properties.action_link,
    });
  }

  const { data: inviteData, error: inviteErr } =
    await supabaseAdmin.auth.admin.inviteUserByEmail(
      email,
      redirectTo ? { redirectTo } : undefined,
    );
  if (isEmailExists(inviteErr)) return await attachExistingAccount();
  if (inviteErr || !inviteData?.user?.id) {
    console.error('[invite-user] inviteUserByEmail error', {
      email,
      redirectTo,
      message: inviteErr?.message,
      status: (inviteErr as { status?: number } | null)?.status,
      name: inviteErr?.name,
    });
    return jsonResponse(400, {
      success: false,
      error: inviteErr?.message ?? 'Invitation impossible.',
    });
  }
  const failure = await attachMember(inviteData.user.id);
  if (failure) return failure;

  return jsonResponse(200, { success: true });
});
