import type { ReactNode } from 'react';
import { useLocation } from 'react-router-dom';
import PageHeader, { type Crumb } from '../layout/PageHeader';

interface Props {
  title: string;
  subtitle?: string;
  /** Niveaux entre « Rencontres » et la page courante, dans l'ordre. */
  parents?: readonly Crumb[];
  actions?: ReactNode;
}

const TABS = [
  { to: '/team-matches', label: 'Calendrier' },
  { to: '/team-matches/admin', label: 'Saisons et équipes' },
];

// PR-BO1 — habillage des pages Rencontres sur `PageHeader`. Les deux pages racines portent les
// onglets « Calendrier » / « Saisons et équipes » (ex-cartes « Matches par équipe » et « Saisons &
// équipes ») ; les sous-pages, un fil d'Ariane « Rencontres › … › ». Plus de déconnexion ni de
// « ← Accueil » : c'est la barre latérale.
export default function TeamMatchesHeader({ title, subtitle, parents = [], actions }: Props) {
  const { pathname } = useLocation();
  const root = TABS.some((tab) => tab.to === pathname);

  return (
    <PageHeader
      title={title}
      description={subtitle}
      breadcrumb={root ? undefined : [{ label: 'Rencontres', to: '/team-matches' }, ...parents]}
      actions={actions}
      tabs={root ? TABS : undefined}
    />
  );
}
