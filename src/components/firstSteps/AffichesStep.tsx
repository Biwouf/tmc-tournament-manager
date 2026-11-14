import { useEffect, useMemo, useRef, useState } from 'react';
import type { CSSProperties, ReactNode } from 'react';
import { CLUB_BACKGROUND_NAME } from '../../lib/clubPosterBackground';
import type { PosterBackground } from '../../lib/clubConfig';
import { ensureClubPosterBackground } from '../../lib/defaultPosterBackground';
import { skipFirstStep } from '../../lib/firstSteps';
import { drawPosterPartners, newPartnerSeed } from '../../lib/posterPartners';
import TeamMatchImagePreview from '../TeamMatchImagePreview';
import type { RencontreEntry } from '../teamMatches/gridTypes';
import { GENRE_LABELS, formatCategorie } from '../teamMatches/teamMatchLabels';
import { MAX_POSTER_MATCHES, formatRencontreDate } from '../teamMatches/poster/posterHelpers';
import { exportPosterJpeg, groupByWeek, posterFileName, usePosterSelection } from '../teamMatches/poster/posterSelection';
import { useTeamSaisons } from '../teamMatches/useTeamSaisons';
import { useTeamSeasonGrid } from '../teamMatches/useTeamSeasonGrid';
import { weekendFileDate } from '../teamMatches/weekend';
import { useRencontresVideo, type RencontresVideoInput } from '../rencontresAnimation/useRencontresVideo';
import type { StepProps } from './FirstStepsFlow';
import { setPosterPreview } from './posterSignal';

// SaaS S7 — étape « Vos affiches » : la vraie affiche des rencontres, aux couleurs du club, sans
// fond fourni. Le fond « Aux couleurs du club » est créé à l'entrée dans l'étape si le club n'en a
// aucun (`ensureClubPosterBackground`) ; sélection et export sont ceux de `PosterPanel`
// (`posterSelection.ts`). Étape terminée dès l'affiche générée, qui se télécharge ensuite (pas de
// publication en actu depuis les premiers pas, décision du 13/11/2026). Depuis S7b, la story vidéo
// de `/medias` se télécharge aussi, par le même moteur (`useRencontresVideo`), sans publication Facebook.

const STEP_ID = 'affiches';

type BackgroundState =
  | { status: 'loading' }
  | { status: 'ready'; list: PosterBackground[] }
  | { status: 'error'; message: string };

export default function AffichesStep(props: StepProps) {
  const { club, config, state, eyebrow, next, goTo } = props;
  const { saisons, ready, error: saisonsError, saisonId } = useTeamSaisons();
  const [bg, setBg] = useState<BackgroundState>({ status: 'loading' });
  const [attempt, setAttempt] = useState(0);
  const [leaving, setLeaving] = useState(false);
  const [skipError, setSkipError] = useState<string | null>(null);
  const done = state.completed_steps.includes(STEP_ID);

  // Le fond par défaut, à la première entrée dans l'étape (sans effet si la liste n'est pas vide).
  useEffect(() => {
    let active = true;
    ensureClubPosterBackground(club, { name: config.brand.name || club.name, color: config.brand.color, logo: config.brand.logo || null }).then(
      ({ backgrounds }) => { if (active) setBg({ status: 'ready', list: backgrounds }); },
      (err: unknown) => {
        console.error('[premiers-pas] fond aux couleurs du club', err);
        if (active) setBg({ status: 'error', message: 'Le fond aux couleurs du club n’a pas pu être préparé. Vérifiez votre connexion puis réessayez.' });
      },
    );
    return () => { active = false; };
  }, [club, config.brand.name, config.brand.color, config.brand.logo, attempt]);

  useEffect(() => () => setPosterPreview(null), []);

  const skip = async () => {
    if (!next) return;
    setLeaving(true);
    const result = await skipFirstStep(club.id, STEP_ID);
    setLeaving(false);
    if (result.error !== undefined) { setSkipError(result.error); return; }
    next.go();
  };

  const empty = (message: string, toTeams: boolean) => <>
    <p className="fs-notice" role="status">{message}</p>
    {toTeams && <button type="button" className="fs-btn fs-btn-o fs-btn-small" onClick={() => goTo('equipes')}>Ajouter une équipe</button>}
    {skipError && <p role="alert" className="fs-error">{skipError}</p>}
    {next && !done && (
      <div className="fs-footer">
        <button type="button" className="fs-link" disabled={leaving} onClick={skip}>Passer cette étape</button>
      </div>
    )}
    {next && done && <div className="fs-footer"><button type="button" className="fs-btn fs-btn-p" onClick={next.go}>Terminer →</button></div>}
  </>;

  let body;
  if (saisonsError) body = <p role="alert" className="fs-error">Les rencontres n’ont pas pu être chargées. {saisonsError}</p>;
  else if (!ready) body = <div className="h-32 animate-pulse rounded-xl bg-muted" />;
  else if (!saisons.length || !saisonId) body = empty('Ajoutez d’abord une équipe : l’affiche annonce ses prochaines rencontres.', true);
  else body = <SeasonPoster key={saisonId} saisonId={saisonId} {...props} bg={bg} retry={() => { setBg({ status: 'loading' }); setAttempt((n) => n + 1); }} empty={empty} />;

  return <>
    <span className={done ? 'fs-chip fs-chip-fill fs-pop' : 'fs-eyebrow'}>{done ? 'Étape terminée' : eyebrow}</span>
    <h2 className="fs-h" tabIndex={-1}>Annoncez le week-end comme un tournoi.</h2>
    <p className="fs-lede">L’affiche des prochaines rencontres, aux couleurs du club. À publier en actu, sur Facebook ou au club-house.</p>
    {body}
  </>;
}

type SeasonProps = StepProps & {
  saisonId: string;
  bg: BackgroundState;
  retry: () => void;
  empty: (message: string, toTeams: boolean) => ReactNode;
};

function SeasonPoster({ saisonId, empty, ...props }: SeasonProps) {
  const { loading, error, blocks, entries } = useTeamSeasonGrid(saisonId);
  const teams = blocks.reduce((n, b) => n + b.equipes.length, 0);
  const upcoming = useMemo(() => groupByWeek(entries, new Date()).length > 0, [entries]);
  if (error) return <p role="alert" className="fs-error">Les rencontres n’ont pas pu être chargées. {error}</p>;
  if (loading) return <div className="h-32 animate-pulse rounded-xl bg-muted" />;
  if (!teams) return empty('Ajoutez d’abord une équipe : l’affiche annonce ses prochaines rencontres.', true);
  if (!upcoming) return empty('Aucune rencontre à venir pour vos équipes. L’affiche se prépare dès qu’une rencontre est programmée.', false);
  return <Composer entries={entries} {...props} />;
}

function Composer({ club, config, state, complete, next, entries, bg, retry }: Omit<SeasonProps, 'saisonId' | 'empty'> & { entries: RencontreEntry[] }) {
  const { groupes, weekend, selectedIds, selected, atMax, toggle, takeAll, selectedMatches } = usePosterSelection(entries);
  const list = bg.status === 'ready' ? bg.list : [];
  const [chosen, setChosen] = useState<string | null>(null);
  const background = list.find((b) => b.image === chosen)
    ?? list.find((b) => b.name === CLUB_BACKGROUND_NAME)
    ?? list[0];
  const color = config.brand.color ?? '';
  // Partenaires : la règle de `PosterPanel` (10 au plus, tirage fixé pour que l'aperçu soit l'export).
  const partnerLogos = useMemo(
    () => drawPosterPartners(config.partners.map((p) => p.logo).filter(Boolean), newPartnerSeed()),
    [config.partners],
  );
  // L'affiche générée vaut pour une sélection et un fond : toute nouvelle coche ou un autre fond
  // l'invalide, comme dans `PosterPanel`.
  const selectionKey = `${selectedIds.join(',')}|${background?.image ?? ''}`;
  const [generated, setGenerated] = useState<{ key: string; url: string } | null>(null);
  const dataUrl = generated?.key === selectionKey ? generated.url : null;
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const posterRef = useRef<HTMLDivElement>(null);
  const done = state.completed_steps.includes(STEP_ID);

  useEffect(() => {
    setPosterPreview({ matches: selectedMatches, background: background?.image, color, partnerLogos });
  }, [selectedMatches, background?.image, color, partnerLogos]);

  const generate = async () => {
    if (!background || !posterRef.current) return;
    setBusy(true);
    setError(null);
    try {
      setGenerated({ key: selectionKey, url: await exportPosterJpeg(posterRef.current) });
    } catch (err) {
      console.error('[premiers-pas] génération de l’affiche', err);
      setError('L’affiche n’a pas pu être générée. Réessayez.');
      setBusy(false);
      return;
    }
    if (!done) {
      const failure = await complete();
      if (failure) setError(`Votre affiche est prête, mais l’avancement n’a pas pu être enregistré. ${failure}`);
    }
    setBusy(false);
  };

  return <>
    <fieldset className="fs-fieldset">
      <legend className="fs-label">Rencontres à annoncer</legend>
      <p className="fs-note" aria-live="polite">{selectedIds.length} / {MAX_POSTER_MATCHES} sélectionnées</p>
      {groupes.map((groupe) => (
        <div key={groupe.key} className="fs-group">
          <div className="fs-poster-group">
            <span className="fs-note">{groupe.label}</span>
            {groupe.entries.some((e) => !selected.has(e.rencontre.id)) && !atMax && (
              <button type="button" className="fs-link fs-link-small" onClick={() => takeAll(groupe)}>Tout prendre</button>
            )}
          </div>
          <div className="fs-choices">
            {groupe.entries.map((e) => {
              const on = selected.has(e.rencontre.id);
              const off = !on && atMax;
              return (
                <label key={e.rencontre.id} className={`fs-choice${on ? ' on' : ''}${off ? ' off' : ''}`}>
                  <input type="checkbox" checked={on} disabled={off} onChange={() => toggle(e.rencontre.id)} />
                  <span className="fs-team-body">
                    <span className="fs-team-name">{GENRE_LABELS[e.competition.genre]} {formatCategorie(e.competition.categorie)} {e.equipe.numero} · vs {e.rencontre.club_adverse}</span>
                    <span className="fs-team-detail">{formatRencontreDate(e.rencontre.date_heure)} · {e.rencontre.domicile ? 'au club' : 'à l’extérieur'}</span>
                  </span>
                </label>
              );
            })}
          </div>
        </div>
      ))}
    </fieldset>

    <fieldset className="fs-fieldset">
      <legend className="fs-label">Fond de l’affiche</legend>
      {bg.status === 'loading' && <p className="fs-progress-line" role="status"><span className="fs-spin" aria-hidden="true" />Préparation du fond aux couleurs du club…</p>}
      {bg.status === 'error' && <>
        <p role="alert" className="fs-error">{bg.message}</p>
        <button type="button" className="fs-btn fs-btn-o fs-btn-small" onClick={retry}>Réessayer</button>
      </>}
      {bg.status === 'ready' && (
        <div className="fs-seg">
          {list.map((item) => (
            <button key={item.image} type="button" className="fs-btn fs-btn-o" aria-pressed={item.image === background?.image} onClick={() => setChosen(item.image)}>
              {item.name === CLUB_BACKGROUND_NAME
                ? <><span aria-hidden="true" className="fs-swatch" style={{ '--swatch': 'var(--brand-fill)' } as CSSProperties} />Couleurs du club</>
                : item.name}
            </button>
          ))}
        </div>
      )}
    </fieldset>

    {error && <p role="alert" className="fs-error">{error}</p>}

    {/* Barre d'actions collée en bas de l'écran : avec 7 ou 8 rencontres cochées, « Télécharger »
        tombait sous la liste, hors écran (recette du 14/11/2026). */}
    {!dataUrl
      ? <div className="fs-footer fs-sticky">
          <button type="button" className="fs-btn fs-btn-p" disabled={!selectedMatches.length || !background || busy} onClick={generate}>
            {busy ? 'Génération…' : 'Générer l’affiche'}
          </button>
          {done && next && <button type="button" className="fs-btn fs-btn-o" onClick={next.go}>Terminer →</button>}
        </div>
      : <div className="fs-group fs-sticky" role="status">
          <span className="fs-note">Votre affiche est prête.</span>
          <div className="fs-actions">
            <a className="fs-btn fs-btn-p" href={dataUrl} download={posterFileName(weekend)}>Télécharger</a>
            <StoryDownload
              matches={selectedMatches}
              partnerLogos={partnerLogos}
              color={color}
              logo={config.brand.logo ?? ''}
              logoInverse={config.brand.logo_inverse ?? ''}
              clubName={config.brand.name || club.name}
              homeName={config.brand.city || config.brand.short_name || config.brand.name || club.name}
              fileName={`story-rencontres-${weekendFileDate(weekend)}`}
            />
            {next && <button type="button" className="fs-btn fs-btn-o" disabled={busy} onClick={next.go}>Terminer →</button>}
          </div>
        </div>}

    {/* Affiche hors viewport — requise pour html-to-image, comme dans `PosterPanel`. */}
    <div style={{ position: 'fixed', left: -99999, top: 0, pointerEvents: 'none' }} aria-hidden>
      <div ref={posterRef}>
        <TeamMatchImagePreview matches={selectedMatches} background={background?.image} color={color} partnerLogos={partnerLogos} />
      </div>
    </div>
  </>;
}

/** Story vidéo des rencontres de l'affiche, montée une fois l'affiche générée : le moteur de
 *  `/medias` (`useRencontresVideo`), en téléchargement seul. */
function StoryDownload({ fileName, ...input }: RencontresVideoInput & { fileName: string }) {
  const video = useRencontresVideo(input);
  if (video.encoderOk === false) return <p className="fs-note fs-wide">Ce navigateur ne sait pas générer la vidéo : utilisez une version récente de Chrome, Edge ou Safari.</p>;
  return <>
    <button type="button" className="fs-btn fs-btn-o" disabled={!video.canExport} onClick={() => video.download(fileName)}>
      {video.exporting ? 'Vidéo en cours…' : 'Télécharger la vidéo (story)'}
    </button>
    {video.progress && (
      <div className="fs-wide fs-video-progress">
        <progress value={video.progress.frame} max={video.progress.frames} aria-label="Génération de la vidéo" />
        <span className="fs-note">Image {video.progress.frame} / {video.progress.frames}. Ne fermez pas cette page.</span>
        <button type="button" className="fs-link fs-link-small" onClick={video.cancel}>Annuler</button>
      </div>
    )}
    {video.exportError && <p role="alert" className="fs-error fs-wide">{video.exportError}</p>}
  </>;
}
