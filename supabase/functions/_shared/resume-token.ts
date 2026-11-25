// Onboarding P2 (retours PR #277, B1) — `resume_token` : preuve que l'appelant vient de CRÉER ce club
// en attente. Remis par `club-signup` à la création seulement (jamais à un rejeu, que n'importe qui
// connaissant l'adresse et le slug peut provoquer), vérifié quand le fondateur corrige son e-mail.
// Même format et même secret que `lookup-token.ts` (`LOOKUP_HMAC_SECRET`), mais la signature porte
// sur `club-signup-resume:<corps>` : un jeton de lecture ne vaut jamais jeton de reprise. Valable 2 h.
export const RESUME_TOKEN_TTL_MS = 2 * 60 * 60 * 1000;

const encoder = new TextEncoder();
const toBase64Url = (bytes: Uint8Array) =>
  btoa(String.fromCharCode(...bytes)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
const fromBase64Url = (value: string) =>
  Uint8Array.from(atob(value.replace(/-/g, '+').replace(/_/g, '/')), (c) => c.charCodeAt(0));
const hmacKey = (secret: string, usage: 'sign' | 'verify') =>
  crypto.subtle.importKey('raw', encoder.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, [usage]);
const signed = (body: string) => encoder.encode(`club-signup-resume:${body}`);

export async function signResumeToken(secret: string, clubId: string, slug: string, now = Date.now()): Promise<string> {
  const body = toBase64Url(encoder.encode(JSON.stringify({ club: clubId, slug, exp: now + RESUME_TOKEN_TTL_MS })));
  return `${body}.${toBase64Url(new Uint8Array(await crypto.subtle.sign('HMAC', await hmacKey(secret, 'sign'), signed(body))))}`;
}

/** Club et slug si le jeton est intact et non expiré, sinon `null` (comparaison en temps constant). */
export async function verifyResumeToken(secret: string, token: unknown, now = Date.now()): Promise<{ club: string; slug: string } | null> {
  if (typeof token !== 'string' || token.length > 1024) return null;
  const parts = token.split('.');
  if (parts.length !== 2 || !parts[0] || !parts[1]) return null;
  try {
    if (!await crypto.subtle.verify('HMAC', await hmacKey(secret, 'verify'), fromBase64Url(parts[1]), signed(parts[0]))) return null;
    const data = JSON.parse(new TextDecoder().decode(fromBase64Url(parts[0])));
    if (typeof data?.club !== 'string' || !/^[0-9a-f-]{36}$/.test(data.club) || typeof data.slug !== 'string' ||
        !Number.isInteger(data.exp) || data.exp <= now) return null;
    return { club: data.club, slug: data.slug };
  } catch { return null; }
}
