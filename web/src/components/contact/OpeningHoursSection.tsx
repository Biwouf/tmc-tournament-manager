import { useSite } from '../../contexts/SiteContext';

/** Horaires d'accueil — `contact.opening_hours`. */
export default function OpeningHoursSection() {
  const { config } = useSite();
  const hours = config.contact.opening_hours;
  if (hours.length === 0) return null;

  return (
    <div className="card p-6">
      <h2 className="text-lg font-extrabold">Horaires d'accueil</h2>
      <div className="mt-4 flex flex-col gap-2 text-[15px]">
        {hours.map((slot, index) => (
          <div key={index} className="flex justify-between gap-4 border-b border-line pb-2 last:border-0">
            <span className="font-semibold">{slot.day}</span>
            <span className="text-muted">{slot.time}</span>
          </div>
        ))}
      </div>
    </div>
  );
}
