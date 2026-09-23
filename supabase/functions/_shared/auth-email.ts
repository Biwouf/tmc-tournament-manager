import type { EmailContent } from './email-template.ts';
export type AuthEmailPayload = {
  user: { email: string; new_email?: string };
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
export function authEmails(payload: AuthEmailPayload, supabaseUrl: string): { to: string; content: EmailContent }[] {
  const { user, email_data: data } = payload;
  const type = data.email_action_type;
  if (!user.email) throw new Error('Missing recipient');
  if (notices[type]) return [{ to: user.email, content: { title: notices[type], paragraphs: ['Cette modification concerne votre compte.', 'Si vous n’êtes pas à l’origine de cette modification, contactez rapidement l’administrateur de votre club.'] } }];
  if (!copy[type]) throw new Error('Unsupported email action');
  const [title, paragraph, label] = copy[type];
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
    return { to, content: { title, paragraphs: [paragraph], action: { label, url: url.href }, footer } };
  };
  // Supabase associe token_hash_new à l'adresse ACTUELLE (noms historiques inversés).
  if (type === 'email_change') return [
    ...(data.token_hash_new ? [make(user.email, data.token_hash_new)] : []),
    make(user.new_email, data.token_hash),
  ];
  return [make(user.email, data.token_hash)];
}
