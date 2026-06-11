import { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { supabase } from '../lib/supabase';
import type {
  TeamCompetition,
  TeamEquipe,
  TeamEtape,
  TeamRencontre,
  TeamSaison,
} from '../types';
import PullToRefreshWrapper from '../components/layout/PullToRefreshWrapper';
import MatchEquipeFilterBar from '../components/matchesEquipes/MatchEquipeFilterBar';
import MatchEquipeFilterSheet, {
  type SheetOption,
} from '../components/matchesEquipes/MatchEquipeFilterSheet';
import MatchEquipeList, {
  type EnrichedRencontre,
} from '../components/matchesEquipes/MatchEquipeList';
import { competitionShortLabel } from '../components/matchesEquipes/labels';

export default function MatchesEquipesPage() {
  const [saisonId, setSaisonId] = useState<string | null>(null); // null = défaut (saison active)
  const [equipeId, setEquipeId] = useState<string | null>(null); // null = "Toutes les équipes"
  const [upcomingTab, setUpcomingTab] = useState<'upcoming' | 'past'>('upcoming');
  const [openSheet, setOpenSheet] = useState<'saison' | 'equipe' | null>(null);

  // 1) Saisons (rare, cache long)
  const { data: saisons } = useQuery({
    queryKey: ['team-saisons'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('team_saisons')
        .select('*')
        .order('created_at', { ascending: false });
      if (error) throw error;
      return data as TeamSaison[];
    },
    staleTime: 5 * 60_000,
  });
  const activeSaison = saisons?.find((s) => s.actif) ?? saisons?.[0];
  const currentSaisonId = saisonId ?? activeSaison?.id ?? null;

  // 2) Compétitions + équipes de la saison sélectionnée
  const { data: equipesCtx } = useQuery({
    queryKey: ['team-equipes', currentSaisonId],
    enabled: !!currentSaisonId,
    queryFn: async () => {
      const { data: comps, error: e1 } = await supabase
        .from('team_competitions')
        .select('*')
        .eq('saison_id', currentSaisonId);
      if (e1) throw e1;
      const { data: eqs, error: e2 } = await supabase
        .from('team_equipes')
        .select('*')
        .in('competition_id', (comps as TeamCompetition[]).map((c) => c.id));
      if (e2) throw e2;
      return {
        competitions: comps as TeamCompetition[],
        equipes: eqs as TeamEquipe[],
      };
    },
    staleTime: 60_000,
  });

  // 3) Rencontres de la saison + équipe sélectionnée
  const {
    data: rencontres,
    isFetching,
    refetch,
  } = useQuery({
    queryKey: ['team-rencontres', currentSaisonId, equipeId],
    enabled: !!currentSaisonId && !!equipesCtx,
    queryFn: async (): Promise<EnrichedRencontre[]> => {
      const equipeIds = equipeId ? [equipeId] : equipesCtx!.equipes.map((e) => e.id);
      if (equipeIds.length === 0) return [];
      const { data: etapes, error: e1 } = await supabase
        .from('team_etapes')
        .select('*')
        .in('equipe_id', equipeIds);
      if (e1) throw e1;
      if ((etapes as TeamEtape[]).length === 0) return [];
      const { data: rencs, error: e2 } = await supabase
        .from('team_rencontres')
        .select('*')
        .in('etape_id', (etapes as TeamEtape[]).map((et) => et.id))
        .order('date_heure', { ascending: true });
      if (e2) throw e2;
      return (rencs as TeamRencontre[]).map((r) => {
        const etape = (etapes as TeamEtape[]).find((et) => et.id === r.etape_id)!;
        const equipe = equipesCtx!.equipes.find((eq) => eq.id === etape.equipe_id)!;
        const comp = equipesCtx!.competitions.find((c) => c.id === equipe.competition_id)!;
        return { rencontre: r, etape, equipe, comp };
      });
    },
  });

  // Filtrage à venir / passés (côté client)
  const { upcoming, past } = useMemo(() => {
    const now = new Date();
    const all = rencontres ?? [];
    const upcoming = all.filter((x) => new Date(x.rencontre.date_heure) >= now);
    const past = all
      .filter((x) => new Date(x.rencontre.date_heure) < now)
      .sort(
        (a, b) =>
          +new Date(b.rencontre.date_heure) - +new Date(a.rencontre.date_heure),
      );
    return { upcoming, past };
  }, [rencontres]);

  // Libellés chips
  const currentSaison = saisons?.find((s) => s.id === currentSaisonId);
  const saisonLabel = currentSaison?.label ?? '—';
  const selectedEquipe = equipeId ? equipesCtx?.equipes.find((e) => e.id === equipeId) : undefined;
  const selectedComp = selectedEquipe
    ? equipesCtx?.competitions.find((c) => c.id === selectedEquipe.competition_id)
    : undefined;
  const equipeLabel = selectedEquipe && selectedComp
    ? `${competitionShortLabel(selectedComp)} #${selectedEquipe.numero}`
    : 'Toutes';

  // Options du bottom sheet
  const sheetOptions: SheetOption[] = useMemo(() => {
    if (openSheet === 'saison') {
      return (saisons ?? []).map((s) => ({ id: s.id, label: s.label }));
    }
    if (openSheet === 'equipe' && equipesCtx) {
      const opts: SheetOption[] = [{ id: null, label: 'Toutes les équipes' }];
      for (const e of equipesCtx.equipes) {
        const c = equipesCtx.competitions.find((comp) => comp.id === e.competition_id);
        if (!c) continue;
        opts.push({
          id: e.id,
          label: `${c.nom} · ${competitionShortLabel(c)} · Équipe ${e.numero}`,
        });
      }
      return opts;
    }
    return [];
  }, [openSheet, saisons, equipesCtx]);

  const items = upcomingTab === 'upcoming' ? upcoming : past;

  if (saisons && saisons.length === 0) {
    return <div className="p-6 text-center text-muted-foreground">Aucune saison disponible.</div>;
  }

  return (
    <>
      <PullToRefreshWrapper onRefresh={async () => void (await refetch())} isRefreshing={isFetching}>
        <MatchEquipeFilterBar
          saisonLabel={saisonLabel}
          equipeLabel={equipeLabel}
          equipeActive={equipeId !== null}
          onOpenSaison={() => setOpenSheet('saison')}
          onOpenEquipe={() => setOpenSheet('equipe')}
          upcomingTab={upcomingTab}
          onUpcomingTabChange={setUpcomingTab}
          upcomingCount={upcoming.length}
          pastCount={past.length}
        />
        <MatchEquipeList items={items} state={upcomingTab} />
      </PullToRefreshWrapper>

      {openSheet && (
        <MatchEquipeFilterSheet
          title={openSheet === 'saison' ? 'Saison' : 'Équipe'}
          options={sheetOptions}
          selectedId={openSheet === 'saison' ? currentSaisonId : equipeId}
          onSelect={(id) => {
            if (openSheet === 'saison') {
              setSaisonId(id);
              setEquipeId(null); // reset équipe quand on change de saison
            } else {
              setEquipeId(id);
            }
          }}
          onClose={() => setOpenSheet(null)}
        />
      )}
    </>
  );
}
