import { useEffect, useRef, useState } from 'react';
import { useInstallPrompt } from '../../hooks/useInstallPrompt';
import { useClub } from '../../contexts/ClubContext';
import { useClubConfig } from '../../hooks/useClubConfig';

export default function InstallBanner() {
  const { variant, promptInstall, dismiss } = useInstallPrompt();
  const { club } = useClub();
  const { config } = useClubConfig();
  const clubName = club?.name ?? 'votre club';
  const bannerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (variant === null) return;
    const banner = bannerRef.current;

    const updateReservedSpace = () => {
      const height = banner?.getBoundingClientRect().height ?? 0;
      document.body.style.setProperty('--install-banner-height', `${Math.ceil(height)}px`);
    };

    document.body.classList.add('has-install-banner');
    updateReservedSpace();

    let observer: ResizeObserver | null = null;
    if (typeof ResizeObserver !== 'undefined' && banner) {
      observer = new ResizeObserver(updateReservedSpace);
      observer.observe(banner);
    }
    window.addEventListener('resize', updateReservedSpace);

    return () => {
      observer?.disconnect();
      window.removeEventListener('resize', updateReservedSpace);
      document.body.classList.remove('has-install-banner');
      document.body.style.removeProperty('--install-banner-height');
    };
  }, [variant]);

  if (variant === null) return null;

  return (
    <div
      ref={bannerRef}
      className="install-banner"
      role="region"
      aria-labelledby="install-banner-title"
    >
      <div className="install-banner__card">
        <button
          type="button"
          onClick={dismiss}
          aria-label="Fermer la proposition d’installation"
          className="install-banner__close"
        >
          <svg width="18" height="18" viewBox="0 0 18 18" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true">
            <path d="M3 3 L15 15 M15 3 L3 15" />
          </svg>
        </button>

        <div className="install-banner__intro">
          <div className="install-banner__logo-wrap">
            <img
              src={config.brand.logo || '/logo.png'}
              alt=""
              className="install-banner__logo"
            />
          </div>
          <div className="min-w-0 flex-1">
            <div className="install-banner__eyebrow">APPLICATION DU CLUB</div>
            <h2 id="install-banner-title" className="install-banner__title">
              Installe {clubName}
            </h2>
            <p className="install-banner__description">
              Accède plus vite aux actualités, matchs et services du club.
            </p>
          </div>
        </div>

        {variant === 'ios' ? <IosInstructions /> : <AndroidActions onInstall={promptInstall} />}
      </div>
    </div>
  );
}

function IosInstructions() {
  return (
    <div className="install-banner__ios-instructions">
      <span>1. Touche</span>
      <ShareIcon />
      <span className="install-banner__separator">puis</span>
      <span>2. Choisis</span>
      <PlusBoxIcon />
      <span>Sur l’écran d’accueil</span>
    </div>
  );
}

function AndroidActions({
  onInstall,
}: {
  onInstall: () => Promise<'accepted' | 'dismissed' | 'unavailable'>;
}) {
  const [isPrompting, setIsPrompting] = useState(false);

  const install = async () => {
    if (isPrompting) return;
    setIsPrompting(true);
    try {
      await onInstall();
    } finally {
      setIsPrompting(false);
    }
  };

  return (
    <div className="install-banner__actions">
      <button
        type="button"
        onClick={() => void install()}
        disabled={isPrompting}
        className="install-banner__install-button"
      >
        <DownloadIcon />
        <span>{isPrompting ? 'Ouverture…' : 'Installer l’application'}</span>
      </button>
    </div>
  );
}

function ShareIcon() {
  return (
    <svg
      width="13"
      height="13"
      viewBox="0 0 16 16"
      fill="none"
      stroke="white"
      strokeWidth="1.5"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M8 10V2" />
      <path d="M5 5l3-3 3 3" />
      <path d="M3.5 8.5v4a1.5 1.5 0 0 0 1.5 1.5h6a1.5 1.5 0 0 0 1.5-1.5v-4" />
    </svg>
  );
}

function PlusBoxIcon() {
  return (
    <svg
      width="13"
      height="13"
      viewBox="0 0 16 16"
      fill="none"
      stroke="white"
      strokeWidth="1.5"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <rect x="2" y="2" width="12" height="12" rx="2.5" />
      <path d="M8 5.5v5" />
      <path d="M5.5 8h5" />
    </svg>
  );
}

function DownloadIcon() {
  return (
    <svg
      width="14"
      height="14"
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.6"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M8 2v8" />
      <path d="M5 7l3 3 3-3" />
      <path d="M3 12.5v.5a1.5 1.5 0 0 0 1.5 1.5h7a1.5 1.5 0 0 0 1.5-1.5v-.5" />
    </svg>
  );
}
