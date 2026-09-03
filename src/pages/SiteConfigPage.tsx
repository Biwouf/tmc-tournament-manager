// Multi-tenant — PR6b : écran « Configuration du site » (MULTI_TENANT.md §6.1).
//
// Permet à un admin de club de renseigner sa configuration sans SQL. Route `adminOnly` : un
// `manager` ne gère ni la config club ni les membres (spec §4), et la policy
// `club_settings_update_club_admin` le refuse EN BASE de toute façon — le masquage ici n'est
// que du confort.
//
// Sept groupes : les trois du contrat de PR6a (`brand`, `home`, `contact`) puis le chrome du
// site vitrine livré en PR6c (`social`, `partners`, `legal`, `settings`). Les trois pages de
// contenu (`club`, `infra`, `pricing`) arrivent en PR6d et s'inséreront AVANT le chrome.
import { useState } from 'react';
import { Link } from 'react-router-dom';
import { useClub } from '../contexts/ClubContext';
import { useClubConfig } from '../hooks/useClubConfig';
import { CLUB_CONFIG_GROUPS, groupValueFromConfig, type GroupValue } from '../lib/clubConfigWrite';
import SiteConfigPanel from '../components/siteConfig/SiteConfigPanel';

export default function SiteConfigPage() {
  const { clubId, club } = useClub();
  const { config, loading, reload } = useClubConfig();

  // La config est figée au PREMIER chargement, et une seule fois. `reload()` après un
  // enregistrement repasse `loading` à true : sans ce gel, les panneaux seraient démontés puis
  // remontés à chaque sauvegarde, effaçant le message « enregistré » et la saisie en cours des
  // autres panneaux. Chaque panneau est ensuite maître de son propre état.
  const [initialValues, setInitialValues] = useState<GroupValue[] | null>(null);
  if (!loading && !initialValues) {
    setInitialValues(CLUB_CONFIG_GROUPS.map((group) => groupValueFromConfig(group, config)));
  }

  return (
    <div className="min-h-screen">
      <header className="border-b border-border/70 bg-card/85 text-card-foreground shadow-sm backdrop-blur">
        <div className="container mx-auto flex items-start justify-between px-4 py-8">
          <div>
            <h1 className="text-3xl font-semibold tracking-tight">Configuration du site</h1>
            <p className="mt-2 max-w-3xl text-muted-foreground">
              Les informations publiques de{' '}
              <span className="font-medium text-foreground">{club?.name ?? 'ce club'}</span>.
              Elles alimenteront le <span className="font-medium text-foreground">site vitrine</span>{' '}
              du club — elles ne changent ni ce back-office, ni l’application des adhérents.
            </p>
          </div>
          <Link
            to="/"
            className="mt-1 rounded-lg border border-border bg-card px-4 py-2 text-sm font-medium text-muted-foreground transition hover:bg-muted"
          >
            ← Accueil
          </Link>
        </div>
      </header>

      <main className="container mx-auto flex flex-col gap-9 px-4 py-12">
        {!initialValues ? (
          <p className="text-sm text-muted-foreground">Chargement…</p>
        ) : (
          <>
            <p className="text-sm text-muted-foreground">
              Chaque panneau s’enregistre séparément. Les champs marqués{' '}
              <span className="text-primary">⬤</span> sont attendus par le site vitrine, mais
              vous pouvez enregistrer un panneau incomplet et le compléter plus tard.
            </p>

            {CLUB_CONFIG_GROUPS.map((group, index) => (
              <SiteConfigPanel
                key={group.key}
                group={group}
                initial={initialValues[index]}
                clubId={clubId}
                onSaved={reload}
              />
            ))}
          </>
        )}
      </main>
    </div>
  );
}
