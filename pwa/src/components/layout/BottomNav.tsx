// Navigation fixe en bas — 3 onglets : Actus, Événements, Matches
// Hauteur : 56px + safe-area-inset-bottom (iOS).
// L'onglet actif est mis en évidence avec la couleur primaire.

import { NavLink } from 'react-router-dom';

const tabs = [
  { to: '/actus', label: 'Actus', icon: '📰' },
  { to: '/evenements', label: 'Événements', icon: '📅' },
  { to: '/matches', label: 'Matches', icon: '🎾' },
];

export default function BottomNav() {
  return (
    <nav
      className="fixed bottom-0 left-0 right-0 z-50 bg-card border-t border-border flex"
      style={{ paddingBottom: 'env(safe-area-inset-bottom)' }}
    >
      {tabs.map((tab) => (
        <NavLink
          key={tab.to}
          to={tab.to}
          className={({ isActive }) =>
            `flex-1 flex flex-col items-center justify-center h-14 gap-0.5 text-xs font-medium transition-colors ${
              isActive ? 'text-primary' : 'text-muted-foreground'
            }`
          }
        >
          <span className="text-xl leading-none">{tab.icon}</span>
          <span>{tab.label}</span>
        </NavLink>
      ))}
    </nav>
  );
}
