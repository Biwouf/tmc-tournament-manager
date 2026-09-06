import PageHeader from '../components/layout/PageHeader';
import LessonsSection from '../components/pricing/LessonsSection';
import MembershipSection from '../components/pricing/MembershipSection';
import OtherFeesSection from '../components/pricing/OtherFeesSection';
import PricingCtaSection from '../components/pricing/PricingCtaSection';
import { useSite } from '../contexts/SiteContext';

export default function PricingPage() {
  const { config } = useSite();
  const { pricing } = config;
  const hasSecondRow = pricing.membership.length > 0 || pricing.other_fees.length > 0;

  return (
    <>
      <PageHeader eyebrow={pricing.season} title={pricing.page_title} note={pricing.note} />
      <LessonsSection />
      {/* Deux colonnes côte à côte dans la maquette ; chacune disparaît si sa liste est vide. */}
      {hasSecondRow && (
        <section className="shell section grid gap-12 md:grid-cols-2">
          <MembershipSection />
          <OtherFeesSection />
        </section>
      )}
      <PricingCtaSection />
    </>
  );
}
