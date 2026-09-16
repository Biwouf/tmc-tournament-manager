/** D9 : la destination dépend du club résolu, jamais du domaine de la vitrine. */
export function pwaUrl(slug: string): string | null {
  return /^[a-z0-9][a-z0-9-]{0,30}[a-z0-9]$/.test(slug)
    ? `https://app-${slug}.feelike.app/`
    : null;
}

