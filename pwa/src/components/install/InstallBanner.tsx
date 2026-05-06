import { useEffect } from 'react';
import { useInstallPrompt } from '../../hooks/useInstallPrompt';

export default function InstallBanner() {
  const { variant, promptInstall, dismiss } = useInstallPrompt();

  useEffect(() => {
    if (variant === null) return;
    document.body.classList.add('has-install-banner');
    return () => {
      document.body.classList.remove('has-install-banner');
    };
  }, [variant]);

  if (variant === null) return null;

  return (
    <div
      className="fixed left-0 right-0 z-40 bg-card border-t border-border"
      style={{
        bottom: 'calc(56px + env(safe-area-inset-bottom))',
        padding: '14px',
      }}
      role="dialog"
      aria-label="Installer l'application"
    >
      <button
        type="button"
        onClick={dismiss}
        aria-label="Fermer"
        className="absolute top-0 right-0 flex items-center justify-center text-muted-foreground"
        style={{ width: 28, height: 28, padding: 8 }}
      >
        <svg width="14" height="14" viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round">
          <path d="M2 2 L12 12 M12 2 L2 12" />
        </svg>
      </button>

      <div className="flex gap-3" style={{ paddingRight: 18 }}>
        <img
          src="/logo.png"
          alt="CAC Tennis"
          className="shrink-0"
          style={{
            width: 44,
            height: 44,
            objectFit: 'contain',
            filter: 'drop-shadow(0 4px 12px rgba(229,24,40,0.3))',
          }}
        />
        <div className="flex-1 min-w-0">
          <div
            className="text-foreground"
            style={{ fontFamily: 'Manrope, sans-serif', fontWeight: 800, fontSize: 14, lineHeight: 1.25 }}
          >
            Le CAC, toujours sur toi
          </div>
          <div
            className="text-muted-foreground"
            style={{ fontFamily: 'Manrope, sans-serif', fontWeight: 400, fontSize: 11.5, lineHeight: 1.4, marginTop: 3 }}
          >
            {variant === 'android'
              ? "Installe l'application du club en cliquant sur le bouton ci-dessous"
              : "Installe l'application du club en suivant les instructions ci-dessous"}
          </div>
        </div>
      </div>

      {variant === 'ios' ? <IosInstructions /> : <AndroidActions onInstall={promptInstall} onLater={dismiss} />}
    </div>
  );
}

function IosInstructions() {
  return (
    <div
      className="bg-primary/10 flex items-center justify-center text-foreground"
      style={{
        marginTop: 10,
        borderRadius: 9,
        padding: '8px 10px',
        fontFamily: 'Manrope, sans-serif',
        fontSize: 11,
        gap: 6,
        flexWrap: 'wrap',
      }}
    >
      <span>Touche</span>
      <ShareIcon />
      <span>· puis</span>
      <PlusBoxIcon />
      <span>Sur l'écran d'accueil</span>
    </div>
  );
}

function AndroidActions({
  onInstall,
  onLater,
}: {
  onInstall: () => Promise<'accepted' | 'dismissed' | 'unavailable'>;
  onLater: () => void;
}) {
  return (
    <div className="flex" style={{ marginTop: 10, gap: 8 }}>
      <button
        type="button"
        onClick={() => {
          void onInstall();
        }}
        className="bg-primary text-primary-foreground flex items-center justify-center"
        style={{
          flex: 1,
          padding: '9px 0',
          borderRadius: 9,
          fontFamily: 'Manrope, sans-serif',
          fontWeight: 700,
          fontSize: 12.5,
          gap: 6,
        }}
      >
        <DownloadIcon />
        <span>Installer</span>
      </button>
      <button
        type="button"
        onClick={onLater}
        className="text-muted-foreground"
        style={{
          padding: '9px 14px',
          borderRadius: 9,
          border: '1px solid hsl(var(--border))',
          background: 'transparent',
          fontFamily: 'Manrope, sans-serif',
          fontWeight: 600,
          fontSize: 12.5,
        }}
      >
        Plus tard
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
      stroke="hsl(var(--primary))"
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
      stroke="hsl(var(--primary))"
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
