import { useEffect, useMemo, useRef, useState } from 'react';
import { toPng } from 'html-to-image';
import { useClub } from '../../contexts/ClubContext';
import { useClubConfig } from '../../hooks/useClubConfig';
import { GENRE_LABELS, formatCategorie } from './teamMatchLabels';
import type { RencontreEntry } from './gridTypes';
import { buildTeamCalendar } from '../../../shared/teamCalendar';
import { TeamCalendarImage } from '../../../shared/TeamCalendarImage';

/** Export PNG du calendrier des rencontres à venir (compétitions non terminées). */
export default function CalendarExportButton({
  entries,
  saisonLabel,
}: {
  entries: RencontreEntry[];
  saisonLabel: string;
}) {
  const { club } = useClub();
  const { config } = useClubConfig();
  const [exporting, setExporting] = useState(false);
  const nodeRef = useRef<HTMLDivElement>(null);

  const calendar = useMemo(
    () =>
      buildTeamCalendar(
        entries.map(({ rencontre, equipe, competition }) => ({
          ...rencontre,
          column: {
            key: equipe.id,
            title: competition.nom,
            subtitle: `${GENRE_LABELS[competition.genre]} ${formatCategorie(competition.categorie)} · Éq. ${equipe.numero}`,
            sortKey: `${competition.created_at}|${competition.id}|${String(equipe.numero).padStart(3, '0')}`,
          },
        }))
      ),
    [entries]
  );

  // Le nœud n'est monté que pendant l'export : on le rasterise au rendu suivant.
  useEffect(() => {
    if (!exporting || !nodeRef.current) return;
    toPng(nodeRef.current, { pixelRatio: 2, backgroundColor: '#ffffff' })
      .then((url) => {
        const a = document.createElement('a');
        a.href = url;
        a.download = `calendrier-rencontres-${saisonLabel.replace(/[^\w-]+/g, '-')}.png`;
        a.click();
      })
      .catch((err) => console.error(err))
      .finally(() => setExporting(false));
  }, [exporting, saisonLabel]);

  return (
    <>
      <button
        type="button"
        onClick={() => setExporting(true)}
        disabled={exporting || calendar.count === 0}
        title={calendar.count === 0 ? 'Aucune rencontre à venir' : undefined}
        className="rounded-lg border border-border bg-card px-4 py-2 text-sm font-medium transition hover:bg-muted disabled:opacity-50"
      >
        {exporting ? 'Export…' : 'Exporter le calendrier'}
      </button>
      {exporting && (
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
    </>
  );
}
