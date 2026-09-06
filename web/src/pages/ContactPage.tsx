import PageHeader from '../components/layout/PageHeader';
import ContactForm from '../components/contact/ContactForm';
import ContactDetailsSection from '../components/contact/ContactDetailsSection';
import OpeningHoursSection from '../components/contact/OpeningHoursSection';
import { useSite } from '../contexts/SiteContext';

export default function ContactPage() {
  const { config } = useSite();
  return (
    <>
      <PageHeader title={config.contact.page_title} />
      <section className="shell section grid gap-8 md:grid-cols-[1.15fr_.85fr]">
        {/* Les champs sont fixes (web_site_brief.md §5.6) : le formulaire est du design, pas de
            la config — il est rendu même quand le club n'a rien saisi. */}
        <div className="card p-6 sm:p-8">
          <ContactForm />
        </div>
        <div className="flex flex-col gap-6">
          <ContactDetailsSection />
          <OpeningHoursSection />
        </div>
      </section>
    </>
  );
}
