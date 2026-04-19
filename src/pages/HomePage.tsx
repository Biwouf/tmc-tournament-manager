import { useState, useEffect } from 'react';
import { Link } from 'react-router-dom';
import type { User } from '@supabase/supabase-js';
import { supabase } from '../lib/supabase';
import type { TournamentEntry } from '../types';

interface Props {
  user: User;
}

export default function HomePage({ user: _user }: Props) {
  const [tournaments, setTournaments] = useState<TournamentEntry[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    supabase
      .from('tournaments')
      .select('id, config, schedule')
      .order('created_at', { ascending: false })
      .then(({ data, error }) => {
        if (!error && data) {
          setTournaments(
            data.map((row) => ({
              id: row.id,
              config: row.config,
              schedule: row.schedule,
            }))
          );
        }
        setLoading(false);
      });
  }, []);

  const handleLogout = () => supabase.auth.signOut();

  return (
    <div className="min-h-screen">
      <header className="border-b border-border/70 bg-card/85 text-card-foreground shadow-sm backdrop-blur">
        <div className="container mx-auto flex items-start justify-between px-4 py-8">
          <div>
            <Link
              to="/"
              className="mb-2 inline-flex items-center gap-1 text-sm text-muted-foreground transition hover:text-foreground"
            >
              ← Accueil
            </Link>
            <h1 className="text-3xl font-semibold tracking-tight">Gestionnaire de Tournois TMC</h1>
            <p className="mt-2 text-muted-foreground">Organisation de tournois de tennis multi-chances</p>
          </div>
          <button
            onClick={handleLogout}
            className="mt-1 rounded-lg border border-border bg-card px-4 py-2 text-sm font-medium text-muted-foreground transition hover:bg-muted"
          >
            Se déconnecter
          </button>
        </div>
      </header>

      <main className="container mx-auto px-4 py-8">
        <div className="mb-6 flex items-center justify-between">
          <h2 className="text-xl font-semibold text-foreground">Tournois</h2>
          <Link
            to="/tmc-planning/new"
            className="rounded-lg bg-primary px-5 py-2.5 text-sm font-medium text-primary-foreground shadow-sm transition hover:brightness-95"
          >
            Nouveau tournoi
          </Link>
        </div>

        {loading ? (
          <div className="text-center text-muted-foreground py-12">Chargement...</div>
        ) : tournaments.length === 0 ? (
          <div className="rounded-2xl border border-dashed border-border bg-card/50 p-12 text-center text-muted-foreground">
            Aucun tournoi créé. Commencez par créer un nouveau tournoi.
          </div>
        ) : (
          <div className="grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-3">
            {tournaments.map((entry) => (
              <Link
                key={entry.id}
                to={`/tmc-planning/${entry.id}`}
                className="rounded-2xl border bg-card/90 p-6 shadow-sm transition hover:border-primary/30 hover:shadow-md"
              >
                <h3 className="text-lg font-semibold text-card-foreground">{entry.config.name}</h3>
                <p className="mt-1 text-sm text-muted-foreground">
                  {entry.config.startDate} → {entry.config.endDate}
                </p>
                <p className="mt-2 text-sm text-foreground">
                  {entry.config.tournaments.length} tableau{entry.config.tournaments.length > 1 ? 'x' : ''}
                </p>
                <div className="mt-3 flex flex-wrap gap-1">
                  {entry.config.tournaments.map((t) => (
                    <span
                      key={t.id}
                      className="rounded-full bg-muted px-2 py-0.5 text-xs text-muted-foreground"
                    >
                      {t.gender === 'homme' ? 'H' : 'F'} {t.numberOfPlayers}j
                    </span>
                  ))}
                </div>
              </Link>
            ))}
          </div>
        )}
      </main>

      <footer className="mt-12 border-t border-border/70 py-6 text-muted-foreground">
        <div className="container mx-auto px-4 text-center">
          <p>Gestionnaire de Tournois TMC</p>
        </div>
      </footer>
    </div>
  );
}
