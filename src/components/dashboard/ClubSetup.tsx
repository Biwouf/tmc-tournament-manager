import { lazy, Suspense, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { supabase } from '../../lib/supabase';
import { useClub, type Club } from '../../contexts/ClubContext';
import { useClubRole } from '../../contexts/ClubRoleContext';
import { useSitePublication } from '../../hooks/useSitePublication';
import type { ClubConfig } from '../../lib/clubConfig';
import { listClubMembers } from '../../lib/clubMembers';
import { clubAppHost, markAppShared } from '../../lib/firstSteps';
import {
  checklistComplete, checklistItems, checklistProgress, eligibleForChecklist, firstStepPath,
  passwordState, trialBanner, type ChecklistItem,
} from '../../lib/dashboardChecklist';
import Modal from './Modal';
import PasswordDialog from './PasswordDialog';

const AppShareDialog = lazy(() => import('./AppShareDialog'));

// SaaS S8 — en tête du tableau de bord d'un club self-serve : bandeau d'essai et checklist
// « Pour finir d'installer le club » (`docs/specs/SAAS_ONBOARDING.md` §12). Rien, et aucune
// lecture de plus, pour un club `internal` (le CAC), un membre ou le support.
export default function ClubSetup({ config, loading, reloadConfig }: { config: ClubConfig; loading: boolean; reloadConfig: () => void }) {
  const { club, isSupport } = useClub();
  const { role } = useClubRole();
  // Attendre la première lecture de la config (sinon : défauts, donc un site « incomplet ») ; une
  // relecture après écriture ne démonte rien (la fenêtre de partage reste ouverte).
  const [loaded, setLoaded] = useState(false);
  if (!loaded && !loading) setLoaded(true);
  if (!club || !loaded || !eligibleForChecklist(club, role, isSupport)) return null;
  return <Eligible club={club} config={config} reloadConfig={reloadConfig} />;
}

function TrialBannerView({ club }: { club: Club }) {
  const banner = trialBanner(club);
  if (!banner) return null;
  return (
    <p className={`flex items-center gap-2.5 rounded-xl border px-4 py-3 text-sm font-semibold ${banner.urgent
      ? 'border-amber-400 bg-amber-50 text-amber-900'
      : 'border-border bg-card/90 text-card-foreground'}`}>
      <span aria-hidden className={`h-2 w-2 shrink-0 rounded-full ${banner.urgent ? 'bg-amber-500' : 'bg-primary'}`} />
      {banner.label}
    </p>
  );
}

const collapseKey = (clubId: string) => `feelike_checklist_collapsed:${clubId}`;
const readCollapsed = (clubId: string) => { try { return localStorage.getItem(collapseKey(clubId)) === '1'; } catch { return false; } };

function Eligible({ club, config, reloadConfig }: { club: Club; config: ClubConfig; reloadConfig: () => void }) {
  const { published, setSitePublished } = useSitePublication(club);
  const [team, setTeam] = useState<boolean | null>(null);
  const [passwordSet, setPasswordSet] = useState<boolean | null>(null);
  const [dialog, setDialog] = useState<'publish' | 'password' | 'share' | null>(null);
  const [collapsed, setCollapsed] = useState(() => readCollapsed(club.id));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    void supabase.auth.getUser().then(async ({ data }) => {
      const user = data.user;
      if (cancelled) return;
      setPasswordSet(passwordState(user));
      const result = await listClubMembers(club.id);
      // Le bureau : un autre admin, ou une invitation pas encore acceptée (les adhérents inscrits
      // depuis l'app sont des membres actifs : ils ne comptent pas).
      if (!cancelled && result.success) {
        setTeam(result.members.some((m) => m.user_id !== user?.id && (m.role === 'admin' || m.status === 'pending')));
      }
    });
    return () => { cancelled = true; };
  }, [club.id]);

  const items = checklistItems({ config, sitePublished: published, team, passwordSet });
  const progress = checklistProgress(items);
  const complete = checklistComplete(items);
  const current = items.find((item) => !item.done && !item.optional)?.id;
  const siteReady = items.find((item) => item.id === 'site')?.done ?? false;

  const toggle = () => {
    const next = !collapsed;
    setCollapsed(next);
    try { localStorage.setItem(collapseKey(club.id), next ? '1' : '0'); } catch { /* préférence locale, facultative */ }
  };
  const publish = async () => {
    setBusy(true);
    const problem = await setSitePublished(true);
    setBusy(false);
    setError(problem);
    if (!problem) setDialog(null);
  };
  const share = () => {
    setDialog('share');
    // Le QR code s'affiche : l'élément est fait. Échec d'écriture : il le sera au prochain partage.
    if (!config.onboarding.app_shared_at) void markAppShared(club.id).then((result) => { if (!result.error) reloadConfig(); });
  };

  const primary = 'inline-flex min-h-11 items-center justify-center whitespace-nowrap rounded-lg bg-primary px-4 text-sm font-semibold text-primary-foreground shadow-sm transition hover:brightness-95 disabled:cursor-not-allowed disabled:opacity-50';
  const secondary = 'inline-flex min-h-11 items-center justify-center whitespace-nowrap rounded-lg border border-border bg-card px-4 text-sm font-medium text-card-foreground transition hover:bg-muted disabled:cursor-not-allowed disabled:opacity-50';

  const action = (item: ChecklistItem) => {
    if (item.done) return null;
    const style = item.id === current ? primary : secondary;
    if (item.id === 'site') return <Link to="/admin/site" className={style}>Compléter</Link>;
    if (item.id === 'publish') {
      return <button type="button" className={style} disabled={!siteReady} aria-describedby={siteReady ? undefined : 'checklist-publish-hint'} onClick={() => { setError(null); setDialog('publish'); }}>Publier le site</button>;
    }
    if (item.id === 'team') return <Link to="/admin/members" className={style}>Inviter</Link>;
    if (item.id === 'share') return <button type="button" className={style} onClick={share}>Partager</button>;
    if (item.id === 'password') return <button type="button" className={secondary} onClick={() => setDialog('password')}>Choisir</button>;
    return <Link to={firstStepPath(item.id.slice('step:'.length))} className={style}>Reprendre</Link>;
  };

  if (complete && !trialBanner(club) && !dialog) return null;
  return (
    <div className="flex flex-col gap-4">
      <TrialBannerView club={club} />
      {!complete && (
        <section aria-labelledby="checklist-title" className="rounded-2xl border bg-card/90 p-5 shadow-sm sm:p-6">
          <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
            <h2 id="checklist-title" className="m-0 flex-1 text-lg font-semibold text-card-foreground">Pour finir d’installer le club</h2>
            <span aria-live="polite" className="text-sm font-semibold tabular-nums text-primary">
              {progress.done} / {progress.total}<span className="sr-only"> éléments faits</span>
            </span>
            <button type="button" onClick={toggle} aria-expanded={!collapsed} aria-controls="checklist-items" className="min-h-11 rounded-lg px-3 text-sm font-medium text-muted-foreground transition hover:bg-muted">
              {collapsed ? 'Afficher' : 'Replier'}
            </button>
          </div>
          <div aria-hidden className="mt-3 h-1.5 overflow-hidden rounded-full bg-muted">
            <div className="h-full rounded-full bg-primary transition-[width]" style={{ width: `${progress.total ? (progress.done / progress.total) * 100 : 100}%` }} />
          </div>
          <div id="checklist-items" hidden={collapsed}>
            <ol className="m-0 mt-2 list-none p-0">
              {items.map((item, index) => (
                <li key={item.id} className="grid grid-cols-[2rem_minmax(0,1fr)] items-center gap-x-3 gap-y-2 border-t py-4 first:border-t-0 sm:grid-cols-[2rem_minmax(0,1fr)_auto]">
                  {item.done
                    ? <span className="flex h-8 w-8 items-center justify-center rounded-full bg-primary text-sm font-semibold text-primary-foreground"><span aria-hidden>✓</span><span className="sr-only">Fait :</span></span>
                    : <span className={`flex h-8 w-8 items-center justify-center rounded-full border-2 text-xs font-semibold ${item.id === current ? 'border-primary text-primary' : 'border-border text-muted-foreground'}`}>
                        <span aria-hidden>{item.optional ? '·' : index + 1}</span><span className="sr-only">À faire :</span>
                      </span>}
                  <div className="min-w-0">
                    <p className={`m-0 font-semibold ${item.done ? 'text-muted-foreground line-through decoration-1' : 'text-card-foreground'}`}>
                      {item.title}{item.optional && <span className="ml-2 text-xs font-normal text-muted-foreground">facultatif</span>}
                    </p>
                    <p className="m-0 mt-0.5 text-sm text-muted-foreground">{item.detail}</p>
                    {item.id === 'publish' && !item.done && !siteReady && (
                      <p id="checklist-publish-hint" className="m-0 mt-0.5 text-sm text-muted-foreground">Complétez d’abord votre site.</p>
                    )}
                  </div>
                  {!item.done && <div className="col-start-2 sm:col-start-3">{action(item)}</div>}
                </li>
              ))}
            </ol>
            <p className="m-0 border-t pt-4 text-sm text-muted-foreground">
              <Link to="/admin/site#panneau-posters" className="font-medium text-primary underline-offset-2 hover:underline">Ajouter votre propre fond d’affiche</Link>
            </p>
          </div>
        </section>
      )}

      {dialog === 'publish' && (
        <Modal title="Publier le site ?" onClose={() => setDialog(null)}>
          <p className="mb-4 text-sm text-muted-foreground">
            Votre site devient visible des moteurs de recherche : Google pourra le proposer à ceux qui
            cherchent un club. Vous pourrez le dépublier à tout moment depuis « Configuration du site ».
          </p>
          {!config.settings.search_indexing && (
            <p className="mb-4 text-sm text-amber-800">
              Le référencement est désactivé dans « Configuration du site » : le site restera invisible tant
              que vous ne l’autorisez pas.
            </p>
          )}
          {error && <p role="alert" className="mb-4 text-sm text-destructive">{error}</p>}
          <div className="flex flex-wrap justify-end gap-2">
            <button type="button" className={secondary} onClick={() => setDialog(null)}>Annuler</button>
            <button type="button" className={primary} disabled={busy} onClick={publish}>{busy ? 'Publication…' : 'Publier'}</button>
          </div>
        </Modal>
      )}
      {dialog === 'password' && <PasswordDialog onClose={() => setDialog(null)} onDone={() => { setPasswordSet(true); setDialog(null); }} />}
      {dialog === 'share' && (
        <Suspense fallback={null}>
          <AppShareDialog host={clubAppHost(club.slug)} clubName={config.brand.name || club.name} onClose={() => setDialog(null)} />
        </Suspense>
      )}
    </div>
  );
}
