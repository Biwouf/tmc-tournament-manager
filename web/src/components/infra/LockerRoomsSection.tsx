import ConfigImage from '../ConfigImage';
import { useSite } from '../../contexts/SiteContext';
import { configImageUrl } from '../../lib/configImage';
import { focalPointStyle } from '../../lib/focalPoint';

/** Vestiaires — `infra.locker_rooms.*`. */
export default function LockerRoomsSection() {
  const { config } = useSite();
  const lockers = config.infra.locker_rooms;
  const image = configImageUrl(lockers.image);
  if (!lockers.title && !lockers.text && !image) return null;

  return (
    <section className="shell section [--sec-top:74px]">
      <div className="grid items-center gap-10 md:grid-cols-2">
        {image && (
          <ConfigImage loading="lazy" decoding="async"
            src={image}
            alt={lockers.title || 'Vestiaires'}
            className="aspect-[16/10] w-full rounded-card object-cover shadow-soft"
            style={focalPointStyle(lockers.image_focal)}
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
