import { useSite } from '../../contexts/SiteContext';
import { formatPrice } from '../../lib/price';

/** Adhésion + cours — `pricing.lessons`. */
export default function LessonsSection() {
  const { config } = useSite();
  const lessons = config.pricing.lessons;
  if (lessons.length === 0) return null;

  return (
    <section className="shell section [--sec-top:44px]">
      <h2 className="title">Adhésion + cours</h2>
      <div className="mt-8 grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
        {lessons.map((lesson, index) => {
          const price = formatPrice(lesson.price);
          return (
            <article key={index} className="card card-lift flex flex-col p-6">
              {lesson.subtitle && (
                <div className="text-[12.5px] font-bold tracking-[0.12em] text-brand uppercase">
                  {lesson.subtitle}
                </div>
              )}
              <h3 className="mt-2 text-lg font-extrabold">{lesson.name}</h3>
              {lesson.frequency && (
                <div className="mt-1 text-sm font-semibold text-muted">{lesson.frequency}</div>
              )}
              {/* Maquette 1901-1903. « / an » est EN DUR : le contrat ne porte aucune
                  périodicité (`pricing.lessons[].price` est un simple nombre) et c'est un choix
                  assumé de l'utilisateur, pas un oubli — ne pas le remplacer par une clé de
                  config sans le lui demander. Il ne vaut QUE pour les formules annuelles
                  (`lessons`, `membership`) ; `other_fees` en est exclu, son prix est du texte
                  qui porte déjà son unité (« 15€ / h »). Pas de prix saisi → ni prix ni « / an ». */}
              {price && (
                <div className="mt-3.5 flex items-baseline gap-1">
                  <span className="text-[38px] font-extrabold tracking-[-0.03em]">{price}</span>
                  <span className="text-[14px] font-semibold text-muted">/ an</span>
                </div>
              )}
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
