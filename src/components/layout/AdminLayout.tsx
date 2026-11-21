import { useEffect, useRef, useState } from 'react';
import { Outlet, useLocation } from 'react-router-dom';
import type { User } from '@supabase/supabase-js';
import { useClub } from '../../contexts/ClubContext';
import { useClubConfig } from '../../hooks/useClubConfig';
import SidebarNav from './SidebarNav';

const FOCUSABLE = 'a[href], button:not([disabled]), input, select, textarea, [tabindex]:not([tabindex="-1"])';

// PR-BO1 — charpente commune des pages protégées (brief back office §4.1) : barre latérale fixe
// de 248 px dès 1024 px, tiroir en dessous (pas de rail tablette, choix du 19/11/2026). Les pages
// ne rendent plus d'en-tête global, seulement un `PageHeader`.
export default function AdminLayout({ user }: { user: User }) {
  const { club } = useClub();
  const { config } = useClubConfig();
  const { pathname } = useLocation();
  const [open, setOpen] = useState(false);
  const menuButton = useRef<HTMLButtonElement>(null);
  const drawer = useRef<HTMLDivElement>(null);

  const clubName = config.brand.name || club?.name || 'Club';
  const logo = config.brand.logo || '/logo.png';

  // Une navigation referme le tiroir.
  const [shownPath, setShownPath] = useState(pathname);
  if (shownPath !== pathname) {
    setShownPath(pathname);
    setOpen(false);
  }

  // Tiroir ouvert : focus piégé dedans, Échap le ferme, focus rendu au bouton menu.
  useEffect(() => {
    if (!open) return;
    const panel = drawer.current;
    const button = menuButton.current;
    (panel?.querySelector<HTMLElement>('[aria-current="page"]') ?? panel?.querySelector<HTMLElement>(FOCUSABLE))?.focus();
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') { setOpen(false); return; }
      if (event.key !== 'Tab' || !panel) return;
      const items = [...panel.querySelectorAll<HTMLElement>(FOCUSABLE)];
      if (items.length === 0) return;
      const first = items[0];
      const last = items[items.length - 1];
      if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
      else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
    };
    document.addEventListener('keydown', onKey);
    const { overflow } = document.body.style;
    document.body.style.overflow = 'hidden';
    return () => {
      document.removeEventListener('keydown', onKey);
      document.body.style.overflow = overflow;
      button?.focus();
    };
  }, [open]);

  return (
    <div className="lg:flex">
      <aside className="hidden border-r border-border bg-card lg:sticky lg:top-0 lg:block lg:h-dvh lg:w-[248px] lg:shrink-0">
        <SidebarNav user={user} clubName={clubName} logo={logo} />
      </aside>

      <div className="min-w-0 flex-1">
        <div className="sticky top-0 z-30 flex items-center gap-3 border-b border-border bg-card/95 px-2 py-1 backdrop-blur lg:hidden">
          <button
            ref={menuButton}
            type="button"
            aria-label="Ouvrir le menu"
            aria-expanded={open}
            aria-controls="admin-drawer"
            onClick={() => setOpen(true)}
            className="grid h-11 w-11 place-items-center rounded-lg text-foreground transition hover:bg-muted"
          >
            <svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true">
              <path d="M4 6h16M4 12h16M4 18h16" />
            </svg>
          </button>
          <img src={logo} alt="" className="h-7 w-7 shrink-0 object-contain" />
          <span className="min-w-0 truncate text-sm font-bold">{clubName}</span>
        </div>

        <Outlet />
      </div>

      {open && (
        <div className="fixed inset-0 z-50 lg:hidden">
          <div aria-hidden className="absolute inset-0 bg-black/40" onClick={() => setOpen(false)} />
          <div
            ref={drawer}
            id="admin-drawer"
            role="dialog"
            aria-modal="true"
            aria-label="Menu"
            className="absolute inset-y-0 left-0 flex w-[min(300px,85vw)] flex-col bg-card shadow-xl"
          >
            <div className="flex justify-end px-2 pt-2">
              <button
                type="button"
                aria-label="Fermer le menu"
                onClick={() => setOpen(false)}
                className="grid h-11 w-11 place-items-center rounded-lg text-muted-foreground transition hover:bg-muted"
              >
                <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true">
                  <path d="M6 6l12 12M18 6 6 18" />
                </svg>
              </button>
            </div>
            <div className="min-h-0 flex-1">
              <SidebarNav user={user} clubName={clubName} logo={logo} />
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
