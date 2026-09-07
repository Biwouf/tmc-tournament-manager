import { useSite } from '../../contexts/SiteContext';
import { configImageUrl } from '../../lib/configImage';

/** Vestiaires — `infra.locker_rooms.*`. */
export default function LockerRoomsSection() {
  const { config } = useSite();
  const lockers = config.infra.locker_rooms;
  const image = configImageUrl(lockers.image);
  if (!lockers.title && !lockers.text && !image) return null;

  return (
    <section className="shell section">
      <div className="grid items-center gap-10 md:grid-cols-2">
        {image && (
          <img
            src={image}
            alt=""
            className="aspect-[16/10] w-full rounded-card object-cover shadow-soft"
          />
        )}
        <div>
          {lockers.title && <h2 className="title">{lockers.title}</h2>}
          {lockers.text && <p className="lede mt-4 whitespace-pre-line">{lockers.text}</p>}
        </div>
      </div>
    </section>
  );
}
