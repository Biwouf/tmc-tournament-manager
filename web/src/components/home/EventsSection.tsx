import { useSite } from '../../contexts/SiteContext';
import { feedDate } from '../../lib/feeds';

export default function EventsSection() {
  const { config, feeds } = useSite();
  if (!config.settings.show_events || !feeds?.events.length) return null;
  return (
    <section className="shell section [--sec-top:60px]" aria-labelledby="events-title">
      <h2 id="events-title" className="mb-6 text-[clamp(22px,3vw,30px)] font-extrabold">Prochains rendez-vous</h2>
      <div className="grid gap-3">
        {feeds.events.map(item => (
          <article key={item.id} className="flex min-w-0 flex-col gap-4 rounded-soft border border-line bg-card px-6 py-5 shadow-soft sm:flex-row sm:items-center sm:gap-6">
            <div className="text-sm sm:w-48 sm:shrink-0 sm:border-r sm:border-line sm:pr-6">
              <p className="font-bold text-brand">{item.type}</p>
              <p className="mt-1 text-muted"><time dateTime={item.date_debut}>{feedDate(item.date_debut)}</time>
                {item.date_fin && feedDate(item.date_fin) !== feedDate(item.date_debut) && <><br />au <time dateTime={item.date_fin}>{feedDate(item.date_fin)}</time></>}
              </p>
            </div>
            <div className="min-w-0 flex-1 break-words">
              <h3 className="text-lg font-extrabold">{item.titre}</h3>
              {item.excerpt && <p className="mt-1 text-sm leading-relaxed text-muted">{item.excerpt}</p>}
              {item.prix !== null && <p className="mt-2 text-sm font-semibold">{item.prix === 0 ? 'Gratuit' : new Intl.NumberFormat('fr-FR', { style: 'currency', currency: 'EUR' }).format(item.prix)}</p>}
            </div>
          </article>
        ))}
      </div>
    </section>
  );
}
