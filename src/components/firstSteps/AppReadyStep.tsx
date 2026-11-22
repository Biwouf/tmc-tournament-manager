import { lazy, Suspense, useEffect, useState, type CSSProperties } from 'react';
import { Link } from 'react-router-dom';
import { clubAppHost, markAppShared } from '../../lib/firstSteps';
import type { MatchCard } from '../signup/SignupPreview';
import type { StepProps } from './FirstStepsFlow';
import { loadMatchesScreen } from './matchesScreen';
import { useTeamsVersion } from './teamsSignal';
import ClubImport from './ClubImport';
import PoolImport from './PoolImport';

const AppShareDialog = lazy(() => import('../dashboard/AppShareDialog'));

// Onboarding « Ten'Up d'abord », P2 (brief SAAS_11 §3.5, maquette 04) — « Votre app est prête » :
// première étape des premiers pas d'un club dont l'identifiant Ten'Up est connu. Les équipes se
// lisent seules (`ClubImport` variante `ready`), s'importent en un tap, et leurs rencontres
// apparaissent au fur et à mesure dans un aperçu compact, visible sans clic sur mobile (sur
// ordinateur, le téléphone de droite suffit). Puis « Quand vous voulez », le partage, le tableau de bord.
// Sans identifiant (branche manuelle), `EquipesStep` garde l'étape d'avant.

type Props = StepProps & {
  tenupClubId: string;
  /** Équipes déjà créées (null : en lecture). */
  teamCount: number | null;
  onImported: () => void;
};

export default function AppReadyStep({ club, config, state, complete, goTo, finish, tenupClubId, teamCount, onImported }: Props) {
  const [busy, setBusy] = useState(false);
  const [leaving, setLeaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [share, setShare] = useState(false);
  const [skipped, setSkipped] = useState(false);
  const host = clubAppHost(club.slug);
  const name = config.brand.name || club.name;
  const hasTeams = Boolean(teamCount);

  /** Les équipes sont là : l'étape est faite avant d'aller ailleurs (sinon la checklist la redemanderait). */
  const settle = async () => {
    if (!hasTeams || state.completed_steps.includes('equipes')) return null;
    return complete();
  };
  const leave = async (go: () => unknown) => {
    setLeaving(true); setError(null);
    const failure = await settle();
    setLeaving(false);
    if (failure) { setError(`Vos équipes sont créées, mais l’avancement n’a pas pu être enregistré. ${failure}`); return; }
    await go();
  };
  const openShare = () => {
    setShare(true);
    // Comme la checklist : le QR code s'affiche, le partage est fait. L'avancement se relit puis se
    // réécrit : les deux écritures passent l'une après l'autre, sinon la seconde effacerait la première.
    void (async () => {
      await settle();
      if (!state.app_shared_at) await markAppShared(club.id);
    })();
  };
  const toDashboard = () => leave(async () => { const failure = await finish(); if (failure) setError(failure); });

  return <>
    <h2 className="fs-h" tabIndex={-1}>Votre app est prête</h2>
    <p className="fs-lede">Voici ce que verront vos adhérents, avec vos vraies rencontres.</p>

    <AppGlance clubId={club.id} name={name} host={host} logo={config.brand.logo || null} />

    {teamCount !== null && !skipped && (
      <ClubImport club={club} tenupClubId={tenupClubId} autoRead={!hasTeams} variant="ready"
        onImported={onImported} onBusy={setBusy} onSkip={() => setSkipped(true)} />
    )}
    {hasTeams && <p className="fs-note">{teamCount! > 1 ? `${teamCount} équipes dans votre app.` : 'Une équipe dans votre app.'}</p>}

    <details className="fs-more">
      <summary>Une équipe manque ? Ajoutez-la avec le lien de sa poule</summary>
      <div className="fs-group"><PoolImport club={club} config={config} onAdded={onImported} onBusy={setBusy} /></div>
    </details>

    <section className="fs-anytime" aria-labelledby="fs-anytime-title">
      <h3 id="fs-anytime-title">Quand vous voulez</h3>
      <ul>
        <li>
          <button type="button" className="fs-anytime-row" disabled={busy || leaving} onClick={() => void leave(() => goTo('affiches'))}>
            <Mark done={state.completed_steps.includes('affiches')} /><span>Affiche du week-end</span><span className="fs-anytime-time">1 min</span>
          </button>
        </li>
        <li>
          <Link className="fs-anytime-row" to="/admin/site" onClick={() => void settle()}>
            <Mark done={false} /><span>Relire et publier le site</span><span className="fs-anytime-time">prérempli</span>
          </Link>
        </li>
        <li>
          <Link className="fs-anytime-row" to="/admin/members" onClick={() => void settle()}>
            <Mark done={false} /><span>Inviter le bureau</span><span className="fs-anytime-time">30 s</span>
          </Link>
        </li>
      </ul>
    </section>

    {error && <p role="alert" className="fs-error">{error}</p>}

    <div className="fs-footer fs-ready-footer">
      <button type="button" className="fs-btn fs-btn-p" disabled={leaving} onClick={openShare}>Partager l’app aux adhérents</button>
      <button type="button" className="fs-link" disabled={busy || leaving} onClick={() => void toDashboard()}>Aller au tableau de bord</button>
    </div>

    {share && (
      <Suspense fallback={null}>
        <AppShareDialog host={host} clubName={name} onClose={() => setShare(false)} />
      </Suspense>
    )}
  </>;
}

const Mark = ({ done }: { done: boolean }) => (
  <span aria-hidden="true" className={`fs-anytime-mark${done ? ' ok' : ''}`}>{done ? '✓' : ''}</span>
);

const day = (date: Date) => {
  const label = date.toLocaleDateString('fr-FR', { weekday: 'long', day: 'numeric', month: 'long' });
  return label.charAt(0).toUpperCase() + label.slice(1);
};
const hour = (date: Date) => `${date.getHours()}h${date.getMinutes() ? String(date.getMinutes()).padStart(2, '0') : ''}`;
/** « Championnat … · Messieurs Seniors » → « Messieurs Seniors » (la catégorie, sans le nom long). */
const category = (comp: string) => comp.split(' · ').at(-1) ?? comp;

/**
 * L'aperçu compact (maquette 04) : en-tête aux couleurs du club, puis 3 rencontres à venir au plus,
 * relues à chaque équipe créée (`teamsSignal`). Masqué sur ordinateur, où le téléphone est à droite.
 */
function AppGlance({ clubId, name, host, logo }: { clubId: string; name: string; host: string; logo: string | null }) {
  const teams = useTeamsVersion();
  const [matches, setMatches] = useState<MatchCard[] | null>(null);
  const [logoOk, setLogoOk] = useState(true);
  useEffect(() => {
    let active = true;
    loadMatchesScreen(clubId).then(
      (screen) => { if (active) setMatches(screen?.upcoming.slice(0, 3) ?? []); },
      () => { if (active) setMatches((current) => current ?? []); },
    );
    return () => { active = false; };
  }, [clubId, teams]);

  const days: { label: string; items: MatchCard[] }[] = [];
  for (const match of matches ?? []) {
    const label = day(match.date);
    const last = days.at(-1);
    if (last?.label === label) last.items.push(match); else days.push({ label, items: [match] });
  }
  const initials = name.split(/\s+/).filter(Boolean).slice(0, 3).map((w) => w[0]).join('').toUpperCase();

  return (
    <section className="fs-glance" aria-label="Aperçu de votre app">
      <div className="fs-glance-head">
        <span className="fs-glance-logo" aria-hidden="true">
          {logo && logoOk ? <img src={logo} alt="" onError={() => setLogoOk(false)} /> : <b>{initials}</b>}
        </span>
        <span className="fs-glance-names">
          <span className="fs-glance-name">{name}</span>
          <span className="fs-glance-host">{host}</span>
        </span>
      </div>
      {matches === null || matches.length === 0
        ? <p className="fs-glance-empty" aria-live="polite">{matches === null ? 'Chargement…' : 'Vos rencontres arrivent ici.'}</p>
        : days.map((group) => (
          <div key={group.label} className="fs-glance-day">
            <p className="fs-glance-date">{group.label}</p>
            <ul>
              {group.items.map((match) => (
                <li key={match.key}>
                  <span className={`fs-glance-icon${match.home ? '' : ' away'}`} aria-hidden="true">{match.home ? <HomeIcon /> : <AwayIcon />}</span>
                  <span className="fs-glance-body">
                    <span className="fs-glance-vs">{match.vs}<span className="fs-sr"> · {match.home ? 'à domicile' : 'à l’extérieur'}</span></span>
                    <span className="fs-glance-detail">{category(match.comp)} · Équipe {match.equipe} · {hour(match.date)}</span>
                  </span>
                </li>
              ))}
            </ul>
          </div>
        ))}
    </section>
  );
}

const icon: CSSProperties = { width: 18, height: 18 };
const HomeIcon = () => <svg viewBox="0 0 24 24" style={icon} fill="none" stroke="currentColor" strokeWidth="2" strokeLinejoin="round"><path d="M4 11l8-7 8 7v9h-5v-6H9v6H4z" /></svg>;
const AwayIcon = () => <svg viewBox="0 0 24 24" style={icon} fill="currentColor"><path d="M21 15.5v-2l-8-5V3.8a1.5 1.5 0 0 0-3 0v4.7l-8 5v2l8-2.5v5.2L8 19.5V21l3.5-1 3.5 1v-1.5l-2-1.3V13z" /></svg>;
