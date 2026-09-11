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
              {/* « / an » en dur, même raison qu'en carte de cours (`LessonsSection`). La
                  ligne garde en revanche SA typographie (maquette 1924) : le bloc 38px de la
                  carte ne tiendrait pas dans une ligne. */}
              {price && (
                <div className="flex items-baseline gap-1 whitespace-nowrap">
                  <span className="text-[30px] font-extrabold text-brand">{price}</span>
                  <span className="text-[14px] font-semibold text-muted">/ an</span>
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
