// Supabase Edge Function — post-story-to-facebook
// Publie une vidéo en story sur la page Facebook du club : l'animation du programme du jour
// (/medias, type Tournoi) ou des rencontres par équipes, générée en MP4 dans le navigateur.
// Une partie par appel : quand
// l'animation dépasse la durée d'une story, la page appelle la function une fois par partie,
// dans l'ordre.
// Spec : docs/specs/GEN_PROG.md « Publication en story Facebook ».
//
// Requête : `multipart/form-data` avec `club_id` et `video` (MP4). Le fichier passe par la
// function parce que le token de la page ne doit jamais descendre dans le navigateur (GRANT par
// colonne sur `club_social_credentials`, migration 20260906).
//
// Contrôle d'accès : même règle que `post-to-facebook` — club actif, appelant admin/manager de
// ce club ou super-admin — vérifiée AVANT tout appel à Facebook. Le `club_id` du formulaire ne
// fait pas foi : il ne sert qu'à chercher l'appartenance de l'appelant, puis la page du club.
//
// Graph API (Page Stories) : `video_stories` start → envoi binaire sur `upload_url` → finish.

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const FB_GRAPH_VERSION = 'v19.0';
/** Garde-fou côté serveur ; une partie de 30 s en 1080 × 1920 pèse bien moins. */
const MAX_VIDEO_BYTES = 100 * 1024 * 1024;

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers':
    'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

interface FbError {
  message?: string;
  code?: number;
}

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' },
  });
}

function fbErrorMessage(err: FbError | undefined, prefix: string): string {
  if (!err) return `${prefix} : erreur Facebook inconnue`;
  if (err.code === 190) {
    return 'Le token Facebook a expiré — un administrateur peut le renouveler depuis Admin → Comptes sociaux.';
  }
  return `${prefix} : ${err.message ?? 'erreur inconnue'} (code ${err.code ?? '?'})`;
}

/** Appel Facebook → JSON, ou réponse d'erreur prête à renvoyer. */
async function fbCall<T>(stage: string, url: string, init: RequestInit, prefix: string): Promise<{ ok: true; data: T } | { ok: false; response: Response }> {
  let resp: Response;
  try {
    resp = await fetch(url, init);
  } catch (e) {
    return { ok: false, response: jsonResponse(502, {
      success: false,
      error: 'Erreur réseau lors de la communication avec Facebook.',
      detail: { stage, message: String(e) },
    }) };
  }
  let payload: T & { error?: FbError };
  try {
    payload = await resp.json();
  } catch {
    return { ok: false, response: jsonResponse(502, {
      success: false,
      error: `${prefix} : réponse Facebook illisible.`,
      detail: { stage, status: resp.status },
    }) };
  }
  if (!resp.ok || payload.error) {
    return { ok: false, response: jsonResponse(502, {
      success: false,
      error: fbErrorMessage(payload.error, prefix),
      detail: { stage, response: payload },
    }) };
  }
  return { ok: true, data: payload };
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
    return jsonResponse(401, { success: false, error: 'Erreur d’authentification — reconnectez-vous.' });
  }

  const supabaseUrl = Deno.env.get('SUPABASE_URL');
  const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
  if (!supabaseUrl || !serviceRoleKey) {
    return jsonResponse(500, { success: false, error: 'Configuration Supabase manquante côté serveur.' });
  }

  const supabaseAuthClient = createClient(supabaseUrl, serviceRoleKey, {
    global: { headers: { Authorization: authHeader } },
  });
  const { data: userData, error: userErr } = await supabaseAuthClient.auth.getUser();
  if (userErr || !userData?.user) {
    return jsonResponse(401, { success: false, error: 'Erreur d’authentification — reconnectez-vous.' });
  }

  // --- Formulaire ---
  let form: FormData;
  try {
    form = await req.formData();
  } catch {
    return jsonResponse(400, { success: false, error: 'Formulaire invalide.' });
  }
  const clubId = form.get('club_id');
  const video = form.get('video');
  if (typeof clubId !== 'string' || !clubId) {
    return jsonResponse(400, { success: false, error: '`club_id` manquant.' });
  }
  if (!(video instanceof File) || video.size === 0) {
    return jsonResponse(400, { success: false, error: 'Vidéo manquante.' });
  }
  if (video.type !== 'video/mp4') {
    return jsonResponse(400, { success: false, error: 'La vidéo doit être un MP4.' });
  }
  if (video.size > MAX_VIDEO_BYTES) {
    return jsonResponse(413, { success: false, error: 'Vidéo trop lourde pour une story.' });
  }

  // --- Autorisation (avant tout appel à Facebook) ---
  const supabaseAdmin = createClient(supabaseUrl, serviceRoleKey);
  const [{ data: membership, error: memberErr }, { data: profile, error: profileErr },
    { data: club, error: clubErr }] = await Promise.all([
    supabaseAdmin.from('club_members').select('role')
      .eq('club_id', clubId).eq('user_id', userData.user.id).maybeSingle(),
    supabaseAdmin.from('profiles').select('is_super_admin')
      .eq('id', userData.user.id).maybeSingle(),
    supabaseAdmin.from('clubs').select('status').eq('id', clubId).maybeSingle(),
  ]);
  if (memberErr || profileErr || clubErr) {
    return jsonResponse(500, { success: false, error: 'Vérification des droits impossible.' });
  }
  if (club?.status !== 'active' ||
      (profile?.is_super_admin !== true && !['admin', 'manager'].includes(membership?.role ?? ''))) {
    return jsonResponse(403, { success: false, error: 'Publication non autorisée pour ce club.' });
  }

  // --- Page Facebook du club (token lisible en service role seulement) ---
  const { data: credential, error: credentialErr } = await supabaseAdmin
    .from('club_social_credentials')
    .select('page_id, token')
    .eq('club_id', clubId)
    .eq('platform', 'facebook')
    .maybeSingle();
  if (credentialErr) {
    console.error('[post-story-to-facebook] credential lookup error', { clubId, message: credentialErr.message });
    return jsonResponse(500, { success: false, error: 'Lecture des identifiants Facebook impossible.' });
  }
  if (!credential) {
    return jsonResponse(400, {
      success: false,
      error: 'Aucune page Facebook n’est connectée pour ce club. Un administrateur peut la connecter depuis Admin → Comptes sociaux.',
    });
  }
  const pageId = credential.page_id as string;
  const token = credential.token as string;
  const storiesUrl = `https://graph.facebook.com/${FB_GRAPH_VERSION}/${pageId}/video_stories`;
  const json = (body: Record<string, unknown>): RequestInit => ({
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ ...body, access_token: token }),
  });

  // 1. Ouverture de l'envoi
  const start = await fbCall<{ video_id?: string; upload_url?: string }>(
    'story_start', storiesUrl, json({ upload_phase: 'start' }), 'Erreur à l’ouverture de la story',
  );
  if (!start.ok) return start.response;
  const { video_id: videoId, upload_url: uploadUrl } = start.data;
  if (!videoId || !uploadUrl) {
    return jsonResponse(502, { success: false, error: 'Réponse Facebook incomplète à l’ouverture de la story.', detail: { stage: 'story_start' } });
  }

  // 2. Envoi du fichier
  const bytes = new Uint8Array(await video.arrayBuffer());
  const upload = await fbCall<{ success?: boolean }>('story_upload', uploadUrl, {
    method: 'POST',
    headers: { Authorization: `OAuth ${token}`, offset: '0', file_size: String(bytes.byteLength) },
    body: bytes,
  }, 'Erreur à l’envoi de la vidéo');
  if (!upload.ok) return upload.response;

  // 3. Publication
  const finish = await fbCall<{ success?: boolean; post_id?: string }>(
    'story_finish', storiesUrl, json({ upload_phase: 'finish', video_id: videoId }), 'Erreur à la publication de la story',
  );
  if (!finish.ok) return finish.response;

  return jsonResponse(200, { success: true, post_id: finish.data.post_id ?? null, page_id: pageId });
});
