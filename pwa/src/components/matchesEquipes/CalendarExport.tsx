import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { toBlob } from 'html-to-image';
import { supabase } from '../../lib/supabase';
import { useClub } from '../../contexts/ClubContext';
import { useClubConfig } from '../../hooks/useClubConfig';
import { useHeaderSlot } from '../layout/HeaderActionContext';
import type { TeamCompetition, TeamEquipe, TeamEtape, TeamRencontre } from '../../types';
import { competitionShortLabel } from './labels';
import { buildTeamCalendar, type CalendarRencontre, type TeamCalendar } from '../../../../shared/teamCalendar';
import { TeamCalendarImage } from '../../../../shared/TeamCalendarImage';

type State =
  | { step: 'idle' }
  | { step: 'loading'; calendar?: TeamCalendar }
  | { step: 'ready'; blob: Blob; url: string }
  | { step: 'empty' | 'error' };

/**
 * Bouton du header (à gauche du profil) qui exporte en PNG le calendrier de toutes les
 * rencontres à venir de la saison, toutes équipes confondues, quel que soit le filtre affiché.
 */
export default function CalendarExport({
  saisonLabel,
  competitions,
  equipes,
}: {
  saisonLabel: string;
  competitions: TeamCompetition[];
  equipes: TeamEquipe[];
}) {
  const { clubId, club } = useClub();
  const { config } = useClubConfig();
  const { slot } = useHeaderSlot();
  const [state, setState] = useState<State>({ step: 'idle' });
  const nodeRef = useRef<HTMLDivElement>(null);

  const start = async () => {
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
      setState(calendar.count ? { step: 'loading', calendar } : { step: 'empty' });
    } catch (err) {
      console.error(err);
      setState({ step: 'error' });
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

  const fileName = `calendrier-rencontres-${saisonLabel.replace(/[^\w-]+/g, '-')}.png`;
  const file = state.step === 'ready' ? new File([state.blob], fileName, { type: 'image/png' }) : null;
  const canShare = !!file && typeof navigator.canShare === 'function' && navigator.canShare({ files: [file] });
  const close = () => setState({ step: 'idle' });

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
          type="button"
          onClick={start}
          disabled={state.step === 'loading'}
          aria-label="Exporter le calendrier des rencontres"
          className="flex h-9 w-9 items-center justify-center rounded-full bg-primary/10 text-primary active:opacity-70 disabled:opacity-50"
        >
          {state.step === 'loading' ? (
            <span className="h-4 w-4 animate-spin rounded-full border-2 border-primary border-t-transparent" aria-hidden="true" />
          ) : (
            <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor"
              strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="h-5 w-5" aria-hidden="true">
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

      {(state.step === 'ready' || state.step === 'empty' || state.step === 'error') && (
        <div className="fixed inset-0 z-[60] flex flex-col bg-black/85" role="dialog" aria-modal="true"
          aria-label="Calendrier des rencontres">
          <div className="flex items-center justify-between px-4 pt-[max(env(safe-area-inset-top),12px)] pb-3 text-white">
            <span className="text-[15px] font-bold">Calendrier des rencontres</span>
            <button type="button" onClick={close} className="h-9 px-2 text-sm font-semibold active:opacity-70">
              Fermer
            </button>
          </div>
          {state.step === 'ready' ? (
            <>
              <div className="flex flex-1 items-center justify-center overflow-auto px-3">
                <img src={state.url} alt="Calendrier des rencontres à venir" className="max-h-full w-full rounded-lg object-contain" />
              </div>
              <div className="flex gap-3 px-4 pt-3 pb-[max(env(safe-area-inset-bottom),16px)]">
                {canShare && (
                  <button type="button" onClick={share}
                    className="h-11 flex-1 rounded-xl bg-primary text-sm font-bold text-primary-foreground active:brightness-95">
                    Partager
                  </button>
                )}
                <a href={state.url} download={fileName}
                  className="flex h-11 flex-1 items-center justify-center rounded-xl bg-white text-sm font-bold text-foreground active:opacity-80">
                  Enregistrer
                </a>
              </div>
            </>
          ) : (
            <p className="m-auto max-w-xs px-6 text-center text-sm text-white/90">
              {state.step === 'empty'
                ? 'Aucune rencontre à venir sur cette saison.'
                : 'Le calendrier n’a pas pu être généré. Réessayez dans un instant.'}
            </p>
          )}
        </div>
      )}
    </>
  );
}
