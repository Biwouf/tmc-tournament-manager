import PageHeader from '../components/layout/PageHeader';
import CourtsSection from '../components/infra/CourtsSection';
import ClubhouseSection from '../components/infra/ClubhouseSection';
import LockerRoomsSection from '../components/infra/LockerRoomsSection';
import { useSite } from '../contexts/SiteContext';

export default function InfraPage() {
  const { config } = useSite();
  return (
    <>
      <PageHeader title={config.infra.page_title} />
      <CourtsSection />
      <ClubhouseSection />
      <LockerRoomsSection />
    </>
  );
}
