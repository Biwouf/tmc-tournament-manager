import { useState } from 'react';
import { Link, useLocation } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { supabase } from '../../lib/supabase';
import { fromHere } from '../layout/useGoBack';
import MatchEquipeList, { type EnrichedRencontre } from '../matchesEquipes/MatchEquipeList';
import type { TeamCompetition, TeamEquipe, TeamEtape, TeamRencontre } from '../../types';
import '../matchesEquipes/matchesEquipes.css';

/** De maintenant à dimanche 23:59 (le jour même si l'on est dimanche). */
function weekendWindow(now: Date): [Date, Date] {
  const end = new Date(now);
  end.setDate(now.getDate() + ((7 - now.getDay()) % 7));
  end.setHours(23, 59, 59, 999);
  const start = new Date(now);
  start.setHours(0, 0, 0, 0);
  return [start, end];
}

async function fetchWeekend(clubId: string, now: Date): Promise<EnrichedRencontre[]> {
  const [start, end] = weekendWindow(now);
  const { data: rencs, error } = await supabase
    .from('team_rencontres')
    .select('*')
    .eq('club_id', clubId)
    .eq('wo', false)
    .gte('date_heure', start.toISOString())
    .lte('date_heure', end.toISOString())
    .order('date_heure', { ascending: true });
  if (error) throw error;
  const rows = (rencs ?? []) as TeamRencontre[];
  if (rows.length === 0) return [];
  const { data: etapes, error: e1 } = await supabase.from('team_etapes').select('*')
    .eq('club_id', clubId).in('id', [...new Set(rows.map(r => r.etape_id))]);
  if (e1) throw e1;
  const { data: equipes, error: e2 } = await supabase.from('team_equipes').select('*')
    .eq('club_id', clubId).in('id', [...new Set((etapes as TeamEtape[]).map(et => et.equipe_id))]);
  if (e2) throw e2;
  const { data: comps, error: e3 } = await supabase.from('team_competitions').select('*')
    .eq('club_id', clubId).in('id', [...new Set((equipes as TeamEquipe[]).map(eq => eq.competition_id))]);
  if (e3) throw e3;
  return rows.flatMap((rencontre) => {
    const etape = (etapes as TeamEtape[]).find(et => et.id === rencontre.etape_id);
    const equipe = (equipes as TeamEquipe[]).find(eq => eq.id === etape?.equipe_id);
    const comp = (comps as TeamCompetition[]).find(c => c.id === equipe?.competition_id);
    // Déjà confirmée : plus rien à suivre en direct.
    if (!etape || !equipe || !comp || rencontre.confirmed_at) return [];
    return [{ rencontre, etape, equipe, comp, isLive: false }];
  });
}

/**
 * Live sans aucun match (brief UX PWA, PR4, maquette `live-vide`) : on explique où s'ouvriront
 * les lives et on montre les rencontres par équipes d'ici dimanche. L'invitation à se connecter
 * pour être prévenu reste celle de `LivePushBanner`, juste au-dessus (pas de doublon).
 */
export default function LiveEmptyState({ clubId }: { clubId: string | null }) {
  const location = useLocation();
  const [now] = useState(() => new Date());
  const weekend = useQuery({
    queryKey: ['live-empty-weekend', clubId],
    enabled: !!clubId,
    staleTime: 5 * 60_000,
    queryFn: () => fetchWeekend(clubId!, now),
  });
  const items = weekend.data ?? [];

  return (
    <div className="flex flex-col gap-5">
      <div className="px-2 pt-4 text-center">
        <h2 className="text-lg font-bold tracking-tight">Pas de match en direct</h2>
        <p className="mx-auto mt-1.5 max-w-xs text-sm leading-relaxed text-muted-foreground">
          {items.length > 0
            ? 'Aucun live n’est en cours. Les scores s’ouvriront ici dès qu’un match démarre ; en attendant, voici les rencontres du week-end.'
            : 'Aucun live n’est en cours. Les scores s’ouvriront ici dès qu’un match démarre.'}
        </p>
      </div>

      {items.length > 0 && (
        <div className="me-page -mx-4" style={{ height: 'auto', background: 'transparent' }}>
          <MatchEquipeList items={items} state="upcoming" />
        </div>
      )}

      <Link to="/matches-equipes" state={fromHere(location)}
        className="mx-auto flex min-h-11 items-center px-3 text-sm font-semibold text-primary underline underline-offset-2">
        {items.length > 0 ? 'Voir toutes les rencontres' : 'Voir les rencontres à venir'}
      </Link>
    </div>
  );
}
