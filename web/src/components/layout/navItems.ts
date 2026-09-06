/** Navigation principale — statique (web_site_brief.md §2), partagée par le header et le footer. */
export const NAV_ITEMS = [
  { to: '/', label: 'Accueil' },
  { to: '/club', label: 'Le Club' },
  { to: '/infrastructures', label: 'Infrastructures' },
  { to: '/tarifs', label: 'Tarifs' },
  { to: '/contact', label: 'Contact' },
] as const;
