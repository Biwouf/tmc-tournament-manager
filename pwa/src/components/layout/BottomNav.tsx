// Navigation fixe en bas — 3 onglets : Actu, Match équipes, Live
// Hauteur : 56px + safe-area-inset-bottom (iOS).
// L'onglet actif est mis en évidence avec la couleur primaire.

import { NavLink } from 'react-router-dom';
import ActusIcon from '../icons/ActusIcon';
import TeamMatchesIcon from '../icons/TeamMatchesIcon';
import MatchesIcon from '../icons/MatchesIcon';

const tabs = [
  { to: '/actu', label: 'Actu', Icon: ActusIcon },                    // header restera "Actualités"
  { to: '/matches-equipes', label: 'Matchs équipes', Icon: TeamMatchesIcon },
  { to: '/matches', label: 'Live', Icon: MatchesIcon },               // renommé "Matches" → "Live"
];

export default function BottomNav() {
  return (
    <nav
      className="fixed bottom-0 left-0 right-0 z-50 bg-card border-t border-border flex"
      style={{ paddingBottom: 'env(safe-area-inset-bottom)' }}
    >
      {tabs.map(({ to, label, Icon }) => (
        <NavLink
          key={to}
          to={to}
          className={({ isActive }) =>
            `flex-1 flex flex-col items-center justify-center h-14 gap-0.5 text-xs font-medium transition-colors ${
              isActive ? 'text-primary' : 'text-muted-foreground'
            }`
          }
        >
          {({ isActive }) => (
            <>
              <Icon size={24} className={isActive ? 'text-primary' : 'text-muted-foreground'} />
              <span>{label}</span>
            </>
          )}
        </NavLink>
      ))}
    </nav>
  );
}
