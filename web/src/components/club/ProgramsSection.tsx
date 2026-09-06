import { useSite } from '../../contexts/SiteContext';
import { configImageUrl } from '../../lib/configImage';

/** Programmes — `club.programs`. */
export default function ProgramsSection() {
  const { config } = useSite();
  const programs = config.club.programs;
  if (programs.length === 0) return null;

  return (
    <section className="shell section">
      <h2 className="title">Les programmes</h2>
      <div className="mt-8 grid gap-6 sm:grid-cols-2">
        {programs.map((program, index) => {
          const image = configImageUrl(program.image);
          return (
            <article key={index} className="card overflow-hidden">
              {image && <img src={image} alt="" className="aspect-[16/9] w-full object-cover" />}
              <div className="p-6">
                <div className="flex flex-wrap items-center gap-3">
                  <h3 className="text-lg font-extrabold">{program.name}</h3>
                  {program.age && (
                    <span className="rounded-full bg-brand-soft px-3 py-1 text-[12.5px] font-bold text-brand">
                      {program.age}
                    </span>
                  )}
                </div>
                {program.frequency && (
                  <div className="mt-2 text-sm font-semibold text-muted">{program.frequency}</div>
                )}
                {program.description && (
                  <p className="mt-3 text-[15px] leading-relaxed">{program.description}</p>
                )}
              </div>
            </article>
          );
        })}
      </div>
    </section>
  );
}
