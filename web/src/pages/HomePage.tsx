import HeroSection from '../components/home/HeroSection';
import StatsSection from '../components/home/StatsSection';
import SchoolTeaserSection from '../components/home/SchoolTeaserSection';
import InfraTeaserSection from '../components/home/InfraTeaserSection';
import PartnersSection from '../components/home/PartnersSection';
import CtaSection from '../components/home/CtaSection';

export default function HomePage() {
  return (
    <>
      <HeroSection />
      <StatsSection />
      {/* PR10 — bloc « Dernières actualités » (flux `actus`, drapeau `settings.show_news`). */}
      {/* PR10 — bloc « Prochains rendez-vous » (flux `events`, drapeau `settings.show_events`). */}
      <SchoolTeaserSection />
      <InfraTeaserSection />
      <PartnersSection />
      <CtaSection />
    </>
  );
}
