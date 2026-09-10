import { useSite } from '../../contexts/SiteContext';
import { feedDate } from '../../lib/feeds';
import { focalPointStyle } from '../../lib/focalPoint';

export default function NewsSection() {
  const { config, feeds } = useSite();
  if (!config.settings.show_news || !feeds?.news.length) return null;
  return (
    <section className="shell section [--sec-top:84px]" aria-labelledby="news-title">
      <p className="text-[13px] font-bold tracking-[0.14em] text-brand uppercase">La vie du club</p>
      <h2 id="news-title" className="mt-2 mb-8 text-[clamp(28px,4vw,42px)] font-extrabold">Dernières actualités</h2>
      <div className="grid items-start gap-6 md:grid-cols-2">
        {feeds.news.map(item => (
          <article key={item.id} className="min-w-0 overflow-hidden rounded-card border border-line bg-card shadow-soft">
            {item.image && <img src={item.image} alt="" loading="lazy" decoding="async"
              className="aspect-video w-full object-cover" style={focalPointStyle(item.focal)} />}
            <div className="p-6 break-words">
              {item.published_at && <time dateTime={item.published_at} className="text-sm text-muted">{feedDate(item.published_at)}</time>}
              <h3 className="mt-1 mb-2 text-xl font-extrabold">{item.titre}</h3>
              {item.excerpt && <p className="text-[15px] leading-relaxed text-muted">{item.excerpt}</p>}
            </div>
          </article>
        ))}
      </div>
    </section>
  );
}
