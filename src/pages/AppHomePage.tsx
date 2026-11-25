import { useEffect, useId, useState } from 'react';
import { Link } from 'react-router-dom';
import type { User } from '@supabase/supabase-js';
import { supabase } from '../lib/supabase';
import { inboxTotal, useAdminInbox } from '../lib/adminInbox';
import { useClubRole, type ClubRole } from '../contexts/ClubRoleContext';
import { useClub } from '../contexts/ClubContext';
import { useClubConfig } from '../hooks/useClubConfig';
import ClubSetup from '../components/dashboard/ClubSetup';
import InboxCard from '../components/home/InboxCard';
import WeekAgenda from '../components/home/WeekAgenda';
import PageHeader from '../components/layout/PageHeader';
import SectionTitle from '../components/layout/SectionTitle';

// Même matrice de rôles que la barre latérale (`navItems.ts`) : confort d'affichage seulement.
const SHORTCUTS: { to: string; label: string; roles: readonly ClubRole[] }[] = [
  { to: '/actus/new', label: 'Rédiger une actu', roles: ['admin', 'manager'] },
  { to: '/events/new', label: 'Créer un événement', roles: ['admin', 'manager'] },
  { to: '/live-score/new', label: 'Lancer un live', roles: ['admin', 'manager', 'member'] },
  { to: '/admin/members#inviter', label: 'Inviter un adhérent', roles: ['admin'] },
];

function today(): string {
  const label = new Date().toLocaleDateString('fr-FR', { weekday: 'long', day: 'numeric', month: 'long' });
  return label[0].toUpperCase() + label.slice(1);
}

// PR-BO2 — accueil « À traiter » (brief back office §3.1). Les cartes de modules ont disparu : la
// barre latérale suffit à naviguer. « À traiter » est réservé à l'admin (`admin_inbox`), l'agenda à
// l'admin et au gestionnaire ; un membre n'a que ses raccourcis.
export default function AppHomePage({ user }: { user: User }) {
  const { role, isSuperAdmin } = useClubRole();
  const { clubId } = useClub();
  const { config, loading: configLoading, reload } = useClubConfig();
  const { inbox } = useAdminInbox();
  const shortcutsId = useId();
  const [prenom, setPrenom] = useState('');

  useEffect(() => {
    let cancelled = false;
    supabase.from('profiles').select('prenom').eq('id', user.id).maybeSingle().then(({ data }) => {
      if (!cancelled) setPrenom((data?.prenom ?? '').trim());
    });
    return () => { cancelled = true; };
  }, [user.id]);

  // Super-admin non membre : accès support avec le rôle effectif 'admin'.
  const effectiveRole = isSuperAdmin ? 'admin' : role;
  const isAdmin = effectiveRole === 'admin';
  const total = inbox ? inboxTotal(inbox) : 0;
  const shortcuts = SHORTCUTS.filter((item) => effectiveRole !== null && item.roles.includes(effectiveRole));

  return (
    <div className="min-h-screen">
      <PageHeader
        title={prenom ? `Bonjour ${prenom}` : 'Bonjour'}
        description={total > 0
          ? `${today()} · ${total > 1 ? `${total} éléments demandent` : '1 élément demande'} votre attention`
          : today()}
      />

      <main className="container mx-auto px-4 py-8">
        <div className="flex flex-col gap-8">
          {/* SaaS S8 — bandeau d'essai et checklist d'un club self-serve ; rien pour le CAC. */}
          <ClubSetup config={config} loading={configLoading} reloadConfig={reload} />

          <div className="grid grid-cols-1 items-start gap-8 xl:grid-cols-[minmax(0,1fr)_360px]">
            {isAdmin && <InboxCard />}
            <div className="flex min-w-0 flex-col gap-8">
              {clubId && (isAdmin || effectiveRole === 'manager') && <WeekAgenda clubId={clubId} withCourses={isAdmin} />}
              {shortcuts.length > 0 && (
                <section aria-labelledby={shortcutsId}>
                  <SectionTitle id={shortcutsId} title="Raccourcis" />
                  <ul className="grid grid-cols-1 gap-2 sm:grid-cols-2 xl:grid-cols-1">
                    {shortcuts.map((item) => (
                      <li key={item.to}>
                        <Link
                          to={item.to}
                          className="flex min-h-11 items-center rounded-lg border border-border bg-card px-4 text-sm font-semibold text-foreground transition hover:bg-muted"
                        >
                          {item.label}
                        </Link>
                      </li>
                    ))}
                  </ul>
                </section>
              )}
            </div>
          </div>
        </div>
      </main>
    </div>
  );
}
