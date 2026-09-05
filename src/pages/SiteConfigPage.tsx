// Multi-tenant — PR6b : écran « Configuration du site » (MULTI_TENANT.md §6.1).
//
// Permet à un admin de club de renseigner sa configuration sans SQL. Route `adminOnly` : un
// `manager` ne gère ni la config club ni les membres (spec §4), et la policy
// `club_settings_update_club_admin` le refuse EN BASE de toute façon — le masquage ici n'est
// que du confort.
//
// DIX groupes, dans l'ordre du `web_site_brief.md` §5 : l'identité et les pages du site
// (`brand`, `home`, puis `club`, `infra`, `pricing` — PR6d —, puis `contact`), et enfin son
// chrome (`social`, `partners`, `legal`, `settings` — PR6c). La configuration de la VITRINE
// est CLOSE.
//
// PR7 ajoute un onzième panneau, « Affiches », en DERNIER et à part : c'est le seul qui ne
// concerne pas le site vitrine — ces deux images sortent dans ce back-office. D'où le chapeau
// ci-dessous, qui distingue désormais les deux natures au lieu de promettre que rien de cet
// écran ne change le BO.
//
// Onze panneaux dépliés feraient une page trop haute : ils sont REPLIÉS par défaut, sauf le
// premier, et chacun affiche son état (« Configuré » / « À compléter ») — ce qui donne en prime
// une vue d'avancement au club qui remplit sa config. Le repli n'est qu'un masquage : chaque
// panneau reste monté et garde sa saisie en cours, qu'il signale plutôt que de la cacher.
import { useState } from 'react';
import { Link } from 'react-router-dom';
import { useClub } from '../contexts/ClubContext';
import { useClubConfig } from '../hooks/useClubConfig';
import { useClubTheme } from '../hooks/useClubTheme';
import { CLUB_CONFIG_GROUPS, groupValueFromConfig, type GroupValue } from '../lib/clubConfigWrite';
import SiteConfigPanel from '../components/siteConfig/SiteConfigPanel';

export default function SiteConfigPage() {
  const { clubId, club } = useClub();
  const { config, loading, reload } = useClubConfig();

  // Les couleurs sont déjà appliquées par `App.tsx` ; les réappliquer ICI depuis la config
  // rechargée après un enregistrement évite d'avoir à recharger la page pour les voir.
  useClubTheme(config);

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
              Les réglages de{' '}
              <span className="font-medium text-foreground">{club?.name ?? 'ce club'}</span>. La
              quasi-totalité des panneaux décrit les informations publiques du club : elles
              alimenteront le{' '}
              <span className="font-medium text-foreground">site vitrine</span> et ne changent ni
              ce back-office, ni l’application des adhérents. Deux exceptions : les{' '}
              <span className="font-medium text-foreground">couleurs</span> d’
              <span className="font-medium text-foreground">Identité du club</span>, qui
              repeignent les deux, et le panneau{' '}
              <span className="font-medium text-foreground">Affiches</span>, qui porte des
              réglages d’affichage internes, utilisés par les affiches générées ici même.
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
              Cliquez sur le titre d’un panneau pour le déplier. Chaque panneau s’enregistre
              séparément. Les champs marqués <span className="text-primary">⬤</span> sont
              attendus par le site vitrine, mais vous pouvez enregistrer un panneau incomplet et
              le compléter plus tard.
            </p>

            {CLUB_CONFIG_GROUPS.map((group, index) => (
              <SiteConfigPanel
                key={group.key}
                group={group}
                initial={initialValues[index]}
                clubId={clubId}
                defaultOpen={index === 0}
                onSaved={reload}
              />
            ))}
          </>
        )}
      </main>
    </div>
  );
}
