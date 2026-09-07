import { useSite } from '../../contexts/SiteContext';
import { formatPrice } from '../../lib/price';

/** Adhésion + cours — `pricing.lessons`. */
export default function LessonsSection() {
  const { config } = useSite();
  const lessons = config.pricing.lessons;
  if (lessons.length === 0) return null;

  return (
    <section className="shell section">
      <h2 className="title">Adhésion + cours</h2>
      <div className="mt-8 grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
        {lessons.map((lesson, index) => {
          const price = formatPrice(lesson.price);
          return (
            <article key={index} className="card flex flex-col p-6">
              {lesson.subtitle && (
                <div className="text-[12.5px] font-bold tracking-[0.12em] text-brand uppercase">
                  {lesson.subtitle}
                </div>
              )}
              <h3 className="mt-2 text-lg font-extrabold">{lesson.name}</h3>
              {lesson.frequency && (
                <div className="mt-1 text-sm font-semibold text-muted">{lesson.frequency}</div>
              )}
              {price && <div className="mt-5 text-[30px] font-extrabold text-brand">{price}</div>}
              {lesson.eligibility && (
                <p className="mt-4 border-t border-line pt-4 text-[14px] text-muted">
                  {lesson.eligibility}
                </p>
              )}
            </article>
          );
        })}
      </div>
    </section>
  );
}
