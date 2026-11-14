// Navigation fixe en bas — 4 onglets : Actu, Équipes, Live, Cours
// Hauteur : 56px + safe-area-inset-bottom (iOS).
// L'onglet actif est mis en évidence avec la couleur primaire ; il reste actif sur les
// sous-pages de sa rubrique (détail d'actu ou d'événement, fiche rencontre, live).

import { Link, useLocation } from 'react-router-dom';
import ActusIcon from '../icons/ActusIcon';
import TeamMatchesIcon from '../icons/TeamMatchesIcon';
import MatchesIcon from '../icons/MatchesIcon';
import CoursesIcon from '../icons/CoursesIcon';

const tabs = [
  { to: '/actu', label: 'Actu', Icon: ActusIcon, section: /^\/(?:actu|actus|evenements)(?:\/|$)/ }, // header restera "Actualités"
  { to: '/matches-equipes', label: 'Équipes', Icon: TeamMatchesIcon, section: /^\/matches-equipes(?:\/|$)/ },
  { to: '/matches', label: 'Live', Icon: MatchesIcon, section: /^\/matches(?:\/|$)/ },
  { to: '/cours', label: 'Cours', Icon: CoursesIcon, section: /^\/cours(?:\/|$)/ },
];

export default function BottomNav() {
  const { pathname } = useLocation();
  return (
    <nav
      className="fixed bottom-0 left-0 right-0 z-50 bg-card border-t border-border flex"
      style={{ paddingBottom: 'env(safe-area-inset-bottom)' }}
    >
      {tabs.map(({ to, label, Icon, section }) => {
        const isActive = section.test(pathname);
        return (
        <Link
          key={to}
          to={to}
          aria-current={isActive ? 'page' : undefined}
          className={`flex-1 flex flex-col items-center justify-center h-14 gap-0.5 text-xs font-medium transition-colors ${
            isActive ? 'text-primary' : 'text-muted-foreground'
          }`}
        >
          <Icon size={24} className={isActive ? 'text-primary' : 'text-muted-foreground'} />
          <span>{label}</span>
        </Link>
        );
      })}
    </nav>
  );
}
