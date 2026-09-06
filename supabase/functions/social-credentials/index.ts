// Supabase Edge Function — social-credentials
// Connecter / déconnecter la page Facebook d'un club (PR8, décision D10).
// Spec : docs/specs/MULTI_TENANT.md §6.3 + docs/specs/ACTUS.md.
//
// Pourquoi une function et pas des policies d'écriture sur `club_social_credentials` :
// enregistrer un token sans l'avoir validé auprès de Facebook, c'est découvrir la faute
// de frappe au moment de publier une actu. La validation exige un appel serveur ; tant
// qu'on y est, c'est le serveur qui écrit — le token ne fait qu'un aller, jamais de
// retour (la colonne n'est pas lisible par `authenticated`, cf. la migration §3).
//
// Le prologue (CORS, auth, autorisation, statut du club) est volontairement dupliqué depuis
// `club-members` : les functions Deno sont indépendantes, c'est le patron maison. Il inclut
// le contrôle de statut ajouté par l'audit du 05/09/2026 — une function de plus, un endroit
// de plus où l'oublier.

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const FB_GRAPH_VERSION = 'v19.0';

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers':
    'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

const ACTIONS = ['connect', 'disconnect'] as const;
type Action = (typeof ACTIONS)[number];

// Une seule plateforme en PR8. La colonne existe pour Instagram & co, pas le code.
const PLATFORM = 'facebook';

interface RequestBody {
  club_id?: string;
  action?: string;
  token?: string;
}

interface FbError {
  message?: string;
  code?: number;
  type?: string;
}

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' },
  });
}

interface PageIdentity {
  id: string;
  name: string;
}

// Identifie la PAGE derrière le token. `/me` avec un Page Access Token résout vers la
// page elle-même — même astuce que `post-to-facebook`.
//
// Il faut distinguer un nœud Page d'un nœud User : un token UTILISATEUR collé par erreur
// répond `/me` sans broncher, et on enregistrerait le compte personnel de l'admin, la
// publication échouant bien plus tard et sans indice.
//
// ⚠️ Le discriminant est `metadata=1`, PAS la présence d'un champ. La première version
// demandait `category` en pariant qu'il existe sur une Page et pas sur un User : pari perdu
// — Graph API a répondu « (#100) Tried accessing nonexisting field (category) » sur un cas
// réel, et le pire est que l'échec ne ressemblait pas à un mauvais type de token mais à un
// refus incompréhensible. Deviner le schéma de Graph API par sondage de champ est fragile
// par construction ; `metadata=1` est le mécanisme d'introspection DOCUMENTÉ, qui répond
// `metadata.type` = `page` ou `user` sur n'importe quel nœud.
async function identifyPage(
  token: string,
): Promise<{ ok: true; page: PageIdentity } | { ok: false; error: string }> {
  const url =
    `https://graph.facebook.com/${FB_GRAPH_VERSION}/me` +
    `?fields=id,name&metadata=1&access_token=${encodeURIComponent(token)}`;

  let resp: Response;
  try {
    resp = await fetch(url);
  } catch (e) {
    console.error('[social-credentials] network error', String(e));
    return { ok: false, error: 'Erreur réseau lors de la communication avec Facebook.' };
  }

  let payload: {
    id?: string;
    name?: string;
    metadata?: { type?: string };
    error?: FbError;
  };
  try {
    payload = await resp.json();
  } catch {
    return { ok: false, error: 'Réponse Facebook illisible.' };
  }

  if (payload.error) {
    const msg = payload.error.message ?? 'erreur inconnue';
    if (payload.error.code === 190) {
      return {
        ok: false,
        error: 'Ce token est invalide ou a expiré. Générez-en un nouveau et recommencez.',
      };
    }
    return { ok: false, error: `Facebook a refusé le token : ${msg}` };
  }

  if (!resp.ok || !payload.id) {
    return { ok: false, error: `Facebook a refusé le token (HTTP ${resp.status}).` };
  }

  const type = payload.metadata?.type?.toLowerCase();
  if (type && type !== 'page') {
    return {
      ok: false,
      error:
        'Ce token est un token utilisateur, pas un token de Page. Générez le token de Page en appelant /me/accounts avec votre token utilisateur longue durée, puis collez l’`access_token` de la page du club.',
    };
  }
  if (!type) {
    // `metadata` absent : réponse inattendue, mais `/me` a répondu une identité valide.
    // On accepte plutôt que de bloquer une configuration correcte sur un champ de confort
    // — c'est exactement le retour au comportement d'avant ce garde-fou, pas une régression.
    console.warn('[social-credentials] metadata.type absent de la réponse Graph API', {
      id: payload.id,
    });
  }

  return { ok: true, page: { id: payload.id, name: payload.name ?? '' } };
}

// Expiration du token, en meilleur effort.
//
// `debug_token` veut normalement un app token ou le token d'un développeur de l'app ;
// débugger un token AVEC LUI-MÊME marche dans le cas courant mais n'est pas garanti. Un
// échec ici ne dit RIEN de la validité du token — `identifyPage` a déjà tranché là-dessus.
// On renvoie donc `null` (« expiration inconnue ») plutôt que de faire échouer la
// connexion pour une information de confort.
//
// `expires_at = 0` signifie « n'expire jamais » chez Facebook — c'est le cas d'un Page
// Access Token dérivé d'un token utilisateur longue durée, donc le cas nominal. Le
// traiter comme un timestamp donnerait une expiration au 1ᵉʳ janvier 1970.
async function readTokenExpiry(token: string): Promise<string | null> {
  const url =
    `https://graph.facebook.com/${FB_GRAPH_VERSION}/debug_token` +
    `?input_token=${encodeURIComponent(token)}` +
    `&access_token=${encodeURIComponent(token)}`;
  try {
    const resp = await fetch(url);
    const payload = await resp.json();
    const expiresAt = payload?.data?.expires_at;
    if (typeof expiresAt !== 'number' || expiresAt === 0) return null;
    return new Date(expiresAt * 1000).toISOString();
  } catch {
    return null;
  }
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

  const supabaseAdmin = createClient(supabaseUrl, serviceRoleKey);

  // --- Autorisation : admin du club demandé, ou super-admin ---
  // Même contrôle que `club-members` : c'est lui, et non le `club_id` envoyé par le
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
    console.error('[social-credentials] authorization lookup error', {
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

  // Statut du club — même contrôle que `invite-user` / `club-members` depuis l'audit du
  // 05/09/2026. Le super-admin y échappe : gérer un club suspendu est un geste de support.
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
      error: 'Seul un administrateur de ce club peut gérer ses comptes sociaux.',
    });
  }

  // --- disconnect ---
  if (action === 'disconnect') {
    const { error: delErr } = await supabaseAdmin
      .from('club_social_credentials')
      .delete()
      .eq('club_id', clubId)
      .eq('platform', PLATFORM);

    if (delErr) {
      console.error('[social-credentials] delete error', { clubId, message: delErr.message });
      return jsonResponse(500, { success: false, error: 'Déconnexion impossible.' });
    }
    return jsonResponse(200, { success: true });
  }

  // --- connect ---
  const token = body.token?.trim();
  if (!token) {
    return jsonResponse(400, { success: false, error: 'Token manquant.' });
  }

  const identity = await identifyPage(token);
  if (!identity.ok) {
    // Refus AVANT écriture : un token invalide ne doit pas remplacer une connexion qui
    // marche. C'est toute la raison d'être de cette function.
    return jsonResponse(400, { success: false, error: identity.error });
  }

  const expiresAt = await readTokenExpiry(token);

  const { error: upsertErr } = await supabaseAdmin
    .from('club_social_credentials')
    .upsert(
      {
        club_id: clubId,
        platform: PLATFORM,
        page_id: identity.page.id,
        page_name: identity.page.name,
        token,
        token_expires_at: expiresAt,
        connected_by: callerId,
      },
      { onConflict: 'club_id,platform' },
    );

  if (upsertErr) {
    console.error('[social-credentials] upsert error', { clubId, message: upsertErr.message });
    return jsonResponse(500, {
      success: false,
      error: 'Enregistrement des identifiants impossible.',
    });
  }

  // Le token n'est pas renvoyé — il n'a aucune raison de repasser par un navigateur.
  return jsonResponse(200, {
    success: true,
    page_id: identity.page.id,
    page_name: identity.page.name,
    token_expires_at: expiresAt,
  });
});
