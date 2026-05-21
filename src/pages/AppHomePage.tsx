import { Link } from 'react-router-dom';
import { supabase } from '../lib/supabase';

const SECTIONS = [
  {
    id: 'club',
    label: 'Actus du club',
    hint: 'Contenu publié pour les adhérents',
    items: [
      { to: '/actus', label: 'Actus', description: 'Rédiger et publier les actualités du club.' },
      { to: '/events', label: 'Événements', description: 'Créer et gérer les événements du club.' },
      { to: '/live-score', label: 'Live Score', description: 'Suivre et saisir le score des matchs en direct.' },
    ],
  },
  {
    id: 'tools',
    label: 'Outils',
    hint: 'Générateurs et planning sportif',
    items: [
      { to: '/programmation-image', label: 'Affiche programmation', description: 'Générer une image de la programmation à afficher.' },
      { to: '/tmc-planning', label: 'Gestion planning', description: 'Créer et gérer les tournois, planifier les matchs.' },
    ],
  },
  {
    id: 'admin',
    label: 'Admin',
    hint: 'Réservé aux administrateurs',
    items: [
      { to: '/admin/invite', label: 'Inviter un utilisateur', description: 'Envoyer un lien d’invitation au back-office.' },
    ],
  },
] as const;

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
        <div className="flex flex-col gap-9">
          {SECTIONS.map((section) => (
            <section key={section.id}>
              <div className="flex items-baseline gap-3.5 mb-3.5">
                <h2 className="text-xs font-semibold uppercase tracking-[0.08em] text-primary m-0">
                  {section.label}
                </h2>
                <span
                  className="flex-1 h-px"
                  style={{ background: 'linear-gradient(to right, hsl(var(--border)), transparent)' }}
                />
                <span className="hidden md:inline text-xs text-muted-foreground">{section.hint}</span>
              </div>
              <div className="grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-3">
                {section.items.map((item) => (
                  <Link
                    key={item.to}
                    to={item.to}
                    className="rounded-2xl border bg-card/90 p-8 shadow-sm transition hover:border-primary/30 hover:shadow-md"
                  >
                    <h3 className="text-xl font-semibold text-card-foreground">{item.label}</h3>
                    <p className="mt-2 text-sm text-muted-foreground">{item.description}</p>
                  </Link>
                ))}
              </div>
            </section>
          ))}
        </div>
      </main>
    </div>
  );
}
