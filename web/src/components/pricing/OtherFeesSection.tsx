import { useSite } from '../../contexts/SiteContext';

/** Autres frais & prestations — `pricing.other_fees` (prix en TEXTE : unités variables). */
export default function OtherFeesSection() {
  const { config } = useSite();
  const fees = config.pricing.other_fees;
  if (fees.length === 0) return null;

  return (
    <div>
      <h2 className="title">Autres frais &amp; prestations</h2>
      <div className="card mt-6 divide-y divide-line">
        {fees.map((fee, index) => (
          <div key={index} className="flex items-center justify-between gap-4 px-5 py-4">
            <span className="text-[15px]">{fee.label}</span>
            <span className="font-extrabold text-brand">{fee.price}</span>
          </div>
        ))}
      </div>
    </div>
  );
}
