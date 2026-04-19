import { Link } from 'react-router-dom';
import { supabase } from '../lib/supabase';

const features = [
  {
    to: '/tmc-planning',
    label: 'Gestion planning',
    description: 'Créer et gérer les tournois, planifier les matchs.',
  },
  {
    to: '/programmation-image',
    label: 'Affiche programmation',
    description: 'Générer une image de la programmation à afficher.',
  },
  {
    to: '/events',
    label: 'Événements',
    description: 'Créer et gérer les événements du club.',
  },
];

export default function AppHomePage() {
  const handleLogout = () => supabase.auth.signOut();

  return (
    <div className="min-h-screen">
      <header className="border-b border-border/70 bg-card/85 text-card-foreground shadow-sm backdrop-blur">
        <div className="container mx-auto flex items-start justify-between px-4 py-8">
          <div className="flex items-center gap-4">
            <img src="/logo.png" alt="CAC Tennis Club" className="h-16 w-16" />
            <div>
              <h1 className="text-3xl font-semibold tracking-tight">Administration du CAC Tennis</h1>
              <p className="mt-2 text-muted-foreground">Affiche, events, programmation…</p>
            </div>
          </div>
          <button
            onClick={handleLogout}
            className="mt-1 rounded-lg border border-border bg-card px-4 py-2 text-sm font-medium text-muted-foreground transition hover:bg-muted"
          >
            Se déconnecter
          </button>
        </div>
      </header>

      <main className="container mx-auto px-4 py-12">
        <div className="grid grid-cols-1 gap-6 md:grid-cols-2 lg:grid-cols-3">
          {features.map((f) => (
            <Link
              key={f.to}
              to={f.to}
              className="rounded-2xl border bg-card/90 p-8 shadow-sm transition hover:border-primary/30 hover:shadow-md"
            >
              <h2 className="text-xl font-semibold text-card-foreground">{f.label}</h2>
              <p className="mt-2 text-sm text-muted-foreground">{f.description}</p>
            </Link>
          ))}
        </div>
      </main>
    </div>
  );
}
