import { Link } from 'react-router-dom';
import { useSite } from '../../contexts/SiteContext';
import { configImageUrl } from '../../lib/configImage';

/** Teaser infrastructures — `home.infra_teaser`. Trois cartes recommandées, la liste décide. */
export default function InfraTeaserSection() {
  const { config } = useSite();
  const items = config.home.infra_teaser;
  if (items.length === 0) return null;

  return (
    <section className="shell section">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <h2 className="title">Les infrastructures</h2>
        <Link to="/infrastructures" className="text-[15px] font-bold text-brand">
          Tout voir →
        </Link>
      </div>
      <div className="mt-8 grid gap-6 sm:grid-cols-2 lg:grid-cols-3">
        {items.map((item, index) => {
          const image = configImageUrl(item.image);
          return (
            <div
              key={index}
              className="relative overflow-hidden rounded-card border border-line bg-card shadow-soft"
            >
              {image && (
                <>
                  <img src={image} alt="" className="aspect-[4/3] w-full object-cover" />
                  <div className="absolute inset-0 bg-gradient-to-t from-black/70 to-transparent" />
                </>
              )}
              <div className={image ? 'absolute inset-x-0 bottom-0 p-5 text-white' : 'p-5'}>
                <h3 className="text-lg font-extrabold">{item.label}</h3>
                {item.detail && (
                  <p className={`mt-1 text-sm ${image ? 'text-white/80' : 'text-muted'}`}>
                    {item.detail}
                  </p>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </section>
  );
}
