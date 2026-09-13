export type ContactInput = {
  club_id: string; first_name: string; last_name: string; email: string;
  phone: string; message: string; website: string;
};
export type ContactResult = { success: true; email_sent: boolean };

/** Aucune adresse destinataire n'est transmise par le navigateur. */
export async function sendContact(input: ContactInput): Promise<ContactResult> {
  let response: Response;
  try {
    response = await fetch(`${import.meta.env.VITE_SUPABASE_URL}/functions/v1/contact-form`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', apikey: import.meta.env.VITE_SUPABASE_ANON_KEY },
      body: JSON.stringify(input),
      signal: AbortSignal.timeout(20000),
    });
  } catch {
    throw new Error('Impossible de confirmer l’envoi. Vérifiez votre connexion avant de réessayer.');
  }
  const result = await response.json().catch(() => null);
  if (!response.ok || result?.success !== true) {
    throw new Error(typeof result?.error === 'string' ? result.error : 'Envoi impossible. Réessayez dans quelques instants.');
  }
  return { success: true, email_sent: result.email_sent === true };
}
