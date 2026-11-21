import type { ReactNode } from 'react';
import { Link, useLocation } from 'react-router-dom';

export interface Crumb {
  label: string;
  to?: string;
}

export interface PageTab {
  to: string;
  label: string;
}

interface Props {
  title: ReactNode;
  description?: ReactNode;
  /** Niveaux au-dessus de la page (≥ 2 niveaux), la page courante n'y figure pas. */
  breadcrumb?: readonly Crumb[];
  actions?: ReactNode;
  tabs?: readonly PageTab[];
}

// PR-BO1 — en-tête unique des pages du BO (brief back office §4.1), à la place des trois
// habillages d'avant (header standard, `CourseShell`, `TeamMatchesHeader`). Ni « Se déconnecter »
// (menu utilisateur de la barre latérale) ni « ← Accueil » (barre latérale) : un fil d'Ariane
// pour les sous-pages.
export default function PageHeader({ title, description, breadcrumb, actions, tabs }: Props) {
  const { pathname } = useLocation();

  return (
    <header className="relative z-20 border-b border-border/70 bg-card text-card-foreground">
      <div className="container mx-auto px-4 pt-6 pb-6">
        {breadcrumb && breadcrumb.length > 0 && (
          <nav aria-label="Fil d’Ariane" className="mb-2">
            <ol className="flex flex-wrap items-center gap-x-1.5 text-sm text-muted-foreground">
              {breadcrumb.map((crumb, index) => (
                <li key={`${crumb.label}-${index}`} className="flex min-w-0 items-center gap-1.5">
                  {crumb.to ? (
                    <Link to={crumb.to} className="inline-flex min-h-11 items-center truncate font-medium transition hover:text-foreground lg:min-h-0">
                      {crumb.label}
                    </Link>
                  ) : (
                    <span className="truncate">{crumb.label}</span>
                  )}
                  <span aria-hidden>›</span>
                </li>
              ))}
            </ol>
          </nav>
        )}
        <div className="flex flex-col items-start gap-4 sm:flex-row sm:justify-between">
          <div className="min-w-0">
            <h1 className="text-2xl font-semibold tracking-tight break-words">{title}</h1>
            {description && <div className="mt-1 text-muted-foreground">{description}</div>}
          </div>
          {actions && <div className="flex max-w-full flex-wrap items-center gap-2">{actions}</div>}
        </div>
      </div>
      {tabs && tabs.length > 0 && (
        <nav aria-label="Sections" className="container mx-auto flex gap-1 overflow-x-auto px-4">
          {tabs.map((tab) => {
            const active = pathname === tab.to;
            return (
              <Link
                key={tab.to}
                to={tab.to}
                aria-current={active ? 'page' : undefined}
                className={`inline-flex min-h-11 shrink-0 items-center border-b-2 px-3 text-sm font-semibold transition ${
                  active ? 'border-foreground text-foreground' : 'border-transparent text-muted-foreground hover:text-foreground'
                }`}
              >
                {tab.label}
              </Link>
            );
          })}
        </nav>
      )}
    </header>
  );
}
