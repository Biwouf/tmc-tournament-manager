import { useEffect } from 'react';
import { Route, Routes, useLocation } from 'react-router-dom';
import { SiteProvider } from './contexts/SiteContext';
import { ContactDrawerProvider } from './contexts/ContactDrawerContext';
import Header from './components/layout/Header';
import Footer from './components/layout/Footer';
import ContactDrawer from './components/layout/ContactDrawer';
import HomePage from './pages/HomePage';
import ClubPage from './pages/ClubPage';
import InfraPage from './pages/InfraPage';
import PricingPage from './pages/PricingPage';
import ContactPage from './pages/ContactPage';

/** Une navigation SPA garde la position de scroll : sans ça on arrive au milieu de la page. */
function ScrollToTop() {
  const { pathname } = useLocation();
  useEffect(() => window.scrollTo(0, 0), [pathname]);
  return null;
}

export default function App() {
  return (
    <SiteProvider>
      <ContactDrawerProvider>
        <ScrollToTop />
        <Header />
        <main className="min-h-[40vh]">
          <Routes>
            <Route path="/" element={<HomePage />} />
            <Route path="/club" element={<ClubPage />} />
            <Route path="/infrastructures" element={<InfraPage />} />
            <Route path="/tarifs" element={<PricingPage />} />
            <Route path="/contact" element={<ContactPage />} />
            {/* Toute autre adresse rend l'accueil : une vitrine n'a pas de 404 utile, et la
                page « club inconnu » est PR13. */}
            <Route path="*" element={<HomePage />} />
          </Routes>
        </main>
        <Footer />
        <ContactDrawer />
      </ContactDrawerProvider>
    </SiteProvider>
  );
}
