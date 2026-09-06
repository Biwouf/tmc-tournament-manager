// Supabase Edge Function — post-to-facebook
// Publishes an actu (titre + contenu Markdown + images) to the club Facebook page.
// Spec : docs/specs/ACTUS.md + docs/specs/MULTI_TENANT.md §6.3
//
// PR8 — multi-tenant : les identifiants ne viennent plus des variables d'environnement
// (`FACEBOOK_PAGE_ID`, `FACEBOOK_PAGE_ACCESS_TOKEN`) mais de `club_social_credentials`,
// ligne du club de l'actu. Aucun repli sur les anciens secrets : un club sans page
// connectée doit échouer avec un message clair, pas publier sur la page d'un autre.
//
// Ce faisant, PR8 retire aussi `FACEBOOK_CLUB_ID` — le garde-fou posé par l'audit du
// 05/09/2026, qui liait les credentials GLOBAUX à un club unique faute de pouvoir en
// avoir plusieurs. Il devient sans objet dès que chaque club a les siens.
//
// Le CONTRÔLE D'ACCÈS de cet audit est conservé intégralement (club actif, actualité
// publiée, appelant admin/manager ou super-admin) : il ne dépendait pas des credentials.

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const FB_GRAPH_VERSION = 'v19.0';

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers':
    'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

interface RequestBody {
  actu_id?: string;
  debug?: boolean;
}

interface FbError {
  message?: string;
  code?: number;
  type?: string;
  fbtrace_id?: string;
}

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' },
  });
}

function stripMarkdown(md: string): string {
  return md
    // images inline ![alt](url) — supprimées (envoyées en pièces jointes)
    .replace(/!\[[^\]]*\]\([^)]*\)/g, '')
    // balises HTML simples (<u>, </u>, <br>, etc.)
    .replace(/<\/?[a-zA-Z][^>]*>/g, '')
    // titres markdown # ## ###
    .replace(/^\s{0,3}#{1,6}\s+/gm, '')
    // gras **xxx** / __xxx__ et italique *xxx* / _xxx_
    .replace(/(\*\*|__)(.*?)\1/g, '$2')
    .replace(/(\*|_)(.*?)\1/g, '$2')
    // barré ~~xxx~~
    .replace(/~~(.*?)~~/g, '$1')
    // inline code `xxx`
    .replace(/`([^`]+)`/g, '$1')
    // liens [label](url) → label
    .replace(/\[([^\]]+)\]\([^)]+\)/g, '$1');
}

interface InlineImage {
  url: string;
  alt: string;
}

function extractInlineImages(md: string): InlineImage[] {
  const out: InlineImage[] = [];
  const re = /!\[([^\]]*)\]\((https?:\/\/[^)]+)\)/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(md)) !== null) {
    out.push({ alt: m[1] ?? '', url: m[2] });
  }
  return out;
}

function dedupe<T>(items: T[]): T[] {
  const seen = new Set<T>();
  const out: T[] = [];
  for (const it of items) {
    if (!seen.has(it)) {
      seen.add(it);
      out.push(it);
    }
  }
  return out;
}

function fbErrorMessage(err: FbError | undefined, prefix: string): string {
  if (!err) return `${prefix} : erreur Facebook inconnue`;
  if (err.code === 190) {
    return 'Le token Facebook a expiré — un administrateur peut le renouveler depuis Admin → Comptes sociaux.';
  }
  return `${prefix} : ${err.message ?? 'erreur inconnue'} (code ${err.code ?? '?'})`;
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

  // Vérifie que le JWT correspond bien à un user authenticated.
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
  const actuId = body.actu_id;
  const debug = Boolean(body.debug);
  if (!actuId || typeof actuId !== 'string') {
    return jsonResponse(400, { success: false, error: '`actu_id` manquant.' });
  }

  // --- Charge l'actualité ; autorisation explicite obligatoire ci-dessous ---
  // `club_id` sert à DEUX choses distinctes : autoriser l'appelant, et choisir la page
  // Facebook. Aucune des deux ne peut se fier au front — le body ne porte qu'un id d'actu,
  // c'est la ligne en base qui dit à quel club elle appartient.
  const supabaseAdmin = createClient(supabaseUrl, serviceRoleKey);
  const { data: actu, error: actuErr } = await supabaseAdmin
    .from('actus')
    .select('club_id, published, titre, contenu, image_urls, image_captions')
    .eq('id', actuId)
    .single();

  if (actuErr || !actu) {
    return jsonResponse(404, {
      success: false,
      error: `Actu introuvable (id: ${actuId})`,
      detail: actuErr ?? null,
    });
  }

  const clubId = actu.club_id as string;

  // Le service role ci-dessus ne prouve aucun droit sur cette actualité.
  //
  // ⚠️ Le terme `actu.club_id !== fbClubId` de l'audit du 05/09 A DISPARU, et c'est le
  // fond de PR8 : il liait les credentials GLOBAUX à un club unique (`FACEBOOK_CLUB_ID`),
  // faute de pouvoir en avoir plusieurs. Maintenant que chaque club a les siens en base,
  // le garde-fou n'est plus une variable d'environnement mais l'absence de ligne — un club
  // sans page connectée ne publie nulle part, au lieu de publier chez CAC.
  //
  // Le RESTE du contrôle est conservé tel quel : club actif, actualité publiée, appelant
  // admin/manager de ce club ou super-admin. `member` est exclu — il ne voit que le Live
  // Score au back-office (§4 des rôles), lui laisser la publication Facebook serait plus
  // permissif que l'écran d'où part l'appel.
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
  if (club?.status !== 'active' || !actu.published ||
      (profile?.is_super_admin !== true && !['admin', 'manager'].includes(membership?.role ?? ''))) {
    return jsonResponse(403, { success: false, error: 'Publication non autorisée pour cette actualité.' });
  }

  // --- Identifiants Facebook DU CLUB (PR8) ---
  // Lus en service role : la colonne `token` n'est lisible par personne d'autre
  // (GRANT par colonne, migration 20260906).
  const { data: credential, error: credentialErr } = await supabaseAdmin
    .from('club_social_credentials')
    .select('page_id, token')
    .eq('club_id', clubId)
    .eq('platform', 'facebook')
    .maybeSingle();

  if (credentialErr) {
    console.error('[post-to-facebook] credential lookup error', {
      clubId,
      message: credentialErr.message,
    });
    return jsonResponse(500, {
      success: false,
      error: 'Lecture des identifiants Facebook impossible.',
    });
  }

  if (!credential) {
    return jsonResponse(400, {
      success: false,
      error:
        'Aucune page Facebook n’est connectée pour ce club. Un administrateur peut la connecter depuis Admin → Comptes sociaux.',
    });
  }

  const fbPageId = credential.page_id as string;
  const fbAccessToken = credential.token as string;

  // --- Construit le message texte (sans le titre) ---
  const message = stripMarkdown(actu.contenu ?? '').trim();

  // --- Collecte les images (image_urls + images inline du Markdown) ---
  const explicit = Array.isArray(actu.image_urls) ? (actu.image_urls as string[]) : [];
  const captionsArr = Array.isArray(actu.image_captions)
    ? (actu.image_captions as string[])
    : [];
  const inline = extractInlineImages(actu.contenu ?? '');

  // Map URL → caption.
  // Sources, dans l'ordre de priorité (la première saisie l'emporte) :
  //   1. image_captions[i] des images explicitement uploadées
  //   2. texte alternatif Markdown des images inline `![alt](url)`
  const captionByUrl = new Map<string, string>();
  for (let i = 0; i < explicit.length; i++) {
    const c = (captionsArr[i] ?? '').trim();
    if (c) captionByUrl.set(explicit[i], c);
  }
  for (const img of inline) {
    const alt = img.alt.trim();
    if (alt && !captionByUrl.has(img.url)) {
      captionByUrl.set(img.url, alt);
    }
  }

  const images = dedupe([...explicit, ...inline.map((i) => i.url)]);
  console.log('[post-to-facebook] images détectées', {
    actu_id: actuId,
    club_id: clubId,
    explicit_count: explicit.length,
    explicit,
    inline_count: inline.length,
    inline,
    deduped_count: images.length,
    deduped: images,
    captioned_count: captionByUrl.size,
  });

  // --- Upload des images sur Facebook (published=false) ---
  // /me résout vers la page elle-même quand on utilise un Page Access Token,
  // et contourne l'erreur (#200) "Unpublished posts must be posted to a page
  // as the page itself" qui se produit avec /{page_id}/... + published=false.
  const photoIds: string[] = [];
  for (const url of images) {
    const caption = captionByUrl.get(url) ?? '';
    const uploadUrl =
      `https://graph.facebook.com/${FB_GRAPH_VERSION}/me/photos` +
      `?published=false` +
      `&url=${encodeURIComponent(url)}` +
      (caption ? `&caption=${encodeURIComponent(caption)}` : '') +
      `&access_token=${encodeURIComponent(fbAccessToken)}`;

    let resp: Response;
    try {
      resp = await fetch(uploadUrl, { method: 'POST' });
    } catch (e) {
      return jsonResponse(502, {
        success: false,
        error: 'Erreur réseau lors de la communication avec Facebook.',
        detail: { stage: 'photo_upload', url, message: String(e) },
      });
    }

    let payload: { id?: string; error?: FbError };
    try {
      payload = await resp.json();
    } catch {
      return jsonResponse(502, {
        success: false,
        error: 'Réponse Facebook illisible lors de l’upload d’image.',
        detail: { stage: 'photo_upload', url, status: resp.status },
      });
    }

    if (!resp.ok || payload.error || !payload.id) {
      return jsonResponse(502, {
        success: false,
        error: payload.error
          ? `Erreur lors de l’upload de l’image ${url} : ${payload.error.message ?? 'erreur inconnue'} (code ${payload.error.code ?? '?'})`
          : `Erreur lors de l’upload de l’image ${url} (HTTP ${resp.status})`,
        detail: { stage: 'photo_upload', url, response: payload },
      });
    }

    photoIds.push(payload.id);
  }
  console.log('[post-to-facebook] photo_ids uploadés', { count: photoIds.length, photoIds });

  // --- Création du post ---
  // Idem : /me/feed pour publier "as the page itself".
  const feedUrl =
    `https://graph.facebook.com/${FB_GRAPH_VERSION}/me/feed`;

  const feedBody: Record<string, unknown> = {
    message,
    published: !debug,
    access_token: fbAccessToken,
  };
  if (photoIds.length > 0) {
    feedBody.attached_media = photoIds.map((id) => ({ media_fbid: id }));
  }

  let feedResp: Response;
  try {
    feedResp = await fetch(feedUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(feedBody),
    });
  } catch (e) {
    return jsonResponse(502, {
      success: false,
      error: 'Erreur réseau lors de la communication avec Facebook.',
      detail: { stage: 'feed_create', message: String(e) },
    });
  }

  let feedPayload: { id?: string; error?: FbError };
  try {
    feedPayload = await feedResp.json();
  } catch {
    return jsonResponse(502, {
      success: false,
      error: 'Réponse Facebook illisible lors de la création du post.',
      detail: { stage: 'feed_create', status: feedResp.status },
    });
  }

  if (!feedResp.ok || feedPayload.error || !feedPayload.id) {
    return jsonResponse(502, {
      success: false,
      error: fbErrorMessage(feedPayload.error, 'Erreur lors de la création du post Facebook'),
      detail: { stage: 'feed_create', response: feedPayload },
    });
  }

  // L'ID retourné est de la forme "{page_id}_{post_id}" — on garde tel quel pour l'URL.
  const postId = feedPayload.id;
  const postUrl = `https://www.facebook.com/${fbPageId}/posts/${postId.split('_').pop()}`;

  return jsonResponse(200, {
    success: true,
    post_id: postId,
    post_url: postUrl,
    debug,
  });
});
