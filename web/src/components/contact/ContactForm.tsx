import { useRef, useState, type FormEvent } from 'react';
import { useSite } from '../../contexts/SiteContext';
import { sendContact } from '../../lib/contact';

/** Le destinataire est lu côté serveur dans la configuration du club. */
export default function ContactForm() {
  const { club } = useSite();
  const busy = useRef(false);
  const [sending, setSending] = useState(false);
  const [notice, setNotice] = useState<{ error: boolean; text: string } | null>(null);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busy.current) return;
    const form = event.currentTarget;
    const fields = new FormData(form);
    const value = (key: string) => String(fields.get(key) ?? '').trim();
    busy.current = true;
    setSending(true);
    setNotice(null);
    try {
      const result = await sendContact({ club_id: club.id, first_name: value('firstname'),
        last_name: value('lastname'), email: value('email'), phone: value('phone'),
        message: value('message'), website: value('website') });
      setNotice({ error: false, text: result.email_sent
        ? 'Votre message a bien été envoyé. Le club vous répondra par email.'
        : 'Votre message a bien été enregistré. La notification du club par email est indisponible ; votre message reste consultable par le club.' });
      form.reset();
    } catch (error) {
      setNotice({ error: true, text: error instanceof Error ? error.message : 'Envoi impossible. Réessayez dans quelques instants.' });
    } finally {
      busy.current = false;
      setSending(false);
    }
  }

  return (
    <form onSubmit={submit} className="flex flex-col gap-4" aria-busy={sending}>
      <fieldset disabled={sending} className="flex min-w-0 flex-col gap-4 border-0 p-0">
        <div className="grid gap-4 sm:grid-cols-2">
          <label className="field-label">Nom*
            <input className="field" name="lastname" required maxLength={100} autoComplete="family-name" />
          </label>
          <label className="field-label">Prénom*
            <input className="field" name="firstname" required maxLength={100} autoComplete="given-name" />
          </label>
          <label className="field-label">Téléphone
            <input className="field" name="phone" type="tel" maxLength={30} autoComplete="tel" />
          </label>
          <label className="field-label">E-mail*
            <input className="field" name="email" type="email" required maxLength={255} autoComplete="email" />
          </label>
        </div>
        <label className="field-label">Message*
          <textarea className="field" name="message" rows={5} required minLength={10} maxLength={5000} />
        </label>
        <div hidden aria-hidden="true">
          <label>Site internet<input name="website" tabIndex={-1} autoComplete="off" /></label>
        </div>
        <button type="submit" className="btn btn-primary self-start" disabled={sending}>
          {sending ? 'Envoi en cours…' : 'Envoyer'}
        </button>
      </fieldset>
      {notice && <p role={notice.error ? 'alert' : 'status'} className="text-sm leading-relaxed">{notice.text}</p>}
    </form>
  );
}
