import { useSite } from '../../contexts/SiteContext';
import { useContactDrawer } from '../../contexts/ContactDrawerContext';
import ContactForm from '../contact/ContactForm';

/**
 * Bouton flottant « Nous contacter » + panneau latéral. Réutilise `contact.*` et le même
 * formulaire que la page Contact — donc la même soumission désactivée jusqu'à PR11.
 */
export default function ContactDrawer() {
  const { config } = useSite();
  const { open, openDrawer, closeDrawer } = useContactDrawer();
  const { contact } = config;

  const address = [
    contact.address_street,
    [contact.address_postal_code, contact.address_city].filter(Boolean).join(' '),
  ]
    .filter(Boolean)
    .join(', ');

  return (
    <>
      <button
        type="button"
        onClick={openDrawer}
        className="btn btn-primary fixed right-5 bottom-5 z-30 shadow-soft"
      >
        Nous contacter
      </button>

      {open && (
        <>
          <button
            type="button"
            aria-label="Fermer le panneau de contact"
            onClick={closeDrawer}
            className="fixed inset-0 z-40 bg-black/40"
          />
          <aside className="fixed top-0 right-0 bottom-0 z-50 w-full max-w-md overflow-y-auto bg-bg p-6 shadow-soft sm:p-8">
            <div className="flex items-start justify-between gap-4">
              <h2 className="text-xl font-extrabold">Nous contacter</h2>
              <button type="button" onClick={closeDrawer} aria-label="Fermer" className="text-2xl">
                ✕
              </button>
            </div>

            <div className="mt-6">
              <ContactForm />
            </div>

            {(contact.phone || contact.email || address) && (
              <div className="mt-8 border-t border-line pt-6 text-sm text-muted">
                {contact.phone && (
                  <p>
                    <span className="font-bold text-text">Tél. </span>
                    <a href={`tel:${contact.phone.replace(/\s|\./g, '')}`}>{contact.phone}</a>
                  </p>
                )}
                {contact.email && (
                  <p className="mt-2">
                    <span className="font-bold text-text">E-mail </span>
                    <a href={`mailto:${contact.email}`}>{contact.email}</a>
                  </p>
                )}
                {address && (
                  <p className="mt-2">
                    <span className="font-bold text-text">Adresse </span>
                    {address}
                  </p>
                )}
              </div>
            )}
          </aside>
        </>
      )}
    </>
  );
}
