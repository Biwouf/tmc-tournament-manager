import { useSite } from '../../contexts/SiteContext';
import { useContactDrawer } from '../../contexts/ContactDrawerContext';

/**
 * Bandeau d'inscription — `pricing.cta_*` (maquette 1944).
 *
 * Bandeau SOMBRE (`--text`) et non une carte claire : c'est le dernier appel de la page tarifs,
 * il doit trancher sur le fond. Le `padding: clamp(32px, 4vw, 52px)` de la maquette lui donne sa
 * hauteur — un `p-8` fixe le laissait écrasé sur grand écran.
 *
 * ⚠️ À NE PAS confondre avec `home.cta_*` (`home/CtaSection.tsx`, maquette 1721-1726), qui est
 * un bloc DIFFÉRENT et volontairement plus haut : `clamp(40px, 6vw, 72px)`, centré, et son
 * cercle décoratif en absolu. Aligner l'un sur l'autre les rendrait interchangeables alors que
 * la maquette les distingue.
 *
 * Les 90 px de respiration avant le pied de page viennent de `.page-end`, posé une fois sur
 * `<main>` : cette section, dernière de `/tarifs` quand elle est rendue, n'a pas à les porter.
 */
export default function PricingCtaSection() {
  const { config } = useSite();
  const { openDrawer } = useContactDrawer();
  const { pricing } = config;
  if (!pricing.cta_title && !pricing.cta_text && !pricing.cta_button) return null;

  return (
    <section className="shell section [--sec-top:54px]">
      <div className="flex flex-wrap items-center justify-between gap-6 rounded-card bg-text p-[clamp(32px,4vw,52px)] text-white">
        <div>
          {pricing.cta_title && (
            <h3 className="text-[clamp(22px,3vw,30px)] font-extrabold">{pricing.cta_title}</h3>
          )}
          {pricing.cta_text && (
            <p className="mt-1.5 text-[16px] text-white/[0.78]">{pricing.cta_text}</p>
          )}
        </div>
        {pricing.cta_button && (
          <button
            type="button"
            onClick={openDrawer}
            /* `.btn-primary` porte déjà le fond `--brand`, le survol `--brand-dark` et le rayon
               999 px ; seules la taille et les marges internes de la maquette s'y ajoutent. */
            className="btn btn-primary shrink-0 px-[30px] py-[15px] text-[16px]"
          >
            {pricing.cta_button}
          </button>
        )}
      </div>
    </section>
  );
}
