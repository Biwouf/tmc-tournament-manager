import { Link } from 'react-router-dom';
import type { ReactNode } from 'react';
import { supabase } from '../../lib/supabase';

interface Props {
  title: string;
  subtitle?: string;
  backTo: string;
  backLabel: string;
  actions?: ReactNode;
}

export default function TeamMatchesHeader({ title, subtitle, backTo, backLabel, actions }: Props) {
  const handleLogout = () => supabase.auth.signOut();

  return (
    <header className="border-b border-border/70 bg-card/85 text-card-foreground shadow-sm backdrop-blur">
      <div className="container mx-auto flex items-start justify-between px-4 py-8">
        <div>
          <Link
            to={backTo}
            className="mb-2 inline-flex items-center gap-1 text-sm text-muted-foreground transition hover:text-foreground"
          >
            ← {backLabel}
          </Link>
          <h1 className="text-3xl font-semibold tracking-tight">{title}</h1>
          {subtitle && <p className="mt-2 text-muted-foreground">{subtitle}</p>}
        </div>
        <div className="mt-1 flex items-center gap-3">
          {actions}
          <button
            onClick={handleLogout}
            className="rounded-lg border border-border bg-card px-4 py-2 text-sm font-medium text-muted-foreground transition hover:bg-muted"
          >
            Se déconnecter
          </button>
        </div>
      </div>
    </header>
  );
}
