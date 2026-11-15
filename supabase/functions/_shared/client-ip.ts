// Adresse IP du client pour les limites de débit (`club-signup`, `tenup-lookup`) et Turnstile.
// Les API Supabase passent par Cloudflare, qui RÉÉCRIT `cf-connecting-ip` : le client ne peut pas
// l'imposer. `x-forwarded-for`, lui, garde ce que le client a envoyé en tête de liste (Cloudflare
// ajoute l'IP réelle à la fin) : il n'est lu qu'à défaut, comme avant. Jamais journalisée.
export function clientIp(req: Request): string {
  return req.headers.get('cf-connecting-ip')?.trim()
    || req.headers.get('x-forwarded-for')?.split(',')[0]?.trim()
    || 'unknown';
}
