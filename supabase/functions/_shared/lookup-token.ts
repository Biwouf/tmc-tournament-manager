// Onboarding Ten'Up d'abord (brief SAAS_11 §4.3, §4.5) — `lookup_token` : preuve qu'une lecture
// `tenup-lookup` a eu lieu, signée en HMAC-SHA256 par `LOOKUP_HMAC_SECRET` (≥ 32 caractères),
// valable 2 h. Émis par `tenup-lookup`, vérifié par `club-signup` avant de reprendre l'identifiant
// et les images du cache. Format : `<base64url(JSON {id, read_at, exp})>.<base64url(signature)>`.

export const LOOKUP_TOKEN_TTL_MS = 2 * 60 * 60 * 1000;

const encoder = new TextEncoder();
const toBase64Url = (bytes: Uint8Array) =>
  btoa(String.fromCharCode(...bytes)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
const fromBase64Url = (value: string) =>
  Uint8Array.from(atob(value.replace(/-/g, '+').replace(/_/g, '/')), (c) => c.charCodeAt(0));
const hmacKey = (secret: string, usage: 'sign' | 'verify') =>
  crypto.subtle.importKey('raw', encoder.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, [usage]);

export const validLookupSecret = (secret: string | undefined): secret is string => typeof secret === 'string' && secret.length >= 32;

export async function signLookupToken(secret: string, tenupClubId: string, readAt: string, now = Date.now()): Promise<string> {
  const body = toBase64Url(encoder.encode(JSON.stringify({ id: tenupClubId, read_at: readAt, exp: now + LOOKUP_TOKEN_TTL_MS })));
  const signature = new Uint8Array(await crypto.subtle.sign('HMAC', await hmacKey(secret, 'sign'), encoder.encode(body)));
  return `${body}.${toBase64Url(signature)}`;
}

/** Identifiant Ten'Up et date de lecture si le jeton est intact et non expiré, sinon `null`. La
 * signature est comparée par `crypto.subtle.verify` (temps constant). */
export async function verifyLookupToken(secret: string, token: unknown, now = Date.now()): Promise<{ tenup_club_id: string; read_at: string } | null> {
  if (typeof token !== 'string' || token.length > 1024) return null;
  const parts = token.split('.');
  if (parts.length !== 2 || !parts[0] || !parts[1]) return null;
  try {
    const valid = await crypto.subtle.verify('HMAC', await hmacKey(secret, 'verify'), fromBase64Url(parts[1]), encoder.encode(parts[0]));
    if (!valid) return null;
    const data = JSON.parse(new TextDecoder().decode(fromBase64Url(parts[0])));
    if (typeof data?.id !== 'string' || !/^[0-9]{1,12}$/.test(data.id) || typeof data.read_at !== 'string' ||
        !Number.isInteger(data.exp) || data.exp <= now) return null;
    return { tenup_club_id: data.id, read_at: data.read_at };
  } catch { return null; }
}
