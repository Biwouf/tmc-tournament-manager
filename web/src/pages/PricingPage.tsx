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
      {/* Maquette 1887 : « Tarifs · Saison 2024 / 2025 ». La saison est une PRÉCISION du
          sur-titre, pas le sur-titre : sans elle il reste « Tarifs » tout court. */}
      <PageHeader
        overline={pricing.season ? `Tarifs · Saison ${pricing.season}` : 'Tarifs'}
        title={pricing.page_title}
        note={pricing.note}
      />
      <LessonsSection />
      {/* Deux colonnes côte à côte dans la maquette ; chacune disparaît si sa liste est vide. */}
      {hasSecondRow && (
        <section className="shell section grid gap-12 [--sec-top:64px] md:grid-cols-2">
          <MembershipSection />
          <OtherFeesSection />
        </section>
      )}
      <PricingCtaSection />
    </>
  );
}
