import { useSite } from '../../contexts/SiteContext';
import { useContactDrawer } from '../../contexts/ContactDrawerContext';

/** Bannière CTA de bas d'accueil — `home.cta_*`. */
export default function CtaSection() {
  const { config } = useSite();
  const { openDrawer } = useContactDrawer();
  const { home } = config;
  if (!home.cta_title && !home.cta_text && !home.cta_button) return null;

  return (
    <section className="shell section">
      <div className="relative overflow-hidden rounded-card bg-text px-8 py-14 text-center text-white sm:px-16">
        <div className="absolute -top-28 -right-20 h-72 w-72 rounded-full bg-brand opacity-15" />
        <div className="relative">
          {home.cta_title && (
            <h2 className="text-[clamp(24px,3.4vw,36px)] font-extrabold">{home.cta_title}</h2>
          )}
          {home.cta_text && (
            <p className="mx-auto mt-4 max-w-xl leading-relaxed text-white/75">{home.cta_text}</p>
          )}
          {home.cta_button && (
            <button type="button" onClick={openDrawer} className="btn btn-primary mt-8">
              {home.cta_button}
            </button>
          )}
        </div>
      </div>
    </section>
  );
}
