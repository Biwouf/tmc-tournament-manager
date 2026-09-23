/** Le contexte de marque suit le club résolu par la PWA, jamais une valeur figée. */
export function passwordRecoveryRedirect(origin: string, clubSlug?: string): string {
  const url = new URL('/reset-password', origin);
  // En production le domaine app-<slug> fait autorité. En local une même origine
  // peut représenter plusieurs clubs selon VITE_DEV_CLUB_SLUG.
  if (clubSlug && ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname)) {
    url.searchParams.set('club_slug', clubSlug);
  }
  return url.href;
}
