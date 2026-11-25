// Liens d'action et mentions configurables par variables d'environnement (cf. README).
const env = import.meta.env;
const clean = (value: string | undefined) => value?.trim() || null;

export const signupUrl = clean(env.PUBLIC_SIGNUP_URL);
export const bookingUrl = clean(env.PUBLIC_BOOKING_URL);
export const analyticsDomain = clean(env.PUBLIC_ANALYTICS_DOMAIN);
export const priceNote = clean(env.PUBLIC_PRICE_NOTE) ?? '[mention TVA à confirmer]';
export const contactEmail = clean(env.PUBLIC_CONTACT_EMAIL);

export const loginUrl = 'https://admin.feelike.pro';

/** Call de 20 min : lien de réservation, sinon e-mail de contact, sinon rien. */
export const callHref = bookingUrl ?? (contactEmail ? `mailto:${contactEmail}` : null);

/** Ajoute la source de la visite pour mesurer chaque emplacement de CTA jusqu'au tunnel. */
function withUtm(url: string, placement: string) {
  const target = new URL(url);
  target.searchParams.set('utm_source', 'landing');
  target.searchParams.set('utm_content', placement);
  return target.toString();
}

/**
 * CTA d'essai. Tant que le tunnel d'inscription (S3) n'est pas en production,
 * ils deviennent « Demander un accès » et mènent au call.
 */
export function trialCta(label: string, placement: string) {
  if (signupUrl) return { label, href: withUtm(signupUrl, placement), event: 'cta_trial_click' };
  return { label: 'Demander un accès', href: callHref ?? '#parler', event: 'cta_call_click' };
}
