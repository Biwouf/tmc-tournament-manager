import { useSite } from '../../contexts/SiteContext';

/** Valeurs du club — `club.values`, une liste de scalaires rendue en pastilles. */
export default function ValuesSection() {
  const { config } = useSite();
  const values = config.club.values;
  if (values.length === 0) return null;

  return (
    <section className="shell section">
      <h2 className="title">Nos valeurs</h2>
      <div className="mt-6 flex flex-wrap gap-3">
        {values.map((value, index) => (
          <span
            key={index}
            className="rounded-full bg-brand-soft px-5 py-2.5 text-[15px] font-bold text-brand"
          >
            {value}
          </span>
        ))}
      </div>
    </section>
  );
}
