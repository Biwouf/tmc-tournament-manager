import type { EmailContent } from './email-template.ts';
export type AuthEmailPayload = {
  user: { id?: string; email: string; new_email?: string };
  email_data: { email_action_type: string; token?: string; token_new?: string; token_hash?: string; token_hash_new?: string; redirect_to?: string; site_url?: string };
};
const copy: Record<string, [string, string, string]> = {
  recovery: ['Réinitialisez votre mot de passe', 'Vous avez demandé à choisir un nouveau mot de passe pour votre compte.', 'Choisir mon mot de passe'],
  invite: ['Vous êtes invité à rejoindre votre espace', 'Une invitation vous attend. Cliquez ci-dessous pour activer votre accès et choisir votre mot de passe.', 'Accepter l’invitation'],
  signup: ['Confirmez votre inscription', 'Bienvenue ! Confirmez votre adresse email pour poursuivre votre inscription.', 'Confirmer mon adresse email'],
  magiclink: ['Connectez-vous à votre espace', 'Utilisez le lien ci-dessous pour vous connecter à votre compte.', 'Me connecter'],
  email_change: ['Confirmez le changement d’adresse email', 'Confirmez cette demande de modification de l’adresse email de votre compte.', 'Confirmer le changement'],
  reauthentication: ['Confirmez votre identité', 'Saisissez ce code dans votre application pour confirmer votre identité.', ''],
};
const notices: Record<string, string> = {
  password_changed_notification: 'Votre mot de passe a été modifié',
  email_changed_notification: 'Votre adresse email a été modifiée',
  phone_changed_notification: 'Votre numéro de téléphone a été modifié',
  identity_linked_notification: 'Une méthode de connexion a été ajoutée',
  identity_unlinked_notification: 'Une méthode de connexion a été retirée',
  mfa_factor_enrolled_notification: 'Un facteur de sécurité a été ajouté',
  mfa_factor_unenrolled_notification: 'Un facteur de sécurité a été retiré',
};
/** Club self-serve visé par un lien magique (`?inscription=<slug>`, posé par `club-signup`). */
export function clubSignupSlug(redirect: string | undefined): string | null {
  try {
    const hints = new URL(redirect || '').searchParams.getAll('inscription');
    return hints.length === 1 && /^[a-z0-9-]{3,32}$/.test(hints[0]) ? hints[0] : null;
  } catch { return null; }
}
/** Gabarit « Gardez votre club » : seulement pour un club `pending` dont le destinataire est admin.
 * `tenup` : club lu sur Ten'Up (jeton `lookup` vérifié par `club-signup`) → e-mail aux couleurs du
 * club, nommé par son nom court (W2, brief SAAS_11 §13.3). Sinon (club saisi à la main), l'e-mail
 * reste Feelike : le nom n'apparaît que dans le corps, échappé par le gabarit. */
export type ClubSignup = { name: string; slug: string; tenup?: boolean };
/** Nom d'un club tel qu'il peut figurer dans un en-tête d'e-mail : une ligne, 40 caractères. */
export function headerName(value: string): string {
  return [...value.replace(/[\u0000-\u001f\u007f\u2028\u2029]/g, ' ').replace(/\s+/g, ' ').trim()].slice(0, 40).join('');
}
/** Expéditeur d'un club Ten'Up : « Moissac TC via Feelike » (adresse Feelike inchangée). */
export function signupSender(shortName: string): string {
  return `${headerName(shortName)} via Feelike`;
}
/** Objet d'un club Ten'Up. Le code (P2, pas encore branché) passe en tête : « 482 913 : … ». */
export function signupSubject(shortName: string, code?: string): string {
  const name = headerName(shortName);
  if (!code) return `Gardez ${name} sur Feelike`;
  const digits = /^\d{6}$/.test(code) ? `${code.slice(0, 3)} ${code.slice(3)}` : code;
  return `${digits} : votre code pour garder ${name}`;
}
function signupContent(signup: ClubSignup): Pick<EmailContent, 'title' | 'paragraphs' | 'preheader' | 'footer' | 'notes'> & { label: string } {
  const host = `${signup.slug}.feelike.pro`;
  return {
    title: 'Gardez votre club',
    paragraphs: [signup.tenup
      ? `Votre app ${host} est prête. Confirmez votre adresse email pour la garder et démarrer vos 30 jours d’essai gratuit, sans carte bancaire.`
      : `Votre club « ${signup.name} » vous attend à l’adresse ${host}. Confirmez votre adresse email pour le garder et démarrer vos 30 jours d’essai gratuit, sans carte bancaire.`],
    label: 'Garder mon club',
    preheader: `Votre app ${host} est prête.`,
    footer: `Vous recevez cet email parce que quelqu’un a créé l’espace du club ${signup.name} sur Feelike avec cette adresse. Ce n’est pas vous ? Ignorez-le : sans confirmation, l’espace est supprimé dans 7 jours. Ne partagez jamais ce lien.`,
    notes: ['Feelike · l’app des clubs de tennis · feelike.pro',
      ...(signup.tenup ? ['Le nom, le logo et la couleur viennent de la fiche publique Ten’Up du club.'] : [])],
  };
}
export function authEmails(payload: AuthEmailPayload, supabaseUrl: string, signup?: ClubSignup | null): { to: string; content: EmailContent }[] {
  const { user, email_data: data } = payload;
  const type = data.email_action_type;
  if (!user.email) throw new Error('Missing recipient');
  if (notices[type]) return [{ to: user.email, content: { title: notices[type], paragraphs: ['Cette modification concerne votre compte.', 'Si vous n’êtes pas à l’origine de cette modification, contactez rapidement l’administrateur de votre club.'] } }];
  if (!copy[type]) throw new Error('Unsupported email action');
  const club = signup && type === 'magiclink' ? signupContent(signup) : null;
  const [title, paragraph, label] = club ? [club.title, club.paragraphs[0], club.label] : copy[type];
  const footer = 'Si vous n’êtes pas à l’origine de cette demande ou si vous n’attendiez pas cet email, vous pouvez l’ignorer. Ne partagez jamais ce lien ou ce code.';
  if (type === 'reauthentication') {
    if (!data.token) throw new Error('Missing code');
    return [{ to: user.email, content: { title, paragraphs: [paragraph], code: data.token, footer } }];
  }
  const make = (to: string | undefined, hash: string | undefined) => {
    if (!to || !hash) throw new Error('Missing recipient or token');
    const url = new URL('/auth/v1/verify', supabaseUrl);
    url.searchParams.set('token', hash);
    url.searchParams.set('type', type);
    if (data.redirect_to) url.searchParams.set('redirect_to', data.redirect_to);
    const extra = club ? { preheader: club.preheader, footer: club.footer, notes: club.notes } : { footer };
    return { to, content: { title, paragraphs: [paragraph], action: { label, url: url.href }, ...extra } };
  };
  // Supabase associe token_hash_new à l'adresse ACTUELLE (noms historiques inversés).
  if (type === 'email_change') return [
    ...(data.token_hash_new ? [make(user.email, data.token_hash_new)] : []),
    make(user.new_email, data.token_hash),
  ];
  return [make(user.email, data.token_hash)];
}
