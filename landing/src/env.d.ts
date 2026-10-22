interface ImportMetaEnv {
  readonly PUBLIC_SIGNUP_URL?: string;
  readonly PUBLIC_BOOKING_URL?: string;
  readonly PUBLIC_ANALYTICS_DOMAIN?: string;
  readonly PUBLIC_PRICE_NOTE?: string;
  readonly PUBLIC_CONTACT_EMAIL?: string;
}

interface Window {
  plausible?: ((event: string, options?: { props?: Record<string, string> }) => void) & { q?: unknown[] };
}
