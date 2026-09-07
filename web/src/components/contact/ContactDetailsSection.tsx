import { useSite } from '../../contexts/SiteContext';

/** Coordonnées — `contact.*` (adresse, téléphone, e-mail, lien carte). */
export default function ContactDetailsSection() {
  const { config } = useSite();
  const { contact } = config;
  const cityLine = [contact.address_postal_code, contact.address_city].filter(Boolean).join(' ');
  const hasAddress = Boolean(contact.address_street || cityLine);
  if (!hasAddress && !contact.phone && !contact.email && !contact.maps_url) return null;

  return (
    <div className="card p-6">
      <h2 className="text-lg font-extrabold">Coordonnées</h2>
      <div className="mt-4 flex flex-col gap-4 text-[15px]">
        {hasAddress && (
          <div>
            <div className="text-[13px] font-bold text-muted">Adresse</div>
            {contact.address_street && <div>{contact.address_street}</div>}
            {cityLine && <div>{cityLine}</div>}
          </div>
        )}
        {contact.phone && (
          <div>
            <div className="text-[13px] font-bold text-muted">Téléphone</div>
            <a href={`tel:${contact.phone.replace(/\s|\./g, '')}`}>{contact.phone}</a>
          </div>
        )}
        {contact.email && (
          <div>
            <div className="text-[13px] font-bold text-muted">E-mail</div>
            <a href={`mailto:${contact.email}`} className="break-all">
              {contact.email}
            </a>
          </div>
        )}
        {contact.maps_url && (
          <a
            href={contact.maps_url}
            target="_blank"
            rel="noreferrer noopener"
            className="font-bold text-brand"
          >
            Voir sur la carte →
          </a>
        )}
      </div>
    </div>
  );
}
