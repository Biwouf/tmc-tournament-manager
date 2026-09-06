import { useSite } from '../../contexts/SiteContext';
import { configImageUrl } from '../../lib/configImage';

/** Mot du président·e — `club.president.*`. */
export default function PresidentSection() {
  const { config } = useSite();
  const president = config.club.president;
  const photo = configImageUrl(president.photo);
  if (!president.name && !president.role && !president.quote && !photo) return null;

  return (
    <section className="shell section">
      <div className="card grid gap-10 p-8 sm:p-12 md:grid-cols-[280px_1fr] md:items-center">
        {(photo || president.name || president.role) && (
          <div className="text-center">
            {photo && (
              <img
                src={photo}
                alt={president.name || ''}
                className="mx-auto h-44 w-44 rounded-full border-4 border-brand-soft object-cover"
              />
            )}
            {president.name && <div className="mt-4 text-lg font-extrabold">{president.name}</div>}
            {president.role && (
              <div className="mt-1 text-sm font-semibold text-muted">{president.role}</div>
            )}
          </div>
        )}
        {president.quote && (
          <div>
            <div aria-hidden className="text-6xl leading-none font-extrabold text-brand-soft">“</div>
            <p className="mt-2 text-[17px] leading-relaxed whitespace-pre-line">
              {president.quote}
            </p>
          </div>
        )}
      </div>
    </section>
  );
}
