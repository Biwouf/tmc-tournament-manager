import { NavLink } from 'react-router-dom';
import { useSite } from '../../contexts/SiteContext';
import { configImageUrl } from '../../lib/configImage';
import { NAV_ITEMS } from './navItems';

/** Footer — `brand.*` + `contact.*` + `social.*` + `legal.*`. Chaque bloc disparaît s'il est vide. */
export default function Footer() {
  const { config, clubName } = useSite();
  const { brand, contact, social, legal } = config;
  // Logo sur fond foncé : `logo_inverse` s'il est saisi, sinon le logo principal.
  const logo = configImageUrl(brand.logo_inverse || brand.logo);

  const address = [
    contact.address_street,
    [contact.address_postal_code, contact.address_city].filter(Boolean).join(' '),
  ]
    .filter(Boolean)
    .join(', ');
  const identityLine = [brand.legal_form, address].filter(Boolean).join(' · ');

  const socials = [
    { url: social.facebook_url, label: 'Facebook' },
    { url: social.instagram_url, label: 'Instagram' },
  ].filter((link) => link.url);

  const legalLine = [
    legal.publication_director && `Directeur de publication : ${legal.publication_director}`,
    [legal.host_name, legal.host_address].filter(Boolean).join(', ') &&
      `Hébergeur : ${[legal.host_name, legal.host_address].filter(Boolean).join(', ')}`,
  ]
    .filter(Boolean)
    .join(' · ');

  return (
    <footer className="bg-text text-white">
      <div className="shell py-14">
        <div className="flex flex-col gap-12 md:flex-row md:justify-between">
          <div className="max-w-sm">
            <div className="flex items-center gap-3">
              {logo && <img src={logo} alt="" className="h-11 w-11 object-contain" />}
              <span className="text-lg font-extrabold">{clubName}</span>
            </div>
            {identityLine && (
              <p className="mt-4 text-sm leading-relaxed text-white/70">{identityLine}</p>
            )}
          </div>

          <div className="flex flex-col gap-10 sm:flex-row sm:gap-16">
            <div>
              <p className="text-[13px] font-bold uppercase tracking-[0.14em] text-white/50">
                Navigation
              </p>
              <div className="mt-4 flex flex-col gap-2">
                {NAV_ITEMS.map((item) => (
                  <NavLink
                    key={item.to}
                    to={item.to}
                    end={item.to === '/'}
                    className="text-sm font-semibold text-white/80 hover:text-white"
                  >
                    {item.label}
                  </NavLink>
                ))}
              </div>
            </div>

            {(contact.phone || contact.email || socials.length > 0) && (
              <div>
                <p className="text-[13px] font-bold uppercase tracking-[0.14em] text-white/50">
                  Contact
                </p>
                <div className="mt-4 flex flex-col gap-2 text-sm text-white/80">
                  {contact.phone && (
                    <a href={`tel:${contact.phone.replace(/\s|\./g, '')}`}>{contact.phone}</a>
                  )}
                  {contact.email && <a href={`mailto:${contact.email}`}>{contact.email}</a>}
                </div>
                {socials.length > 0 && (
                  <div className="mt-4 flex gap-2">
                    {socials.map((link) => (
                      <a
                        key={link.label}
                        href={link.url}
                        target="_blank"
                        rel="noreferrer noopener"
                        className="rounded-full border border-white/25 px-3 py-1.5 text-[13px] font-semibold hover:border-white/60"
                      >
                        {link.label}
                      </a>
                    ))}
                  </div>
                )}
              </div>
            )}
          </div>
        </div>

        <div className="mt-12 border-t border-white/15 pt-6 text-[13px] text-white/50">
          {/* `brand.copyright` remplace la mention entière quand il est saisi — le contrat le
              décrit ainsi (« sinon auto : © {année} {name} »). */}
          <p>{brand.copyright || `© ${new Date().getFullYear()} ${clubName}. Tous droits réservés.`}</p>
          {legalLine && <p className="mt-2">{legalLine}</p>}
        </div>
      </div>
    </footer>
  );
}
