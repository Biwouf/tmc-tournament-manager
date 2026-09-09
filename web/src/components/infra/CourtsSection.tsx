import { useSite } from '../../contexts/SiteContext';
import { configImageUrl } from '../../lib/configImage';

/** Courts — `infra.courts`. */
export default function CourtsSection() {
  const { config } = useSite();
  const courts = config.infra.courts;
  if (courts.length === 0) return null;

  return (
    <section className="shell section [--sec-top:48px]">
      <div className="grid gap-6 md:grid-cols-2">
        {courts.map((court, index) => {
          const image = configImageUrl(court.image);
          return (
            <article key={index} className="card card-lift overflow-hidden">
              {image && <img src={image} alt="" className="aspect-[16/10] w-full object-cover" />}
              <div className="p-6">
                {court.count && (
                  <div className="text-[32px] leading-none font-extrabold text-brand">
                    {court.count}
                  </div>
                )}
                <h3 className="mt-2 text-lg font-extrabold">{court.label}</h3>
                {court.detail && (
                  <p className="mt-2 text-[15px] leading-relaxed text-muted">{court.detail}</p>
                )}
              </div>
            </article>
          );
        })}
      </div>
    </section>
  );
}
