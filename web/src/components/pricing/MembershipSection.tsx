import { useSite } from '../../contexts/SiteContext';
import { formatPrice } from '../../lib/price';

/** Adhésion seule — `pricing.membership`. */
export default function MembershipSection() {
  const { config } = useSite();
  const membership = config.pricing.membership;
  if (membership.length === 0) return null;

  return (
    <div>
      <h2 className="title">Adhésion seule</h2>
      <div className="mt-6 flex flex-col gap-3">
        {membership.map((item, index) => {
          const price = formatPrice(item.price);
          return (
            <div key={index} className="card flex items-center justify-between gap-4 p-5">
              <div>
                <h3 className="font-extrabold">{item.name}</h3>
                {item.subtitle && <div className="text-sm text-muted">{item.subtitle}</div>}
              </div>
              {price && <div className="text-xl font-extrabold text-brand">{price}</div>}
            </div>
          );
        })}
      </div>
    </div>
  );
}
