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
        <img src={config.brand.logo || '/logo.png'} alt="" className="install-banner__logo" />
        <div className="install-banner__text">
          <h2 id="install-banner-title" className="install-banner__title">
            Installez l’application
          </h2>
          {variant === 'ios' ? (
            <IosInstructions />
          ) : (
            <p className="install-banner__description">{clubName} directement depuis votre écran d’accueil.</p>
          )}
        </div>
        {variant === 'android' && <AndroidActions onInstall={promptInstall} />}
        <button
          type="button"
          onClick={dismiss}
          aria-label="Fermer la proposition d’installation"
          className="install-banner__close"
        >
          <svg width="16" height="16" viewBox="0 0 18 18" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true">
            <path d="M3 3 L15 15 M15 3 L3 15" />
          </svg>
        </button>
      </div>
    </div>
  );
}

function IosInstructions() {
  return (
    <p className="install-banner__description install-banner__ios">
      Touchez <ShareIcon /><span className="sr-only">Partager</span> puis « Sur l’écran d’accueil ».
    </p>
  );
}

function AndroidActions({
  onInstall,
}: {
  onInstall: () => Promise<'accepted' | 'dismissed' | 'unavailable'>;
}) {
  const [isPrompting, setIsPrompting] = useState(false);
  const [error, setError] = useState('');
  const [copyStatus, setCopyStatus] = useState('');
  const dialogRef = useRef<HTMLDialogElement>(null);
  const isSamsungInternet = /SamsungBrowser\//i.test(navigator.userAgent);
  // Share the public entry point, never an authentication token or private route.
  const installUrl = `${window.location.origin}/`;

  const copyLink = async () => {
    try {
      await navigator.clipboard.writeText(installUrl);
      setCopyStatus('Lien copié. Ouvrez Chrome et collez-le dans la barre d’adresse.');
    } catch {
      setCopyStatus('Copiez le lien affiché ci-dessous pour l’ouvrir dans Chrome.');
    }
  };

  const install = async () => {
    if (isPrompting) return;
    setIsPrompting(true);
    setError('');
    dialogRef.current?.close();
    try {
      const result = await onInstall();
      if (result === 'unavailable') setError('Installation indisponible. Rechargez la page et réessayez.');
    } catch {
      setError('Impossible d’ouvrir l’installation. Réessayez depuis le menu du navigateur.');
    } finally {
      setIsPrompting(false);
    }
  };

  return (
    <div className="install-banner__actions">
      <button
        type="button"
        onClick={() => {
          if (isSamsungInternet) {
            setCopyStatus('');
            dialogRef.current?.showModal();
          } else {
            void install();
          }
        }}
        disabled={isPrompting}
        className="install-banner__install-button"
      >
        {isPrompting ? 'Ouverture…' : 'Installer'}
      </button>
      {error && <p role="alert" className="install-banner__error">{error}</p>}
      {isSamsungInternet && (
        <dialog ref={dialogRef} className="install-help" aria-labelledby="install-help-title">
          <h2 id="install-help-title">Installation sur Samsung</h2>
          <p>
            Google Play Protect peut demander une vérification. Si vous voyez
            « Analyse d’appli recommandée », choisissez <strong>« Analyser l’appli »</strong>,
            puis suivez les indications pour terminer l’installation.
          </p>
          <p>
            Dans certains cas, un avertissement peut apparaître avec une option
            <strong> « Installer quand même »</strong>, masquée par défaut dans les détails
            du message. Si vous avez ouvert le lien officiel fourni par votre club, vous pouvez
            afficher ces détails et sélectionner cette option pour poursuivre l’installation.
          </p>
          <div className="install-help__actions">
            <button type="button" className="install-help__continue" onClick={() => void install()} disabled={isPrompting}>
              Continuer l’installation
            </button>
            <button type="button" onClick={() => dialogRef.current?.close()}>Fermer</button>
          </div>
          <details className="install-help__chrome">
            <summary>Installer avec Google Chrome</summary>
            <p>
              Si un autre avertissement apparaît, essayez d’installer l’application depuis
              <strong> Google Chrome</strong>.
            </p>
            <p>Dans Chrome, collez ce lien, puis choisissez ⋮ → Ajouter à l’écran d’accueil → Installer.</p>
            <label htmlFor="install-help-url">Lien de l’application</label>
            <input id="install-help-url" value={installUrl} readOnly onFocus={event => event.currentTarget.select()} />
            <button type="button" onClick={() => void copyLink()}>Copier le lien</button>
            <p role="status">{copyStatus}</p>
          </details>
        </dialog>
      )}
    </div>
  );
}

function ShareIcon() {
  return (
    <svg
      width="15"
      height="15"
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
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
