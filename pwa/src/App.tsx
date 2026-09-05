import { useEffect, type ReactElement } from 'react';
import { Routes, Route, Navigate, useLocation } from 'react-router-dom';
import AppHeader from './components/layout/AppHeader';
import { HeaderActionProvider } from './components/layout/HeaderActionContext';
import BottomNav from './components/layout/BottomNav';
import InstallBanner from './components/install/InstallBanner';
import ActuPage from './pages/ActuPage';
import ActuDetailPage from './pages/ActuDetailPage';
import EventDetailPage from './pages/EventDetailPage';
import MatchesEquipesPage from './pages/MatchesEquipesPage';
import MatchesPage from './pages/MatchesPage';
import LoginPage from './pages/LoginPage';
import NewMatchPage from './pages/NewMatchPage';
import LiveMatchPage from './pages/LiveMatchPage';
import { useAuth } from './hooks/useAuth';
import { ClubProvider, useClub } from './contexts/ClubContext';
import { useClubConfig } from './hooks/useClubConfig';
import { applyClubTheme } from './lib/theme';

function RequireAuth({ children }: { children: ReactElement }) {
  const { user, loading } = useAuth();
  const location = useLocation();
  if (loading) return null;
  if (!user) {
    return <Navigate to="/login" replace state={{ from: location.pathname }} />;
  }
  return children;
}

export default function App() {
  return (
    <ClubProvider>
      <AppShell />
    </ClubProvider>
  );
}

function AppShell() {
  const { club, loading: clubLoading } = useClub();
  const { config } = useClubConfig();

  // Effet à part de celui du manifeste : les couleurs ne dépendent pas de `club`, seulement
  // de la config. Elles s'appliquent donc dès sa lecture — laquelle est authentifiée, comme le
  // logo : avant connexion, la PWA garde les valeurs de `index.css`.
  useEffect(() => {
    applyClubTheme(document.documentElement, {
      primary: config.brand.color,
      secondary: config.brand.color_secondary,
      accent: config.brand.color_accent,
    });
  }, [config]);

  useEffect(() => {
    if (!club) return;
    const name = club.name || 'Application du club';
    const logo = config.brand.logo || '/icons/icon-192.png';
    const absoluteLogo = new URL(logo, window.location.href).href;
    document.title = name;
    document.querySelector<HTMLMetaElement>('meta[name="theme-color"]')
      ?.setAttribute('content', config.brand.color || '#e51828');

    // Icônes de l'ONGLET et de l'écran d'accueil iOS. Le manifest ci-dessous ne couvre que
    // l'installation Android : sans ces deux lignes, un club configuré gardait le logo CAC
    // dans son onglet et sur son écran d'accueil iOS. Les liens sont REMPLACÉS et non modifiés
    // — changer `href` en place laisse Safari sur l'icône déjà en cache — et perdent leur
    // `type`, rien n'imposant que le logo du club soit un PNG.
    // ⚠️ Même geste dans `src/App.tsx` (BO), pour le seul `rel="icon"`.
    for (const rel of ['icon', 'apple-touch-icon']) {
      const link = document.querySelector<HTMLLinkElement>(`link[rel="${rel}"]`);
      if (!link) continue;
      const next = link.cloneNode() as HTMLLinkElement;
      next.removeAttribute('type');
      next.href = absoluteLogo;
      link.replaceWith(next);
    }

    const manifest = document.querySelector<HTMLLinkElement>('link[rel="manifest"]');
    if (!manifest) return;
    const blob = new Blob([JSON.stringify({
      name,
      short_name: name,
      description: `L'application de ${name}`,
      theme_color: config.brand.color || '#e51828',
      background_color: '#ffffff',
      display: 'standalone',
      start_url: `${window.location.origin}/`,
      icons: [
        { src: absoluteLogo, sizes: '192x192', type: 'image/png' },
        { src: absoluteLogo, sizes: '512x512', type: 'image/png' },
      ],
    })], { type: 'application/manifest+json' });
    const url = URL.createObjectURL(blob);
    manifest.href = url;
    return () => URL.revokeObjectURL(url);
  }, [club, config]);
  if (clubLoading) return null;

  return (
    <HeaderActionProvider>
      <AppHeader />
      <main className="pwa-content">
        <Routes>
          <Route path="/" element={<Navigate to="/actu" replace />} />
          <Route path="/login" element={<LoginPage />} />

          {/* Actu (fusionné) — sous-onglets gérés dans la page */}
          <Route path="/actu" element={<ActuPage />} />
          <Route path="/actus/:id" element={<ActuDetailPage />} />
          <Route path="/evenements/:id" element={<EventDetailPage />} />

          {/* Match équipes (lecture) */}
          <Route path="/matches-equipes" element={<MatchesEquipesPage />} />

          {/* Live (inchangé) */}
          <Route path="/matches" element={<MatchesPage />} />
          <Route path="/matches/new" element={<RequireAuth><NewMatchPage /></RequireAuth>} />
          <Route path="/matches/:id/score" element={<RequireAuth><LiveMatchPage /></RequireAuth>} />

          {/* Compat : anciennes URLs → redirection */}
          <Route path="/actus" element={<Navigate to="/actu?tab=actus" replace />} />
          <Route path="/evenements" element={<Navigate to="/actu?tab=events" replace />} />
        </Routes>
      </main>
      <InstallBanner />
      <BottomNav />
    </HeaderActionProvider>
  );
}
