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
import { useEffect, useState } from 'react';
import { useLocation } from 'react-router-dom';
import { useClub } from '../contexts/ClubContext';
import { useClubConfig } from '../hooks/useClubConfig';
import { useClubTheme } from '../hooks/useClubTheme';
import { CLUB_CONFIG_GROUPS, groupValueFromConfig, type GroupValue } from '../lib/clubConfigWrite';
import SiteConfigPanel from '../components/siteConfig/SiteConfigPanel';
import SitePublication from '../components/siteConfig/SitePublication';
import TenupSiteImport from '../components/siteConfig/TenupSiteImport';
import PageHeader from '../components/layout/PageHeader';

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
  // SaaS S8b : après « Remplir depuis Ten'Up », les panneaux sont remontés sur la config relue
  // (`reload()` repasse `loading` à true dans le même rendu : le gel ci-dessous attend la relecture).
  const [generation, setGeneration] = useState(0);
  const afterTenupImport = () => {
    reload();
    setInitialValues(null);
    setGeneration((g) => g + 1);
  };
  if (!loading && !initialValues) {
    setInitialValues(CLUB_CONFIG_GROUPS.map((group) => groupValueFromConfig(group, config)));
  }

  // SaaS S8 : `#panneau-<groupe>` (« Ajouter votre propre fond d'affiche ») déplie ce panneau.
  const { hash } = useLocation();
  const ready = initialValues !== null;
  useEffect(() => {
    if (ready && hash) document.getElementById(hash.slice(1))?.scrollIntoView({ block: 'start' });
  }, [ready, hash]);

  return (
    <div className="min-h-screen">
      <PageHeader
        title="Site et identité"
        description={<p className="max-w-3xl">
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
        </p>}
      />

      <main className="container mx-auto flex flex-col gap-9 px-4 py-12">
        {/* SaaS S8b — préremplissage depuis Ten'Up, en tête (rien pour un club `internal`). Hors du
            gel des panneaux : il reste monté pendant leur remontage et garde son message final. */}
        {clubId && club?.plan !== 'internal' && (initialValues || generation > 0) && (
          <TenupSiteImport clubId={clubId} config={config} onSaved={afterTenupImport} />
        )}
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

            {/* SaaS S8 — publication du site d'un club self-serve (le CAC n'est pas concerné). */}
            {club?.created_via === 'self_serve' && <SitePublication club={club} config={config} />}

            {CLUB_CONFIG_GROUPS.map((group, index) => (
              <SiteConfigPanel
                key={`${generation}-${group.key}`}
                group={group}
                initial={initialValues[index]}
                clubId={clubId}
                defaultOpen={index === 0 || hash === `#panneau-${group.key}`}
                focused={hash === `#panneau-${group.key}`}
                onSaved={reload}
              />
            ))}
          </>
        )}
      </main>
    </div>
  );
}
