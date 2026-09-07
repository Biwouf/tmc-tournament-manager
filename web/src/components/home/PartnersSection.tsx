import { useSite } from '../../contexts/SiteContext';
import { configImageUrl } from '../../lib/configImage';

/** Bande partenaires — `partners`, masquable par `settings.show_partners`. */
export default function PartnersSection() {
  const { config } = useSite();
  // Une entrée sans logo n'a rien à montrer : la liste affichée est celle des logos résolus.
  const partners = config.partners
    .map((partner) => ({ ...partner, url: partner.url, logo: configImageUrl(partner.logo) }))
    .filter((partner) => partner.logo);

  if (!config.settings.show_partners || partners.length === 0) return null;

  return (
    <section className="bg-bg2">
      <div className="shell section">
        <p className="text-center text-[13px] font-bold tracking-[0.14em] text-muted uppercase">
          Ils soutiennent le club
        </p>
        <div className="mt-8 flex flex-wrap items-center justify-center gap-4">
          {partners.map((partner, index) => {
            const logo = (
              <img
                src={partner.logo!}
                alt={partner.name || ''}
                className="max-h-12 w-auto object-contain"
              />
            );
            return (
              <div
                key={index}
                className="flex h-20 min-w-36 items-center justify-center rounded-soft border border-line bg-card px-6"
              >
                {partner.url ? (
                  <a href={partner.url} target="_blank" rel="noreferrer noopener">
                    {logo}
                  </a>
                ) : (
                  logo
                )}
              </div>
            );
          })}
        </div>
      </div>
    </section>
  );
}
