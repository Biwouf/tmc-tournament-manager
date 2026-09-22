import { useEffect } from 'react';
import { Route, Routes, useLocation } from 'react-router-dom';
import { isPublished, pageAt, type Site } from './lib/site';
import { SiteProvider } from './contexts/SiteContext';
import { ContactDrawerProvider } from './contexts/ContactDrawerContext';
import Header from './components/layout/Header';
import Footer from './components/layout/Footer';
import PwaInstallBridge from './components/install/PwaInstallBridge';
import ContactDrawer from './components/layout/ContactDrawer';
import NotFoundPage from './pages/NotFoundPage';
import HomePage from './pages/HomePage';
import ClubPage from './pages/ClubPage';
import InfraPage from './pages/InfraPage';
import PricingPage from './pages/PricingPage';
import ContactPage from './pages/ContactPage';

/** Une navigation SPA garde la position de scroll : sans ça on arrive au milieu de la page. */
function ScrollToTop() {
  const { pathname } = useLocation();
  useEffect(() => {
    window.scrollTo(0, 0);
  }, [pathname]);
  return null;
}

export default function App({ site }: { site: Site }) {
  const { pathname } = useLocation();
  const page = pageAt(pathname);
  const available = page && site.config[page.key].published && (page.key === 'home' || isPublished(site.config, page));
  return (
    <SiteProvider site={site}>
      <ContactDrawerProvider>
        <ScrollToTop />
        <Header />
        {available && <PwaInstallBridge key={site.club.id} />}
        <main className="page-end min-h-[40vh]">
          {available ? <Routes>
            <Route path="/" element={<HomePage />} />
            <Route path="/club" element={<ClubPage />} />
            <Route path="/infrastructures" element={<InfraPage />} />
            <Route path="/tarifs" element={<PricingPage />} />
            <Route path="/contact" element={<ContactPage />} />
            <Route path="*" element={<NotFoundPage />} />
          </Routes> : <NotFoundPage />}
        </main>
        <Footer />
        <ContactDrawer />
      </ContactDrawerProvider>
    </SiteProvider>
  );
}
