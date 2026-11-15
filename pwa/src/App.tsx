import { useCourseContext } from './hooks/useCourses';
import SignupPage from './pages/SignupPage';
import SignupNotice from './components/SignupNotice';
import PasswordRecoveryPage from './pages/PasswordRecoveryPage';
import { useEffect, useRef, type ReactElement, type ReactNode } from 'react';
import { Routes, Route, Navigate, useLocation } from 'react-router-dom';
import AppHeader from './components/layout/AppHeader';
import { HeaderActionProvider } from './components/layout/HeaderActionContext';
import UpdateBanner from './components/layout/UpdateBanner';
import BottomNav from './components/layout/BottomNav';
import InstallBanner from './components/install/InstallBanner';
import ActuPage from './pages/ActuPage';
import ActuDetailPage from './pages/ActuDetailPage';
import EventDetailPage from './pages/EventDetailPage';
import TeamRencontrePage from './pages/TeamRencontrePage';
import MatchesEquipesPage from './pages/MatchesEquipesPage';
import MatchesPage from './pages/MatchesPage';
import LoginPage from './pages/LoginPage';
import CoursesPage from './pages/CoursesPage';
import ProfilePage from './pages/ProfilePage';
import NewMatchPage from './pages/NewMatchPage';
import LiveMatchPage from './pages/LiveMatchPage';
import { useAuth } from './hooks/useAuth';
import { ClubProvider, useClub } from './contexts/ClubContext';
import { useClubConfig } from './hooks/useClubConfig';
import { applyClubTheme } from './lib/theme';
import { hideSplash, rememberSplashBrand } from './lib/splash';
import { reconcileCoursePush } from './lib/coursePush';
import { buildAppIcons } from './lib/appIcons';
import { useScrollMemory } from './hooks/useScrollMemory';
import OfflineNotice from './components/layout/OfflineNotice';
import { AppLoading } from './components/layout/LoadState';

// Conteneur de défilement des pages (Live, Cours, fiches…) : sa position est retenue par
// entrée d'historique, et restaurée au Retour.
function PwaMain({ className, children }: { className: string; children: ReactNode }) {
  const ref = useRef<HTMLElement>(null);
  useScrollMemory(ref, 'main');
  return <main ref={ref} className={className}>{children}</main>;
}

function RequireAuth({ children }: { children: ReactElement }) {
  const { user, loading } = useAuth();
  const location = useLocation();
  const membership = useCourseContext();
  if (loading) return <AppLoading />;
  if (!user) {
    return <Navigate to="/login" replace state={{ from: location.pathname + location.search }} />;
  }
  if (membership.isPending) return <p className="p-6" role="status">Vérification de votre accès…</p>;
  if (membership.isError) return <div className="p-6" role="alert">Vérification de l’accès impossible. <button className="min-h-11 text-primary underline" onClick={() => void membership.refetch()}>Réessayer</button></div>;
  if (!membership.data?.is_member && !membership.data?.can_manage) return <Navigate to="/actu" replace />;
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
  const { user, loading: authLoading } = useAuth();
  useEffect(() => {
    if (authLoading) return;
    const reconcile = () => { void reconcileCoursePush(user?.id ?? null).catch(() => {
      console.warn('La désactivation des anciennes notifications sera réessayée.');
    }); };
    reconcile();
    window.addEventListener('focus', reconcile);
    window.addEventListener('online', reconcile);
    return () => {
      window.removeEventListener('focus', reconcile);
      window.removeEventListener('online', reconcile);
    };
  }, [user?.id, authLoading]);
  const { club } = useClub();
  const { config, isFetched: configFetched, isSuccess: configLoaded } = useClubConfig();
  const location = useLocation();
  const immersive = /^\/matches\/(?!new(?:\/|$))[^/]+(?:\/score)?\/?$/.test(location.pathname);
  // Écrans d'authentification : ni barre d'onglets ni bannière d'installation (clavier).
  const authScreen = /^\/(?:login|inscription|forgot-password|reset-password)(?:\/|$)/.test(location.pathname);

  // Effet à part de celui du manifeste : les couleurs ne dépendent pas de `club`, seulement
  // de la config. Le logo et les couleurs publics s'appliquent aussi avant connexion.
  useEffect(() => {
    applyClubTheme(document.documentElement, {
      primary: config.brand.color,
      secondary: config.brand.color_secondary,
      accent: config.brand.color_accent,
    });
  }, [config]);

  // La marque n'est mise en cache qu'après un chargement réussi : une erreur réseau ne doit
  // pas effacer le splash du prochain lancement.
  useEffect(() => {
    if (configLoaded) rememberSplashBrand(config.brand);
    if (configFetched) hideSplash();
  }, [config, configLoaded, configFetched]);

  useEffect(() => {
    if (!club) return;
    const name = club.name || 'Application du club';
    // Nom sous l'icône de l'écran d'accueil : le « Nom court » du club s'il est saisi.
    const shortName = config.brand.short_name || name;
    const logo = config.brand.logo || '/icons/club.svg';
    const absoluteLogo = new URL(logo, window.location.href).href;
    const color = config.brand.color || '#e51828';
    document.title = name;
    document.querySelector<HTMLMetaElement>('meta[name="theme-color"]')?.setAttribute('content', color);
    document.querySelector<HTMLMetaElement>('meta[name="apple-mobile-web-app-title"]')?.setAttribute('content', shortName);

    // Icônes de l'ONGLET et de l'écran d'accueil iOS. Le manifest ci-dessous ne couvre que
    // l'installation Android : sans ces liens, un club configuré gardait l'icône par défaut
    // dans son onglet et sur son écran d'accueil iOS. Les liens sont REMPLACÉS et non modifiés
    // — changer `href` en place laisse Safari sur l'icône déjà en cache — et perdent leur
    // `type`, rien n'imposant que le logo du club soit un PNG.
    // ⚠️ Même geste dans `src/App.tsx` (BO), pour le seul `rel="icon"`.
    const setLink = (rel: string, href: string) => {
      const link = document.querySelector<HTMLLinkElement>(`link[rel="${rel}"]`);
      if (!link) return;
      const next = link.cloneNode() as HTMLLinkElement;
      next.removeAttribute('type');
      next.href = href;
      link.replaceWith(next);
    };
    setLink('icon', absoluteLogo);
    setLink('apple-touch-icon', absoluteLogo);

    // Pas de manifest en dev (vite-plugin-pwa ne l'injecte qu'au build) : l'icône iOS suit quand même.
    const manifest = document.querySelector<HTMLLinkElement>('link[rel="manifest"]');
    let url: string | null = null;
    let cancelled = false;
    const publish = (icons: { src: string; sizes: string; type: string; purpose?: string }[]) => {
      if (!manifest) return;
      const next = URL.createObjectURL(new Blob([JSON.stringify({
        id: '/',
        name,
        short_name: shortName,
        description: `L'application de ${name}`,
        lang: 'fr',
        theme_color: color,
        // Fond du splash natif Android, aligné sur le splash HTML.
        background_color: config.brand.color || '#ffffff',
        display: 'standalone',
        start_url: `${window.location.origin}/`,
        scope: `${window.location.origin}/`,
        icons,
      })], { type: 'application/manifest+json' }));
      manifest.href = next;
      if (url) URL.revokeObjectURL(url);
      url = next;
    };
    // D'abord le logo brut (tailles annoncées, comme avant), puis les icônes carrées dès
    // qu'elles sont dessinées : quelques millisecondes, bien avant toute invite d'installation.
    publish([
      { src: absoluteLogo, sizes: config.brand.logo ? '192x192' : 'any', type: config.brand.logo ? 'image/png' : 'image/svg+xml' },
      { src: absoluteLogo, sizes: config.brand.logo ? '512x512' : 'any', type: config.brand.logo ? 'image/png' : 'image/svg+xml' },
    ]);
    void buildAppIcons(absoluteLogo).then(icons => {
      if (cancelled || !icons) return;
      publish([
        { src: icons.any192, sizes: '192x192', type: 'image/png', purpose: 'any' },
        { src: icons.any512, sizes: '512x512', type: 'image/png', purpose: 'any' },
        { src: icons.maskable512, sizes: '512x512', type: 'image/png', purpose: 'maskable' },
      ]);
      setLink('apple-touch-icon', icons.apple180);
    });
    return () => {
      cancelled = true;
      if (url) URL.revokeObjectURL(url);
    };
  }, [club, config]);
  return (
    <HeaderActionProvider>
      {!immersive && <AppHeader />}
      <PwaMain className={`pwa-content${immersive ? ' live-immersive' : ''}${authScreen ? ' no-bottom-nav' : ''}`}>
        {!immersive && <UpdateBanner />}
        {!immersive && <OfflineNotice />}
        {!immersive && <SignupNotice />}
        <Routes>
          <Route path="/inscription" element={<SignupPage />} />
          <Route path="/inscription/confirmee" element={<SignupPage confirmed />} />
          <Route path="/forgot-password" element={<PasswordRecoveryPage key="forgot" />} />
          <Route path="/reset-password" element={<PasswordRecoveryPage key="reset" reset />} />
          <Route path="/" element={<Navigate to="/actu" replace />} />
          <Route path="/login" element={<LoginPage />} />
          <Route path="/cours" element={<CoursesPage />} />
          <Route path="/profil" element={<RequireAuth><ProfilePage /></RequireAuth>} />

          {/* Actu (fusionné) — sous-onglets gérés dans la page */}
          <Route path="/actu" element={<ActuPage />} />
          <Route path="/actus/:id" element={<ActuDetailPage />} />
          <Route path="/evenements/:id" element={<EventDetailPage />} />

          {/* Match équipes (lecture) */}
          <Route path="/matches-equipes" element={<MatchesEquipesPage />} />
          <Route path="/matches-equipes/:id" element={<TeamRencontrePage />} />

          {/* Live public : les commandes sont protégées côté serveur. */}
          <Route path="/matches" element={<MatchesPage />} />
          <Route path="/matches/new" element={<RequireAuth><NewMatchPage /></RequireAuth>} />
          <Route path="/matches/:id" element={<LiveMatchPage />} />
          <Route path="/matches/:id/score" element={<LiveMatchPage />} />

          {/* Compat : anciennes URLs → redirection */}
          <Route path="/actus" element={<Navigate to="/actu?tab=actus" replace />} />
          <Route path="/evenements" element={<Navigate to="/actu?tab=events" replace />} />
        </Routes>
      </PwaMain>
      {!immersive && !authScreen && <InstallBanner />}
      {!immersive && !authScreen && <BottomNav />}
    </HeaderActionProvider>
  );
}
