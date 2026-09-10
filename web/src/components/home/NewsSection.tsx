import { useState } from 'react';
import NewsDetail from './NewsDetail';
import { useSite } from '../../contexts/SiteContext';
import { feedDate, type NewsItem } from '../../lib/feeds';
import { focalPointStyle } from '../../lib/focalPoint';

export default function NewsSection() {
  const { config, feeds } = useSite();
  const [selected, setSelected] = useState<NewsItem | null>(null);
  if (!config.settings.show_news || !feeds?.news.length) return null;
  return (
    <section className="shell section [--sec-top:84px]" aria-labelledby="news-title">
      <p className="text-[13px] font-bold tracking-[0.14em] text-brand uppercase">La vie du club</p>
      <h2 id="news-title" className="mt-2 mb-8 text-[clamp(28px,4vw,42px)] font-extrabold">Dernières actualités</h2>
      <div className="grid items-start gap-6 md:grid-cols-2">
        {feeds.news.map(item => (
          <article key={item.id} className="relative min-w-0 overflow-hidden rounded-card border border-line bg-card shadow-soft transition-colors hover:bg-brand-soft focus-within:outline-2 focus-within:outline-brand">
            {item.image && <img src={item.image} alt="" loading="lazy" decoding="async"
              className="aspect-video w-full object-cover" style={focalPointStyle(item.focal)} />}
            <div className="p-6 break-words">
              {item.published_at && <time dateTime={item.published_at} className="text-sm text-muted">{feedDate(item.published_at)}</time>}
              <h3 className="mt-1 mb-2 text-xl font-extrabold">
                <button type="button" onClick={() => setSelected(item)} aria-label={`Lire l’actualité : ${item.titre}`}
                  aria-haspopup="dialog" className="cursor-pointer text-left after:absolute after:inset-0 focus-visible:outline-none">{item.titre}</button>
              </h3>
              {item.excerpt && <p className="text-[15px] leading-relaxed text-muted">{item.excerpt}</p>}
              <span className="mt-4 inline-block text-sm font-bold text-brand">Lire la suite <span aria-hidden="true">→</span></span>
            </div>
          </article>
        ))}
      </div>
      {selected && <NewsDetail item={selected} onDismiss={() => setSelected(null)} />}
    </section>
  );
}
