// Supabase Edge Function — club-members
// Gestion des membres d'un club par un admin de ce club : lister, changer un rôle,
// retirer, relancer une invitation.
// Spec : docs/specs/MULTI_TENANT.md (§4, §4.2) + docs/briefs/PR5bis_gestion_membres.md
//
// Pourquoi une function et pas des policies RLS sur `club_members` (PR5-bis §4) :
// l'email et le statut « invitation en attente » vivent dans `auth.users`, hors de
// portée de la clé anon — le service role est de toute façon nécessaire pour que la
// liste soit lisible. Ouvrir en plus `club_members` en écriture au client donnerait
// deux sources pour la même liste, sur la table qui porte l'autorisation de toute
// l'app. `club_members` garde donc ses deux policies SELECT, et cette PR n'a aucune
// migration.
//
// Le prologue (CORS, auth, autorisation) est volontairement dupliqué depuis
// `invite-user` : les functions Deno sont indépendantes, c'est le patron maison.

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers':
    'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

const CLUB_ROLES = ['admin', 'manager', 'member'] as const;
type ClubRole = (typeof CLUB_ROLES)[number];

const ACTIONS = ['list', 'set-role', 'remove', 'resend-invite'] as const;
type Action = (typeof ACTIONS)[number];

interface RequestBody {
  club_id?: string;
  action?: string;
  user_id?: string;
  role?: string;
  redirectTo?: string;
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

  const clubId = body.club_id?.trim();
  if (!clubId) {
    return jsonResponse(400, { success: false, error: 'Club manquant.' });
  }
  const action = body.action?.trim() as Action | undefined;
  if (!action || !ACTIONS.includes(action)) {
    return jsonResponse(400, {
      success: false,
      error: `Action invalide — attendu : ${ACTIONS.join(', ')}.`,
    });
  }
  const targetId = body.user_id?.trim();
  if (action !== 'list' && !targetId) {
    return jsonResponse(400, { success: false, error: 'Membre manquant.' });
  }

  const supabaseAdmin = createClient(supabaseUrl, serviceRoleKey);

  // --- Autorisation : admin du club demandé, ou super-admin ---
  // Même contrôle que `invite-user` : c'est lui, et non le `club_id` envoyé par le
  // front, qui fait foi.
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
    console.error('[club-members] authorization lookup error', {
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

  const { data: club, error: clubErr } = await supabaseAdmin
    .from('clubs').select('status').eq('id', clubId).maybeSingle();
  if (clubErr) {
    return jsonResponse(500, { success: false, error: 'Vérification du club impossible.' });
  }
  if (!club || (club.status !== 'active' && profile?.is_super_admin !== true)) {
    return jsonResponse(403, { success: false, error: 'Club indisponible.' });
  }

  const isSuperAdmin = profile?.is_super_admin === true;
  if (!isSuperAdmin && membership?.role !== 'admin') {
    return jsonResponse(403, {
      success: false,
      error: 'Seul un administrateur de ce club peut gérer ses membres.',
    });
  }

  // --- list ---
  if (action === 'list') {
    const { data: rows, error: rowsErr } = await supabaseAdmin
      .from('club_members')
      .select('user_id, role, created_at')
      .eq('club_id', clubId);

    if (rowsErr) {
      console.error('[club-members] list error', { clubId, message: rowsErr.message });
      return jsonResponse(500, {
        success: false,
        error: 'Chargement des membres impossible.',
      });
    }

    const members = (rows ?? []) as { user_id: string; role: ClubRole; created_at: string }[];
    const ids = members.map((m) => m.user_id);

    // `profiles` n'a pas de FK depuis `club_members` (elle pointe `auth.users`) :
    // PostgREST ne sait pas embarquer les noms, on les lit en une requête à part.
    const names = new Map<string, { prenom: string; nom: string }>();
    if (ids.length) {
      const { data: profileRows, error: profilesErr } = await supabaseAdmin
        .from('profiles')
        .select('id, prenom, nom')
        .in('id', ids);
      if (profilesErr) {
        console.error('[club-members] profiles lookup error', {
          clubId,
          message: profilesErr.message,
        });
        return jsonResponse(500, {
          success: false,
          error: 'Chargement des profils impossible.',
        });
      }
      for (const row of (profileRows ?? []) as { id: string; prenom: string; nom: string }[]) {
        names.set(row.id, { prenom: row.prenom, nom: row.nom });
      }
    }

    // Email + last_sign_in_at ne sont lisibles que via l'API admin GoTrue. On
    // interroge les comptes du club un par un (`getUserById`) plutôt que de lister
    // tous les comptes du projet : la liste GoTrue est paginée et couvre TOUS les
    // clubs, alors qu'ici on connaît exactement les ids voulus. Quelques dizaines
    // d'appels parallèles pour un écran chargé à la demande.
    const authUsers = await Promise.all(
      ids.map(async (id) => {
        const { data, error } = await supabaseAdmin.auth.admin.getUserById(id);
        if (error) {
          console.error('[club-members] getUserById error', { clubId, id, message: error.message });
        }
        return { id, user: data?.user ?? null };
      }),
    );
    const accounts = new Map(authUsers.map((a) => [a.id, a.user]));

    // `is_super_admin` n'est volontairement PAS exposé : c'est une information
    // plateforme, pas un rôle de club.
    const payload = members.map((m) => {
      const account = accounts.get(m.user_id);
      const profileRow = names.get(m.user_id);
      return {
        user_id: m.user_id,
        email: account?.email ?? '',
        prenom: profileRow?.prenom ?? '',
        nom: profileRow?.nom ?? '',
        role: m.role,
        created_at: m.created_at,
        status: account?.last_sign_in_at ? 'active' : 'pending',
      };
    });

    payload.sort((a, b) => {
      const rank = (r: string) => (r === 'admin' ? 0 : 1);
      return rank(a.role) - rank(b.role) || a.email.localeCompare(b.email);
    });

    return jsonResponse(200, { success: true, members: payload });
  }

  // --- Cible : doit être membre de CE club ---
  const { data: target, error: targetErr } = await supabaseAdmin
    .from('club_members')
    .select('role')
    .eq('club_id', clubId)
    .eq('user_id', targetId!)
    .maybeSingle();

  if (targetErr) {
    console.error('[club-members] target lookup error', {
      clubId,
      targetId,
      message: targetErr.message,
    });
    return jsonResponse(500, {
      success: false,
      error: 'Vérification du membre impossible.',
    });
  }
  if (!target) {
    return jsonResponse(400, {
      success: false,
      error: 'Cette personne n’est pas membre de ce club.',
    });
  }

  // Garde-fou : le club doit toujours garder au moins un admin. Un club sans admin
  // ne peut plus inviter personne — le rattrapage est SQL-only (script PR4).
  const wouldDropLastAdmin = async (): Promise<boolean> => {
    if (target.role !== 'admin') return false;
    const { count, error } = await supabaseAdmin
      .from('club_members')
      .select('user_id', { count: 'exact', head: true })
      .eq('club_id', clubId)
      .eq('role', 'admin');
    if (error) {
      console.error('[club-members] admin count error', { clubId, message: error.message });
      throw error;
    }
    return (count ?? 0) <= 1;
  };

  // --- set-role ---
  if (action === 'set-role') {
    const role = body.role?.trim() as ClubRole | undefined;
    if (!role || !CLUB_ROLES.includes(role)) {
      return jsonResponse(400, {
        success: false,
        error: `Rôle invalide — attendu : ${CLUB_ROLES.join(', ')}.`,
      });
    }
    if (role === target.role) {
      return jsonResponse(200, { success: true });
    }
    try {
      if (role !== 'admin' && (await wouldDropLastAdmin())) {
        return jsonResponse(400, {
          success: false,
          error:
            'Ce compte est le dernier administrateur du club : promouvez d’abord quelqu’un d’autre.',
        });
      }
    } catch {
      return jsonResponse(500, {
        success: false,
        error: 'Vérification des administrateurs impossible.',
      });
    }

    const { error } = await supabaseAdmin
      .from('club_members')
      .update({ role })
      .eq('club_id', clubId)
      .eq('user_id', targetId!);
    if (error) {
      console.error('[club-members] set-role error', {
        clubId,
        targetId,
        role,
        message: error.message,
      });
      return jsonResponse(error.code === '23514' ? 400 : 500, {
        success: false,
        error: error.code === '23514' ? 'Le club doit conserver au moins un administrateur.' : 'Changement de rôle impossible.',
      });
    }
    return jsonResponse(200, { success: true });
  }

  // --- remove ---
  // Détache du club, point : ni `auth.users` ni `profiles` ne sont touchés (le compte
  // reste réutilisable, une future invitation le rattachera).
  if (action === 'remove') {
    try {
      if (await wouldDropLastAdmin()) {
        return jsonResponse(400, {
          success: false,
          error:
            'Ce compte est le dernier administrateur du club : promouvez d’abord quelqu’un d’autre.',
        });
      }
    } catch {
      return jsonResponse(500, {
        success: false,
        error: 'Vérification des administrateurs impossible.',
      });
    }

    const { error } = await supabaseAdmin
      .from('club_members')
      .delete()
      .eq('club_id', clubId)
      .eq('user_id', targetId!);
    if (error) {
      console.error('[club-members] remove error', {
        clubId,
        targetId,
        message: error.message,
      });
      return jsonResponse(error.code === '23514' ? 400 : 500, {
        success: false,
        error: error.code === '23514' ? 'Le club doit conserver au moins un administrateur.' : 'Retrait impossible.',
      });
    }
    return jsonResponse(200, { success: true });
  }

  // --- resend-invite ---
  // Rappeler `invite-user` ne marcherait PAS : l'invité existe déjà dans `auth.users`,
  // la function partirait dans sa branche `already_existed` et répondrait « succès »
  // sans envoyer le moindre email (brief PR5-bis §7).
  //
  // GoTrue ne refuse `inviteUserByEmail` (email_exists) que si le compte est
  // *confirmé* : sur un invité qui n'a jamais activé son compte, l'invitation est
  // réémise et l'email repart. On garde deux replis (generateLink invite, puis
  // recovery) qui produisent un lien à copier — la réponse dit lequel a servi, pour
  // que l'UI n'annonce jamais un email qui n'est pas parti.
  const redirectTo = body.redirectTo?.trim();

  const { data: accountData, error: accountErr } =
    await supabaseAdmin.auth.admin.getUserById(targetId!);
  if (accountErr || !accountData?.user?.email) {
    console.error('[club-members] resend-invite account lookup error', {
      clubId,
      targetId,
      message: accountErr?.message,
    });
    return jsonResponse(500, { success: false, error: 'Compte introuvable.' });
  }
  const account = accountData.user;
  const email = account.email!;

  if (account.last_sign_in_at) {
    return jsonResponse(400, {
      success: false,
      error: 'Ce compte est déjà actif : il n’y a pas d’invitation à relancer.',
    });
  }

  const options = redirectTo ? { redirectTo } : undefined;

  const { error: inviteErr } = await supabaseAdmin.auth.admin.inviteUserByEmail(email, options);
  if (!inviteErr) {
    return jsonResponse(200, { success: true, email, email_sent: true });
  }
  console.error('[club-members] resend inviteUserByEmail failed', {
    clubId,
    targetId,
    message: inviteErr.message,
  });

  for (const type of ['invite', 'recovery'] as const) {
    const { data, error } = await supabaseAdmin.auth.admin.generateLink({
      type,
      email,
      options,
    });
    if (!error && data?.properties?.action_link) {
      return jsonResponse(200, {
        success: true,
        email,
        email_sent: false,
        action_link: data.properties.action_link,
      });
    }
    console.error('[club-members] resend generateLink failed', {
      clubId,
      targetId,
      type,
      message: error?.message,
    });
  }

  return jsonResponse(400, {
    success: false,
    error: 'Impossible de relancer l’invitation : ni email ni lien n’ont pu être générés.',
  });
});
