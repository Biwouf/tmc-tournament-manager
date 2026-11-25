import type { ClubRole } from '../../contexts/ClubRoleContext';
import { inboxTotal, type AdminInbox } from '../../lib/adminInbox';

// PR-BO1 — arborescence de la barre latérale (brief back office §2.1). Les rôles reprennent la
// matrice de MULTI_TENANT.md §4 : le masquage n'est que du confort, la
// RLS et les gardes de route (`adminOnly`) restent le contrôle d'accès.

export interface NavItem {
  to: string;
  label: string;
  roles: readonly ClubRole[];
  /** Autres préfixes de chemin qui rendent l'entrée active (sous-pages, alias). */
  match?: readonly string[];
  /** Compteur lu dans `admin_inbox`. `neutral` : information, rien à faire (pastille grise). */
  counter?: { value: (inbox: AdminInbox) => number; label: string; neutral?: boolean };
}

export interface NavGroup {
  label: string | null;
  items: readonly NavItem[];
}

const STAFF = ['admin', 'manager'] as const;
const ADMIN = ['admin'] as const;
const ALL = ['admin', 'manager', 'member'] as const;

export const NAV_GROUPS: readonly NavGroup[] = [
  { label: null, items: [{ to: '/', label: 'Accueil', roles: ALL, counter: { value: inboxTotal, label: 'à traiter' } }] },
  {
    label: 'Adhérents',
    items: [
      { to: '/admin/members', label: 'Adhérents', roles: ADMIN, counter: { value: (i) => i.signup_pending, label: 'demandes en attente' } },
      { to: '/courses', label: 'Cours', roles: ADMIN, counter: { value: (i) => i.course_pending, label: 'inscriptions en attente' } },
    ],
  },
  {
    label: 'Sportif',
    items: [
      { to: '/team-matches', label: 'Rencontres', roles: STAFF, counter: { value: (i) => i.scores_to_enter, label: 'scores à saisir' } },
      { to: '/live-score', label: 'Live score', roles: ALL, counter: { value: (i) => i.live_count, label: 'en cours', neutral: true } },
      { to: '/tmc-planning', label: 'Tournois TMC', roles: STAFF },
    ],
  },
  {
    label: 'Communication',
    items: [
      { to: '/actus', label: 'Actus', roles: STAFF },
      { to: '/events', label: 'Événements', roles: STAFF },
      { to: '/medias', label: 'Visuels', roles: STAFF },
      { to: '/admin/messages', label: 'Messages', roles: ADMIN },
    ],
  },
  {
    label: 'Club',
    items: [
      { to: '/admin/site', label: 'Site et identité', roles: ADMIN },
      { to: '/admin/social', label: 'Réseaux sociaux', roles: ADMIN },
    ],
  },
];

/** Console plateforme : `isSuperAdmin` seul, jamais un rôle de club (cf. `superAdminOnly`). */
export const PLATFORM_ITEM: NavItem = { to: '/super-admin', label: 'Console plateforme', roles: [] };

export function isActive(item: NavItem, pathname: string): boolean {
  if (item.to === '/') return pathname === '/';
  return [item.to, ...(item.match ?? [])].some(
    (prefix) => pathname === prefix || pathname.startsWith(`${prefix}/`),
  );
}

/** Groupes visibles pour un rôle effectif (super-admin non membre ⇒ `admin`). Groupes vides retirés. */
export function visibleGroups(role: ClubRole | null): NavGroup[] {
  if (!role) return [];
  return NAV_GROUPS.map((group) => ({
    ...group,
    items: group.items.filter((item) => item.roles.includes(role)),
  })).filter((group) => group.items.length > 0);
}
