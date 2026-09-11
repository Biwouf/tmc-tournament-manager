import NewsSection from '../components/home/NewsSection';
import EventsSection from '../components/home/EventsSection';
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
      <NewsSection />
      <EventsSection />
      <SchoolTeaserSection />
      <InfraTeaserSection />
      <PartnersSection />
      <CtaSection />
    </>
  );
}
