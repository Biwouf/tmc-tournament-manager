import { useId } from 'react';
import { Link } from 'react-router-dom';
import { useClubRole } from '../contexts/ClubRoleContext';
import { useClub } from '../contexts/ClubContext';
import { useClubConfig } from '../hooks/useClubConfig';
import ClubSetup from '../components/dashboard/ClubSetup';
import PageHeader from '../components/layout/PageHeader';
import SectionTitle from '../components/layout/SectionTitle';

// `roles` = rôles autorisés à voir la carte (matrice MULTI_TENANT.md §4 / brief PR4 §6).
// Le masquage est purement UI : la RLS tenant_isolation cloisonne par club, pas par rôle.
const SECTIONS = [
  {
    id: 'club',
    label: 'Actus du club',
    hint: 'Contenu publié pour les adhérents',
    items: [
      { to: '/actus', label: 'Actus', description: 'Rédiger et publier les actualités du club.', roles: ['admin', 'manager'] },
      { to: '/events', label: 'Événements', description: 'Créer et gérer les événements du club.', roles: ['admin', 'manager'] },
      { to: '/live-score', label: 'Live score', description: 'Suivre et saisir le score des matchs en direct.', roles: ['admin', 'manager', 'member'] },
      { to: '/team-matches', label: 'Rencontres', description: 'Gérer les rencontres interclubs des équipes.', roles: ['admin', 'manager'] },
      { to: '/team-matches/admin', label: 'Saisons et équipes', description: 'Référentiel interclubs : saisons, compétitions, équipes.', roles: ['admin', 'manager'] },
    ],
  },
  {
    id: 'tools',
    label: 'Outils',
    hint: 'Générateurs et planning sportif',
    items: [
      { to: '/medias', label: 'Visuels', description: 'Images des tournois (programme, résultats) et des rencontres.', roles: ['admin', 'manager'] },
      { to: '/tmc-planning', label: 'Tournois TMC', description: 'Créer et gérer les tournois, planifier les matchs.', roles: ['admin', 'manager'] },
    ],
  },
  {
    id: 'admin',
    label: 'Admin',
    hint: 'Réservé aux administrateurs',
    items: [
      { to: '/courses', label: 'Cours', description: 'Programmer les cours et valider les inscriptions.', roles: ['admin'] },
      { to: '/admin/members', label: 'Adhérents', description: 'Inviter, changer les rôles, retirer des accès.', roles: ['admin'] },
      { to: '/admin/site', label: 'Site et identité', description: 'Identité, page d’accueil et coordonnées du site vitrine.', roles: ['admin'] },
      { to: '/admin/social', label: 'Réseaux sociaux', description: 'Connecter la page Facebook sur laquelle les actus sont publiées.', roles: ['admin'] },
      { to: '/admin/messages', label: 'Messages', description: 'Les messages reçus depuis le formulaire de contact du site.', roles: ['admin'] },
    ],
  },
] as const;

export default function AppHomePage() {
  const { role, isSuperAdmin } = useClubRole();
  const titleId = useId();
  const { club } = useClub();
  const { config, loading: configLoading, reload } = useClubConfig();
  const clubName = club?.name ?? 'Club';

  // Super-admin non membre : accès support avec le rôle effectif 'admin'.
  const effectiveRole = isSuperAdmin ? 'admin' : role;
  const sections = SECTIONS.map((section) => ({
    ...section,
    items: section.items.filter(
      (item) => effectiveRole !== null && (item.roles as readonly string[]).includes(effectiveRole),
    ),
  })).filter((section) => section.items.length > 0);

  return (
    <div className="min-h-screen">
      <PageHeader title="Accueil" description={`Administration de ${clubName}`} />

      <main className="container mx-auto px-4 py-12">
        <div className="flex flex-col gap-10">
          {/* SaaS S8 — bandeau d'essai et checklist d'un club self-serve ; rien pour le CAC. */}
          <ClubSetup config={config} loading={configLoading} reloadConfig={reload} />
          {/* PR5 — surface PLATEFORME, pas module club : volontairement hors de la
              matrice de rôles ci-dessus (le super-admin n'est pas un rôle de club). */}
          {isSuperAdmin && (
            <section aria-labelledby={`${titleId}-platform`}>
              <SectionTitle
                id={`${titleId}-platform`}
                title="Plateforme"
                action={<span className="hidden text-xs text-muted-foreground md:inline">Réservé au super-admin</span>}
              />
              <div className="grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-3">
                <Link
                  to="/super-admin"
                  className="rounded-2xl border bg-card/90 p-8 shadow-sm transition hover:border-primary/30 hover:shadow-md"
                >
                  <h3 className="text-base font-semibold text-card-foreground">Console plateforme</h3>
                  <p className="mt-2 text-sm text-muted-foreground">
                    Créer, lister et suspendre les clubs ; inviter leur premier administrateur.
                  </p>
                </Link>
              </div>
            </section>
          )}

          {sections.map((section) => (
            <section key={section.id} aria-labelledby={`${titleId}-${section.id}`}>
              <SectionTitle
                id={`${titleId}-${section.id}`}
                title={section.label}
                action={<span className="hidden text-xs text-muted-foreground md:inline">{section.hint}</span>}
              />
              <div className="grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-3">
                {section.items.map((item) => (
                  <Link
                    key={item.to}
                    to={item.to}
                    className="rounded-2xl border bg-card/90 p-8 shadow-sm transition hover:border-primary/30 hover:shadow-md"
                  >
                    <h3 className="text-base font-semibold text-card-foreground">{item.label}</h3>
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
