import { Link, useLocation } from 'react-router-dom';
import type { User } from '@supabase/supabase-js';
import { useAdminInbox } from '../../lib/adminInbox';
import { useClubRole } from '../../contexts/ClubRoleContext';
import { PLATFORM_ITEM, isActive, visibleGroups, type NavItem } from './navItems';
import UserMenu from './UserMenu';

function NavLink({ item, pathname }: { item: NavItem; pathname: string }) {
  const active = isActive(item, pathname);
  // Non-admin : `inbox` reste null, donc aucun compteur.
  const { inbox } = useAdminInbox();
  const count = inbox && item.counter ? item.counter.value(inbox) : 0;
  return (
    <Link
      to={item.to}
      // « page » seulement sur la page même ; sur une sous-page (`/courses/types`), l'entrée
      // parente est « true » : elle contient la page courante sans l'être.
      aria-current={active ? (pathname === item.to ? 'page' : 'true') : undefined}
      className={`relative flex min-h-11 items-center rounded-lg px-3 text-sm transition lg:min-h-9 ${
        active ? 'bg-muted font-semibold text-foreground' : 'font-medium text-foreground/90 hover:bg-muted/60 hover:text-foreground'
      }`}
    >
      {/* Seul usage décoratif de la couleur du club dans la barre (brief §2.1). */}
      {active && <span aria-hidden className="absolute -left-3 top-2 bottom-2 w-[3px] rounded-r bg-primary" />}
      <span className="min-w-0 flex-1">{item.label}</span>
      {item.counter && count > 0 && (
        <span
          className={`ml-2 inline-flex h-5 min-w-5 shrink-0 items-center justify-center rounded-full px-1.5 text-xs font-semibold tabular-nums ${
            item.counter.neutral ? 'bg-muted text-muted-foreground ring-1 ring-border' : 'bg-foreground text-background'
          }`}
        >
          {count}
          <span className="sr-only"> {item.counter.label}</span>
        </span>
      )}
    </Link>
  );
}

// PR-BO1 — contenu de la navigation, rendu à l'identique dans la barre fixe (≥ 1024 px) et dans
// le tiroir mobile (`AdminLayout`). Nom et logo viennent du layout, qui lit `club_settings` UNE
// fois (`useClubConfig` n'est pas un provider : chaque appel relit).
// `onCollapse` : barre fixe seulement (bouton « Replier le menu ») ; absent dans le tiroir.
export default function SidebarNav({ user, clubName, logo, onCollapse }: {
  user: User;
  clubName: string;
  logo: string;
  onCollapse?: () => void;
}) {
  const { pathname } = useLocation();
  const { role, isSuperAdmin } = useClubRole();
  const effectiveRole = isSuperAdmin ? 'admin' : role;

  return (
    <div className="flex h-full flex-col gap-2 px-3 py-4">
      <div className="flex items-center gap-3 px-2 pb-2">
        <img src={logo} alt="" className="h-8 w-8 shrink-0 object-contain" />
        <span className="min-w-0 flex-1 truncate text-sm font-bold">{clubName}</span>
        {onCollapse && (
          <button
            type="button"
            data-collapse
            aria-label="Replier le menu"
            title="Replier le menu"
            onClick={onCollapse}
            className="grid h-9 w-9 shrink-0 place-items-center rounded-lg text-muted-foreground transition hover:bg-muted hover:text-foreground"
          >
            <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <rect x="3" y="4" width="18" height="16" rx="2" />
              <path d="M9 4v16M15 10l-2 2 2 2" />
            </svg>
          </button>
        )}
      </div>
      <nav aria-label="Navigation principale" className="min-h-0 flex-1 overflow-y-auto pl-3">
        {visibleGroups(effectiveRole).map((group) => (
          <div key={group.label ?? 'root'} className="mb-2">
            {group.label && (
              <p className="px-3 pb-1 pt-5 text-[11px] font-semibold uppercase tracking-[0.06em] text-muted-foreground">
                {group.label}
              </p>
            )}
            <ul className="space-y-0.5">
              {group.items.map((item) => (
                <li key={item.to}><NavLink item={item} pathname={pathname} /></li>
              ))}
            </ul>
          </div>
        ))}
        {isSuperAdmin && (
          <div className="mb-2">
            <p className="px-3 pb-1 pt-5 text-[11px] font-semibold uppercase tracking-[0.06em] text-muted-foreground">Plateforme</p>
            <ul><li><NavLink item={PLATFORM_ITEM} pathname={pathname} /></li></ul>
          </div>
        )}
      </nav>
      <div className="border-t border-border pt-2">
        <UserMenu user={user} role={role} isSuperAdmin={isSuperAdmin} />
      </div>
    </div>
  );
}
