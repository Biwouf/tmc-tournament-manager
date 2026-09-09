import PageHeader from '../components/layout/PageHeader';
import PresidentSection from '../components/club/PresidentSection';
import ValuesSection from '../components/club/ValuesSection';
import CoachSection from '../components/club/CoachSection';
import ProgramsSection from '../components/club/ProgramsSection';
import BoardSection from '../components/club/BoardSection';
import { useSite } from '../contexts/SiteContext';

export default function ClubPage() {
  const { config } = useSite();
  return (
    <>
      <PageHeader overline="Le club" title={config.club.page_title} narrowTitle />
      <PresidentSection />
      <ValuesSection />
      <CoachSection />
      <ProgramsSection />
      <BoardSection />
    </>
  );
}
