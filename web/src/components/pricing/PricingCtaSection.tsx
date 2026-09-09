import { useSite } from '../../contexts/SiteContext';
import { useContactDrawer } from '../../contexts/ContactDrawerContext';

/** Bannière d'inscription — `pricing.cta_*`. */
export default function PricingCtaSection() {
  const { config } = useSite();
  const { openDrawer } = useContactDrawer();
  const { pricing } = config;
  if (!pricing.cta_title && !pricing.cta_text && !pricing.cta_button) return null;

  return (
    <section className="shell section [--sec-top:54px]">
      <div className="card flex flex-col items-start justify-between gap-6 p-8 sm:flex-row sm:items-center">
        <div>
          {pricing.cta_title && <h3 className="text-xl font-extrabold">{pricing.cta_title}</h3>}
          {pricing.cta_text && <p className="mt-2 text-muted">{pricing.cta_text}</p>}
        </div>
        {pricing.cta_button && (
          <button type="button" onClick={openDrawer} className="btn btn-primary shrink-0">
            {pricing.cta_button}
          </button>
        )}
      </div>
    </section>
  );
}
