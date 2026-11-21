import { Link, useLocation } from 'react-router-dom';
import type { User } from '@supabase/supabase-js';
import { useClubRole } from '../../contexts/ClubRoleContext';
import { PLATFORM_ITEM, isActive, visibleGroups, type NavItem } from './navItems';
import UserMenu from './UserMenu';

function NavLink({ item, pathname }: { item: NavItem; pathname: string }) {
  const active = isActive(item, pathname);
  return (
    <Link
      to={item.to}
      aria-current={active ? 'page' : undefined}
      className={`relative flex min-h-11 items-center rounded-lg px-3 text-sm font-semibold transition lg:min-h-9 ${
        active ? 'bg-muted text-foreground' : 'text-muted-foreground hover:bg-muted/60 hover:text-foreground'
      }`}
    >
      {/* Seul usage décoratif de la couleur du club dans la barre (brief §2.1). */}
      {active && <span aria-hidden className="absolute -left-3 top-2 bottom-2 w-[3px] rounded-r bg-primary" />}
      {item.label}
    </Link>
  );
}

// PR-BO1 — contenu de la navigation, rendu à l'identique dans la barre fixe (≥ 1024 px) et dans
// le tiroir mobile (`AdminLayout`). Nom et logo viennent du layout, qui lit `club_settings` UNE
// fois (`useClubConfig` n'est pas un provider : chaque appel relit).
export default function SidebarNav({ user, clubName, logo }: { user: User; clubName: string; logo: string }) {
  const { pathname } = useLocation();
  const { role, isSuperAdmin } = useClubRole();
  const effectiveRole = isSuperAdmin ? 'admin' : role;

  return (
    <div className="flex h-full flex-col gap-2 px-3 py-4">
      <div className="flex items-center gap-3 px-2 pb-2">
        <img src={logo} alt="" className="h-8 w-8 shrink-0 object-contain" />
        <span className="min-w-0 truncate text-sm font-bold">{clubName}</span>
      </div>
      <nav aria-label="Navigation principale" className="min-h-0 flex-1 overflow-y-auto pl-3">
        {visibleGroups(effectiveRole).map((group) => (
          <div key={group.label ?? 'root'} className="mb-2">
            {group.label && (
              <p className="px-3 pb-1 pt-3 text-[11px] font-bold uppercase tracking-[0.06em] text-muted-foreground">
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
            <p className="px-3 pb-1 pt-3 text-[11px] font-bold uppercase tracking-[0.06em] text-muted-foreground">Plateforme</p>
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
