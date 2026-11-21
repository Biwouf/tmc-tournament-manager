import { useEffect, useMemo, useRef, useState } from 'react';
import type { CSSProperties, ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { CLUB_BACKGROUND_NAME } from '../../lib/clubPosterBackground';
import type { PosterBackground } from '../../lib/clubConfig';
import { ensureClubPosterBackground } from '../../lib/defaultPosterBackground';
import { skipFirstStep } from '../../lib/firstSteps';
import { logOnboardingEvent } from '../../lib/onboardingEvents';
import { supabase } from '../../lib/supabase';
import { drawPosterPartners, newPartnerSeed } from '../../lib/posterPartners';
import TeamMatchImagePreview from '../TeamMatchImagePreview';
import type { RencontreEntry } from '../teamMatches/gridTypes';
import { GENRE_LABELS, formatCategorie } from '../teamMatches/teamMatchLabels';
import { MAX_POSTER_MATCHES, formatRencontreDate } from '../teamMatches/poster/posterHelpers';
import { exportPosterJpeg, groupByWeek, posterFileName, usePosterSelection } from '../teamMatches/poster/posterSelection';
import { useTeamSaisons } from '../teamMatches/useTeamSaisons';
import { useTeamSeasonGrid } from '../teamMatches/useTeamSeasonGrid';
import { weekendFileDate } from '../teamMatches/weekend';
import { SHARE_BITRATE } from '../programmeAnimation/encodeAnimation';
import { partSuffix } from '../programmeAnimation/storyPublish';
import { shareableStory } from '../rencontresAnimation/timeline';
import { ExportCancelled, useRencontresVideo } from '../rencontresAnimation/useRencontresVideo';
import type { StepProps } from './FirstStepsFlow';
import { setPosterPreview, useMediaQuery, useStorySlot } from './posterSignal';
import StoryPlayer from './StoryPlayer';
import { downloadBlob, megabytes, remainingSeconds, shareModeFor, shareVideo, storyDates, storyDays } from './storyShare';

// SaaS S7 — étape « Vos affiches ». Depuis W1 (brief `SAAS_11_onboarding_tenup` §13.2), la story
// vidéo est en vedette : l'aperçu animé (`StoryPlayer`, le rendu de l'export dans un canvas) démarre
// dès l'entrée, sans encodage, avec la sélection de `PosterPanel` déjà faite (`posterSelection.ts`).
// L'étape est terminée après 3 s d'aperçu (ou l'affiche téléchargée). L'MP4 ne s'encode qu'au
// partage ou au téléchargement, à 4 Mb/s : partage natif sur mobile, téléchargement ailleurs ;
// au-delà de 30 s, seulement la première partie. L'affiche reste en action secondaire, instantanée ;
// son fond « Aux couleurs du club » est créé à l'entrée (`ensureClubPosterBackground`) si le club
// n'en a aucun. Pas de publication en actu ni sur Facebook depuis les premiers pas.

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
    {next && done && <div className="fs-footer"><button type="button" className="fs-btn fs-btn-p" onClick={next.go}>Suivant : {next.label} →</button></div>}
  </>;

  let body;
  const composing = ready && !saisonsError && saisons.length > 0 && !!saisonId;
  if (saisonsError) body = <p role="alert" className="fs-error">Les rencontres n’ont pas pu être chargées. {saisonsError}</p>;
  else if (!ready) body = <div className="h-32 animate-pulse rounded-xl bg-muted" />;
  else if (!saisons.length || !saisonId) body = empty('Ajoutez d’abord une équipe : l’affiche annonce ses prochaines rencontres.', true);
  else body = <SeasonPoster key={saisonId} saisonId={saisonId} {...props} bg={bg} retry={() => { setBg({ status: 'loading' }); setAttempt((n) => n + 1); }} empty={empty} />;

  return <>
    {!composing && <Head done={done} eyebrow={eyebrow} title={TITLE} lede={GENERIC_LEDE} />}
    {body}
  </>;
}

const TITLE = 'Votre story du week-end, déjà en route.';
const GENERIC_LEDE = 'La story et l’affiche de vos prochaines rencontres, aux couleurs du club.';

function Head({ done, eyebrow, title, lede }: { done: boolean; eyebrow: string; title: string; lede: string }) {
  return <>
    <span className={done ? 'fs-chip fs-chip-fill fs-pop' : 'fs-eyebrow'}>{done ? 'Étape terminée' : eyebrow}</span>
    <h2 className="fs-h" tabIndex={-1}>{title}</h2>
    <p className="fs-lede">{lede}</p>
  </>;
}

type SeasonProps = StepProps & {
  saisonId: string;
  bg: BackgroundState;
  retry: () => void;
  empty: (message: string, toTeams: boolean) => ReactNode;
};

function SeasonPoster({ saisonId, empty, ...props }: SeasonProps) {
  const head = (node: ReactNode) => <><Head done={props.state.completed_steps.includes(STEP_ID)} eyebrow={props.eyebrow} title={TITLE} lede={GENERIC_LEDE} />{node}</>;
  const { loading, error, blocks, entries } = useTeamSeasonGrid(saisonId);
  const teams = blocks.reduce((n, b) => n + b.equipes.length, 0);
  const upcoming = useMemo(() => groupByWeek(entries, new Date()).length > 0, [entries]);
  if (error) return head(<p role="alert" className="fs-error">Les rencontres n’ont pas pu être chargées. {error}</p>);
  if (loading) return head(<div className="h-32 animate-pulse rounded-xl bg-muted" />);
  if (!teams) return head(empty('Ajoutez d’abord une équipe : l’affiche annonce ses prochaines rencontres.', true));
  if (!upcoming) return head(empty('Aucune rencontre à venir pour vos équipes. L’affiche se prépare dès qu’une rencontre est programmée.', false));
  return <Composer entries={entries} {...props} />;
}

const ENCODE_ERROR = 'La vidéo n’a pas pu être créée. Réessayez, ou téléchargez l’affiche.';

type ComposerProps = Omit<SeasonProps, 'saisonId' | 'empty'> & { entries: RencontreEntry[] };

function Composer({ club, config, state, complete, next, entries, bg, retry, eyebrow }: ComposerProps) {
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
  const done = state.completed_steps.includes(STEP_ID);
  const [editing, setEditing] = useState(false);
  const posterRef = useRef<HTMLDivElement>(null);
  const [posterBusy, setPosterBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Story : même moteur que /medias ; la timeline est la vidéo partagée (première partie au-delà de 30 s).
  const video = useRencontresVideo({
    matches: selectedMatches,
    partnerLogos,
    color,
    logo: config.brand.logo ?? '',
    logoInverse: config.brand.logo_inverse ?? '',
    clubName: config.brand.name || club.name,
    homeName: config.brand.city || config.brand.short_name || config.brand.name || club.name,
  });
  const story = useMemo(() => shareableStory(selectedMatches), [selectedMatches]);
  const suffix = partSuffix(0, story.parts);
  const texts = useMemo(() => ({ ...video.texts, kicker: video.texts.kicker + suffix }), [video.texts, suffix]);
  const fileName = `story-rencontres-${weekendFileDate(weekend)}`;
  const coarse = useMediaQuery('(pointer: coarse)');
  const mode = useMemo(() => shareModeFor(navigator, coarse), [coarse]);
  const wide = useMediaQuery('(min-width: 861px)');
  const slot = useStorySlot();
  // La vidéo encodée vaut pour une sélection : une autre coche l'invalide.
  const videoKey = selectedIds.join(',');
  const [made, setMade] = useState<{ key: string; blob: Blob } | null>(null);
  const blob = made?.key === videoKey ? made.blob : null;
  /** Temps écoulé depuis le début de l'encodage (ms), pour « Encore N secondes ». */
  const [elapsed, setElapsed] = useState(0);
  const n = selectedMatches.length;

  useEffect(() => {
    setPosterPreview({ matches: selectedMatches, background: background?.image, color, partnerLogos });
  }, [selectedMatches, background?.image, color, partnerLogos]);

  const finishStep = async (what: string) => {
    if (done) return;
    const failure = await complete();
    if (failure) setError(`${what}, mais l’avancement n’a pas pu être enregistré. ${failure}`);
  };

  const onSeen = () => {
    void logOnboardingEvent(supabase, club.id, 'video_previewed');
    void finishStep('Votre story est prête');
  };

  const deliver = async (file: Blob) => {
    if (mode === 'download') {
      downloadBlob(file, fileName);
      void logOnboardingEvent(supabase, club.id, 'video_shared', { method: 'download' });
      return;
    }
    try {
      if (await shareVideo(navigator, file, fileName) === 'shared') void logOnboardingEvent(supabase, club.id, 'video_shared', { method: 'share' });
    } catch (err) {
      console.error('[premiers-pas] partage de la vidéo', err);
      setError('Le partage n’a pas abouti. Téléchargez la vidéo à la place.');
      void logOnboardingEvent(supabase, club.id, 'video_export_failed', { reason: 'share' });
    }
  };

  const makeVideo = async () => {
    if (!video.canExport) return;
    setError(null);
    const t0 = performance.now();
    setElapsed(0);
    const clock = setInterval(() => setElapsed(performance.now() - t0), 500);
    await video.run(async () => {
      let out: Blob;
      try {
        out = await video.encode(story.tl, suffix, SHARE_BITRATE);
      } catch (err) {
        if (err instanceof ExportCancelled) return;
        console.error('[premiers-pas] encodage de la vidéo', err);
        setError(ENCODE_ERROR);
        void logOnboardingEvent(supabase, club.id, 'video_export_failed', { reason: 'encode' });
        return;
      }
      void logOnboardingEvent(supabase, club.id, 'video_exported', {
        seconds: Math.round(story.tl.total), ms: Math.round(performance.now() - t0), bytes: out.size,
      });
      setMade({ key: videoKey, blob: out });
      await deliver(out);
    }).finally(() => clearInterval(clock));
  };

  const downloadPoster = async () => {
    if (!background || !posterRef.current) return;
    setPosterBusy(true);
    setError(null);
    try {
      const link = document.createElement('a');
      link.href = await exportPosterJpeg(posterRef.current);
      link.download = posterFileName(weekend);
      link.click();
      void logOnboardingEvent(supabase, club.id, 'poster_generated');
    } catch (err) {
      console.error('[premiers-pas] génération de l’affiche', err);
      setError('L’affiche n’a pas pu être générée. Réessayez.');
      setPosterBusy(false);
      return;
    }
    await finishStep('Votre affiche est téléchargée');
    setPosterBusy(false);
  };

  const progress = video.progress;
  const percent = progress ? Math.floor((progress.frame / Math.max(1, progress.frames)) * 100) : 0;
  const encoding = video.exporting
    ? { percent, remaining: remainingSeconds(elapsed, progress?.frame ?? 0, progress?.frames ?? 1, story.tl.total) }
    : null;
  const seconds = Math.round(story.tl.total);
  const ready = !!blob && !video.exporting;
  const noEncoder = video.encoderOk === false;

  const player = n > 0 && (
    <div className="fs-story-block">
      <StoryPlayer tl={story.tl} palette={video.palette} texts={texts} assets={video.assets} fontsReady={video.fontsReady} encoding={encoding} onSeen={onSeen} />
      <div className="fs-story-chips">
        <span>Story 9:16</span>
        <span>{seconds} s</span>
        <span>{encoding ? `≈ ${megabytes((story.tl.total * SHARE_BITRATE) / 8)}` : 'Sans son'}</span>
      </div>
      {story.parts > 1 && (
        <p className="fs-note fs-story-parts">
          Vos rencontres font {Math.round(story.fullSeconds)} s de vidéo : on partage la 1ʳᵉ partie ({seconds} s). La suite est dans Médias.
        </p>
      )}
    </div>
  );

  const posterLabel = posterBusy ? 'Préparation de l’affiche…' : 'Télécharger l’affiche (image)';
  const posterDisabled = !n || !background || posterBusy;

  let lede: string;
  if (!n) lede = 'Cochez les rencontres à annoncer : la story et l’affiche se préparent aussitôt.';
  else if (ready) lede = mode === 'share'
    ? 'Envoyez-la sur Instagram, Facebook ou WhatsApp depuis le menu de partage.'
    : 'Elle est dans vos téléchargements : publiez-la en story depuis votre téléphone.';
  else lede = `Aux couleurs du club, avec ${n > 1 ? `vos ${n} rencontres` : 'votre rencontre'} de ${storyDays(selectedMatches)}. Elle tourne en boucle, sans son.`;

  return <>
    <Head done={done} eyebrow={eyebrow} title={ready ? 'Votre vidéo est prête.' : TITLE} lede={lede} />

    {wide && slot ? player && createPortal(player, slot) : player}

    <div className="fs-summary">
      <span>{n ? <><strong>{n} rencontre{n > 1 ? 's' : ''}</strong> · {storyDates(selectedMatches)}</> : <strong>Aucune rencontre cochée</strong>}</span>
      {video.exporting
        ? <button type="button" className="fs-link fs-link-small" onClick={video.cancel}>Annuler</button>
        : n > 0 && <button type="button" className="fs-link fs-link-small fs-link-brand" aria-expanded={editing} aria-controls="fs-story-edit" onClick={() => setEditing((e) => !e)}>{editing ? 'Fermer' : 'Modifier'}</button>}
    </div>

    {(editing || !n) && !video.exporting && (
      <div id="fs-story-edit" className="fs-group">
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
      </div>
    )}

    {bg.status === 'error' && !editing && n > 0 && <p role="alert" className="fs-error">{bg.message} <button type="button" className="fs-link fs-link-small" onClick={retry}>Réessayer</button></p>}
    {error && <p role="alert" className="fs-error">{error}</p>}

    {/* Barre d'actions collée en bas de l'écran quand la liste est ouverte (recette du 14/11/2026 :
        les boutons tombaient hors écran). Liste fermée, elle ne cache pas le bas de l'aperçu. */}
    <div className={`fs-footer fs-story-actions${editing || !n ? ' fs-sticky' : ''}`}>
      {noEncoder
        ? <>
            <button type="button" className="fs-btn fs-btn-p" disabled={posterDisabled} onClick={downloadPoster}>{posterBusy ? 'Préparation de l’affiche…' : 'Télécharger l’affiche'}</button>
            <p className="fs-note fs-wide">Ce navigateur ne sait pas créer la vidéo : l’aperçu reste, l’affiche se télécharge.</p>
          </>
        : <>
            {video.exporting
              ? <button type="button" className="fs-btn fs-btn-p" disabled>Préparation… {percent} %</button>
              : ready && blob
                ? mode === 'share'
                  ? <>
                      <button type="button" className="fs-btn fs-btn-p" onClick={() => deliver(blob)}>Partager la vidéo</button>
                      <button type="button" className="fs-btn fs-btn-o" onClick={() => { downloadBlob(blob, fileName); void logOnboardingEvent(supabase, club.id, 'video_shared', { method: 'download' }); }}>Télécharger · MP4, {megabytes(blob.size)}</button>
                    </>
                  : <button type="button" className="fs-btn fs-btn-p" onClick={() => deliver(blob)}>Télécharger · MP4, {megabytes(blob.size)}</button>
                : <button type="button" className="fs-btn fs-btn-p" disabled={!n || !video.canExport} onClick={makeVideo}>
                    {mode === 'share' ? 'Partager la vidéo' : 'Télécharger la vidéo · MP4'}
                  </button>}
            <button type="button" className="fs-btn fs-btn-o" disabled={posterDisabled} onClick={downloadPoster}>{posterLabel}</button>
            {mode === 'download' && !ready && !video.exporting && n > 0 && (
              <p className="fs-note fs-wide">La vidéo se prépare dans votre navigateur quand vous la téléchargez : environ {seconds} secondes.</p>
            )}
          </>}
      {done && next && <button type="button" className="fs-btn fs-btn-o" disabled={video.exporting} onClick={next.go}>Suivant : {next.label} →</button>}
    </div>

    {/* Affiche hors viewport — requise pour html-to-image, comme dans `PosterPanel`. */}
    <div style={{ position: 'fixed', left: -99999, top: 0, pointerEvents: 'none' }} aria-hidden>
      <div ref={posterRef}>
        <TeamMatchImagePreview matches={selectedMatches} background={background?.image} color={color} partnerLogos={partnerLogos} />
      </div>
    </div>
  </>;
}
