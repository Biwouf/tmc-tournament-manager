import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { toBlob } from 'html-to-image';
import { supabase } from '../../lib/supabase';
import { useClub } from '../../contexts/ClubContext';
import { useClubConfig } from '../../hooks/useClubConfig';
import { useHeaderSlot } from '../layout/HeaderActionContext';
import { useDialogFocus } from './useDialogFocus';
import type { TeamCompetition, TeamEquipe, TeamEtape, TeamRencontre } from '../../types';
import { competitionShortLabel } from './labels';
import { buildTeamCalendar, type CalendarRencontre, type TeamCalendar } from '../../../../shared/teamCalendar';
import { TeamCalendarImage } from '../../../../shared/TeamCalendarImage';

type State =
  | { step: 'idle' }
  | { step: 'loading'; calendar?: TeamCalendar }
  | { step: 'ready'; blob: Blob; url: string }
  | { step: 'empty' | 'error' };

// Marque l'entrée d'historique posée à l'ouverture : le bouton retour (Android) ferme le
// dialogue sans quitter la liste.
const HISTORY_MARK = 'calendarExport';

/**
 * Bouton icône du header (à gauche du profil, portail dans `useHeaderSlot`) qui exporte en PNG
 * le calendrier des rencontres à venir de la saison affichée, pour les équipes reçues
 * (l'équipe filtrée, ou toutes). L'aperçu s'ouvre en portail sur `document.body`, au-dessus
 * du header et de la bannière d'installation.
 */
export default function CalendarExport({
  saisonLabel,
  scopeLabel,
  competitions,
  equipes,
}: {
  saisonLabel: string;
  /** Périmètre exporté, en sous-titre : « Saison 2026/2027 · Toutes les équipes ». */
  scopeLabel: string;
  competitions: TeamCompetition[];
  equipes: TeamEquipe[];
}) {
  const { clubId, club } = useClub();
  const { config } = useClubConfig();
  const { slot } = useHeaderSlot();
  const [state, setState] = useState<State>({ step: 'idle' });
  const nodeRef = useRef<HTMLDivElement>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);

  const start = async () => {
    window.history.pushState({ ...window.history.state, [HISTORY_MARK]: true }, '');
    if (equipes.length === 0) return setState({ step: 'empty' });
    setState({ step: 'loading' });
    try {
      const { data: etapes, error: e1 } = await supabase
        .from('team_etapes')
        .select('*')
        .eq('club_id', clubId)
        .in('equipe_id', equipes.map((e) => e.id));
      if (e1) throw e1;
      const { data: rencs, error: e2 } = await supabase
        .from('team_rencontres')
        .select('*')
        .eq('club_id', clubId)
        .in('etape_id', (etapes as TeamEtape[]).map((et) => et.id))
        .gte('date_heure', new Date(Date.now() - 24 * 3600_000).toISOString());
      if (e2) throw e2;
      const items: CalendarRencontre[] = (rencs as TeamRencontre[]).flatMap((r) => {
        const etape = (etapes as TeamEtape[]).find((et) => et.id === r.etape_id);
        const equipe = equipes.find((eq) => eq.id === etape?.equipe_id);
        const comp = competitions.find((c) => c.id === equipe?.competition_id);
        if (!equipe || !comp) return [];
        return [{
          ...r,
          column: {
            key: equipe.id,
            title: comp.nom,
            subtitle: `${competitionShortLabel(comp)} · Éq. ${equipe.numero}`,
            sortKey: `${comp.created_at}|${comp.id}|${String(equipe.numero).padStart(3, '0')}`,
          },
        }];
      });
      const calendar = buildTeamCalendar(items);
      setState((s) => (s.step === 'idle' ? s : calendar.count ? { step: 'loading', calendar } : { step: 'empty' }));
    } catch (err) {
      console.error(err);
      setState((s) => (s.step === 'idle' ? s : { step: 'error' }));
    }
  };

  // Le nœud hors écran est monté avec le calendrier : on le rasterise au rendu suivant.
  const calendar = state.step === 'loading' ? state.calendar : undefined;
  useEffect(() => {
    if (!calendar || !nodeRef.current) return;
    let cancelled = false;
    toBlob(nodeRef.current, { pixelRatio: 2, backgroundColor: '#ffffff' })
      .then((blob) => {
        if (cancelled) return;
        if (!blob) throw new Error('Image vide');
        setState({ step: 'ready', blob, url: URL.createObjectURL(blob) });
      })
      .catch((err) => {
        console.error(err);
        if (!cancelled) setState({ step: 'error' });
      });
    return () => {
      cancelled = true;
    };
  }, [calendar]);

  useEffect(() => () => {
    if (state.step === 'ready') URL.revokeObjectURL(state.url);
  }, [state]);

  // Retour matériel pendant le chargement ou l'aperçu : on quitte l'entrée posée par start().
  const active = state.step !== 'idle';
  useEffect(() => {
    if (!active) return;
    const onPop = () => {
      if (!window.history.state?.[HISTORY_MARK]) setState({ step: 'idle' });
    };
    window.addEventListener('popstate', onPop);
    return () => window.removeEventListener('popstate', onPop);
  }, [active]);

  const fileName = `calendrier-rencontres-${saisonLabel.replace(/[^\w-]+/g, '-')}.png`;
  const file = state.step === 'ready' ? new File([state.blob], fileName, { type: 'image/png' }) : null;
  const canShare = !!file && typeof navigator.canShare === 'function' && navigator.canShare({ files: [file] });
  const close = () => {
    if (window.history.state?.[HISTORY_MARK]) window.history.back(); // popstate → idle
    else setState({ step: 'idle' });
  };
  const dialogOpen = state.step === 'ready' || state.step === 'empty' || state.step === 'error';
  const dialogRef = useRef<HTMLDivElement>(null);
  // Le bouton est désactivé pendant le chargement : il a perdu le focus avant l'ouverture.
  useDialogFocus(dialogRef, close, dialogOpen, buttonRef);

  const share = async () => {
    if (!file) return;
    try {
      await navigator.share({ files: [file], title: 'Calendrier des rencontres' });
    } catch (err) {
      if ((err as Error).name !== 'AbortError') console.error(err);
    }
  };

  return (
    <>
      {slot && createPortal(
        <button
          ref={buttonRef}
          type="button"
          onClick={start}
          disabled={state.step === 'loading'}
          aria-label="Exporter le calendrier"
          className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full text-foreground active:opacity-60 disabled:opacity-60"
        >
          {state.step === 'loading' ? (
            <span className="h-5 w-5 animate-spin rounded-full border-2 border-current border-t-transparent" aria-hidden="true" />
          ) : (
            <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor"
              strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="h-[22px] w-[22px]" aria-hidden="true">
              <rect x="3" y="4.5" width="18" height="16.5" rx="2.5" />
              <path d="M3 9.5h18M8 2.5v4M16 2.5v4M12 13v5M9.5 15.5 12 18l2.5-2.5" />
            </svg>
          )}
        </button>,
        slot,
      )}

      {calendar && (
        <div aria-hidden="true" style={{ position: 'fixed', left: -100000, top: 0, pointerEvents: 'none' }}>
          <TeamCalendarImage
            ref={nodeRef}
            calendar={calendar}
            clubName={club?.name ?? ''}
            saisonLabel={saisonLabel}
            logoUrl={config.brand.logo}
            color={config.brand.color}
          />
        </div>
      )}

      {dialogOpen && createPortal(
        // Portail sur body : un ancêtre transformé (pull-to-refresh) ne borne plus le `fixed`.
        // z-[70] : au-dessus du header (50) et de la bannière d'installation (60).
        <div ref={dialogRef} className="fixed inset-0 z-[70] flex flex-col bg-black/[.92]" role="dialog" aria-modal="true"
          aria-labelledby="calendar-export-title" aria-describedby="calendar-export-scope">
          <div className="flex items-start justify-between gap-3 bg-[#0b0b0b] px-4 pt-[max(env(safe-area-inset-top),12px)] pb-3 text-white">
            <div className="min-w-0 pt-1.5">
              <h2 id="calendar-export-title" className="text-[17px] font-bold leading-tight tracking-tight">Exporter le calendrier</h2>
              <p id="calendar-export-scope" className="mt-1 text-[13px] font-medium text-white/70">{scopeLabel}</p>
            </div>
            <button type="button" onClick={close} className="min-h-11 min-w-11 shrink-0 px-2 text-[15px] font-semibold active:opacity-70">
              Fermer
            </button>
          </div>
          {state.step === 'ready' ? (
            <>
              <div className="flex flex-1 items-center justify-center overflow-auto px-4 py-3">
                <img src={state.url} alt="Calendrier des rencontres à venir" className="max-h-full w-full rounded-xl object-contain" />
              </div>
              <div className="flex gap-3 px-4 pt-3 pb-[max(env(safe-area-inset-bottom),16px)]">
                {canShare && (
                  <button type="button" onClick={share}
                    className="min-h-11 flex-1 rounded-xl bg-primary text-[15px] font-bold text-primary-foreground active:brightness-95">
                    Partager
                  </button>
                )}
                <a href={state.url} download={fileName}
                  className="flex min-h-11 flex-1 items-center justify-center rounded-xl bg-white text-[15px] font-bold text-foreground active:opacity-80">
                  Enregistrer
                </a>
              </div>
            </>
          ) : (
            <p className="m-auto max-w-xs px-6 text-center text-sm text-white/90">
              {state.step === 'empty'
                ? equipes.length === 1
                  ? 'Aucune rencontre à venir pour cette équipe.'
                  : 'Aucune rencontre à venir sur cette saison.'
                : 'Le calendrier n’a pas pu être généré. Réessayez dans un instant.'}
            </p>
          )}
        </div>,
        document.body,
      )}
    </>
  );
}
