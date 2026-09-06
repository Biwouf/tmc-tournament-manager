/**
 * Formulaire de contact — champs FIXES, non configurables (web_site_brief.md §5.6). Seul le
 * destinataire (`contact.email`) est paramétrable, et il est lu côté serveur.
 *
 * ⚠️ PR9 rend le markup complet — c'est du design, il fait partie de la page — mais la
 * SOUMISSION est désactivée. Un bouton qui ne fait rien vaut mieux qu'un formulaire qui perd
 * les messages d'un vrai visiteur.
 * // PR11 : branchement de l'Edge Function `contact-form` (envoi Brevo + insertion en base).
 */
export default function ContactForm() {
  return (
    <form onSubmit={(event) => event.preventDefault()} className="flex flex-col gap-4">
      <div className="grid gap-4 sm:grid-cols-2">
        <label className="field-label">
          Nom*
          <input className="field" name="lastname" required autoComplete="family-name" />
        </label>
        <label className="field-label">
          Prénom*
          <input className="field" name="firstname" required autoComplete="given-name" />
        </label>
        <label className="field-label">
          Téléphone
          <input className="field" name="phone" type="tel" autoComplete="tel" />
        </label>
        <label className="field-label">
          E-mail*
          <input className="field" name="email" type="email" required autoComplete="email" />
        </label>
      </div>
      <label className="field-label">
        Message*
        <textarea className="field" name="message" rows={5} required />
      </label>
      <button type="submit" className="btn btn-primary self-start" disabled>
        Envoyer
      </button>
    </form>
  );
}
