import { useLocation, useNavigate } from 'react-router-dom';
import { resolveHeader, type HeaderAction } from './headerConfig';
import { useHeaderActionState } from './HeaderActionContext';

const isIOS = () =>
  typeof navigator !== 'undefined' && /iPad|iPhone|iPod/.test(navigator.userAgent);

function ActionButton({ action }: { action: HeaderAction }) {
  if (action.kind === 'icon') {
    return (
      <button
        type="button"
        onClick={action.onClick}
        aria-label={action.label}
        className="flex h-8 w-8 items-center justify-center rounded-full text-foreground active:opacity-70"
      >
        <svg
          xmlns="http://www.w3.org/2000/svg"
          viewBox="0 0 24 24"
          fill="currentColor"
          className="h-5 w-5"
          aria-hidden="true"
        >
          <circle cx="12" cy="5"  r="1.75" />
          <circle cx="12" cy="12" r="1.75" />
          <circle cx="12" cy="19" r="1.75" />
        </svg>
      </button>
    );
  }

  if (action.accent) {
    return (
      <button
        type="button"
        onClick={action.onClick}
        className="h-9 rounded-lg bg-primary px-3 text-sm font-bold text-primary-foreground shadow-sm transition active:brightness-95"
      >
        {action.label}
      </button>
    );
  }

  return (
    <button
      type="button"
      onClick={action.onClick}
      className="h-9 px-3 text-sm font-bold text-primary active:opacity-70"
    >
      {action.label}
    </button>
  );
}

export default function AppHeader() {
  const location = useLocation();
  const navigate = useNavigate();
  const cfg = resolveHeader(location.pathname);
  const action = useHeaderActionState();

  const handleBack = () => {
    if (cfg.backTo) navigate(cfg.backTo);
    else navigate(-1);
  };

  return (
    <header
      className="fixed top-0 left-0 right-0 z-50 h-14 bg-card border-b border-border/60 flex items-center gap-2"
      style={{ paddingLeft: 12, paddingRight: 8 }}
    >
      {cfg.mode === 'root' ? (
        <>
          <img
            src="/icons/icon-192.png"
            alt=""
            aria-hidden="true"
            className="h-8 w-8 rounded-full object-cover shrink-0"
          />
          <h1
            className="flex-1 truncate text-foreground tracking-tight"
            style={{ fontSize: 17, fontWeight: 800 }}
          >
            {cfg.title}
          </h1>
        </>
      ) : (
        <>
          <button
            type="button"
            onClick={handleBack}
            aria-label={`Retour à ${cfg.backLabel ?? 'précédent'}`}
            className="flex min-h-11 min-w-11 items-center gap-1 -ml-2 px-2 text-primary active:opacity-70"
          >
            <svg
              xmlns="http://www.w3.org/2000/svg"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2.5"
              strokeLinecap="round"
              strokeLinejoin="round"
              className="h-5 w-5 shrink-0"
              aria-hidden="true"
            >
              <path d="M15 18l-6-6 6-6" />
            </svg>
            {isIOS() && cfg.backLabel && (
              <span className="truncate text-[15px] font-medium" style={{ maxWidth: 80 }}>
                {cfg.backLabel}
              </span>
            )}
          </button>
          <h2
            className="flex-1 truncate text-foreground tracking-tight"
            style={{ fontSize: 16, fontWeight: 700 }}
          >
            {cfg.title}
          </h2>
        </>
      )}

      {action && <ActionButton action={action} />}
    </header>
  );
}
