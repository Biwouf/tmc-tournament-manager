import Anthropic from 'npm:@anthropic-ai/sdk@0.128.0';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { COMPO_RANKS } from '../../../pwa/src/lib/teamCompo.ts';

// Lecture d'une photo de feuille de compo (simples) par Claude. Réservé aux membres du club,
// plafonné par team_compo_scan_begin ; la photo n'est ni stockée ni journalisée.
const headers = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Content-Type': 'application/json', 'Cache-Control': 'no-store',
};
const json = (status: number, body: unknown) => new Response(JSON.stringify(body), { status, headers });
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const MEDIA_TYPES = ['image/jpeg', 'image/png', 'image/webp'] as const;

const PROMPT = `Tu lis la photo d'une feuille manuscrite de composition d'équipe de tennis (rencontre interclubs).
La feuille liste les joueurs des simples, numérotés dans l'ordre (simple 1, simple 2…), souvent avec un numéro entouré,
suivis du nom et du classement FFT (ex. 30/2, 15/4, NC, -2/6). Le classement peut être écrit un peu au-dessus ou à côté du nom.
Règles :
- Ne retiens que les joueurs numérotés des simples, avec leur numéro dans "ordre".
- Ignore la partie double (après un mot « double », ou des noms listés sans numéro) et tout autre texte.
- Recopie les noms tels qu'écrits, accents compris. "nom" = nom de famille (souvent en majuscules), "prenom" = prénom.
  Si un seul mot est lisible, mets-le dans "prenom" et laisse "nom" vide.
- "classement" doit être une valeur de la liste autorisée ; s'il est absent ou illisible, mets null.
- Si la photo ne montre pas de feuille de composition, renvoie une liste vide.`;

const SCHEMA = {
  type: 'object',
  properties: {
    joueurs: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          ordre: { type: 'integer' },
          prenom: { type: 'string' },
          nom: { type: 'string' },
          classement: { anyOf: [{ type: 'string', enum: COMPO_RANKS }, { type: 'null' }] },
        },
        required: ['ordre', 'prenom', 'nom', 'classement'],
        additionalProperties: false,
      },
    },
  },
  required: ['joueurs'],
  additionalProperties: false,
};

type Joueur = { ordre: number; prenom: string; nom: string; classement: string | null };
const clean = (value: unknown) => typeof value === 'string' ? value.replace(/\s+/g, ' ').trim().slice(0, 60) : '';

Deno.serve(async req => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers });
  if (req.method !== 'POST') return json(405, { error: 'Méthode non autorisée.' });
  try {
    const authorization = req.headers.get('Authorization');
    if (!authorization?.startsWith('Bearer ')) return json(401, { error: 'Connexion requise.' });
    const client = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_ANON_KEY')!, { global: { headers: { Authorization: authorization } } });
    const { data: { user }, error: authError } = await client.auth.getUser();
    if (authError || !user) return json(401, { error: 'Session expirée. Reconnectez-vous.' });
    const apiKey = Deno.env.get('ANTHROPIC_API_KEY');
    if (!apiKey) return json(503, { error: 'La lecture de photo n’est pas disponible. Saisissez la compo à la main.' });
    const raw = await req.text();
    if (raw.length > 1_500_000) return json(413, { error: 'Photo trop volumineuse.' });
    let body;
    try { body = JSON.parse(raw); } catch { return json(400, { error: 'Requête invalide.' }); }
    if (!body || !uuid.test(body.club_id) || !MEDIA_TYPES.includes(body.media_type) ||
        typeof body.image !== 'string' || !/^[A-Za-z0-9+/]+={0,2}$/.test(body.image)) return json(400, { error: 'Requête invalide.' });
    const { error } = await client.rpc('team_compo_scan_begin', { p_club: body.club_id });
    if (error) return json(error.code === '42501' ? 403 : error.code === 'PT429' ? 429 : 400, { error: error.message });

    const anthropic = new Anthropic({ apiKey, timeout: 45_000, maxRetries: 1 });
    const message = await anthropic.beta.messages.create({
      model: 'claude-opus-5-5',
      max_tokens: 4096,
      // En cas de refus des filtres de sécurité, l'API relance sur le modèle de repli recommandé.
      betas: ['server-side-fallback-2026-07-01'],
      fallbacks: 'default',
      output_config: { effort: 'low', format: { type: 'json_schema', schema: SCHEMA } },
      system: PROMPT,
      messages: [{
        role: 'user',
        content: [
          { type: 'image', source: { type: 'base64', media_type: body.media_type, data: body.image } },
          { type: 'text', text: 'Lis cette feuille de composition.' },
        ],
      }],
    });
    const text = message.stop_reason === 'end_turn' ? message.content.find(block => block.type === 'text') : undefined;
    if (!text || text.type !== 'text') return json(502, { error: 'La feuille n’a pas pu être lue. Réessayez ou saisissez la compo à la main.' });
    const parsed = JSON.parse(text.text) as { joueurs: Joueur[] };
    const joueurs = parsed.joueurs.flatMap(j => Number.isInteger(j.ordre) && j.ordre >= 1 && j.ordre <= 9 && clean(j.prenom) + clean(j.nom)
      ? [{ ordre: j.ordre, prenom: clean(j.prenom), nom: clean(j.nom), classement: COMPO_RANKS.includes(j.classement ?? '') ? j.classement : null }]
      : []).slice(0, 12);
    return json(200, { joueurs });
  } catch (error) {
    if (error instanceof Anthropic.RateLimitError) return json(503, { error: 'Service de lecture saturé. Réessayez dans une minute ou saisissez la compo à la main.' });
    return json(502, { error: 'La feuille n’a pas pu être lue. Réessayez ou saisissez la compo à la main.' });
  }
});
