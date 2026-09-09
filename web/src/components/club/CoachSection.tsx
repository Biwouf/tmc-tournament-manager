import ConfigImage from '../ConfigImage';
import { useSite } from '../../contexts/SiteContext';
import { configImageUrl } from '../../lib/configImage';
import { focalPointStyle } from '../../lib/focalPoint';

/** Encadrement — `club.coach.*` + `club.methods` + `club.levels`. */
export default function CoachSection() {
  const { config } = useSite();
  const { coach, methods, levels } = config.club;
  const photo = configImageUrl(coach.photo);

  const hasCoach = coach.name || coach.role || coach.bio || coach.credentials.length > 0 || photo;
  if (!hasCoach && methods.length === 0 && levels.length === 0) return null;

  const subtitle = [coach.role, ...coach.credentials].filter(Boolean).join(' · ');

  return (
    <section className="shell section [--sec-top:84px]">
      <h2 className="title">L'encadrement</h2>
      <div className="mt-8 grid gap-10 md:grid-cols-[320px_1fr]">
        {photo && (
          <ConfigImage loading="lazy" decoding="async"
            src={photo}
            alt={coach.name || ''}
            className="aspect-[4/5] w-full rounded-card object-cover shadow-soft"
            style={focalPointStyle(coach.photo_focal)}
          />
        )}
        <div>
          {coach.name && <h3 className="text-2xl font-extrabold">{coach.name}</h3>}
          {subtitle && <div className="mt-1 text-sm font-semibold text-muted">{subtitle}</div>}
          {coach.bio && (
            <p className="mt-5 leading-relaxed whitespace-pre-line">{coach.bio}</p>
          )}

          {(methods.length > 0 || levels.length > 0) && (
            <div className="mt-8 grid gap-8 sm:grid-cols-2">
              {methods.length > 0 && <ItemList title="Méthodes" items={methods} />}
              {levels.length > 0 && <ItemList title="Niveaux" items={levels} />}
            </div>
          )}
        </div>
      </div>
    </section>
  );
}

function ItemList({ title, items }: { title: string; items: readonly string[] }) {
  return (
    <div>
      <div className="text-[13px] font-bold tracking-[0.14em] text-muted uppercase">{title}</div>
      <div className="mt-3 flex flex-col gap-2">
        {items.map((item, index) => (
          <div key={index} className="text-[15px]">
            <span className="mr-2 font-bold text-brand">›</span>
            {item}
          </div>
        ))}
      </div>
    </div>
  );
}
