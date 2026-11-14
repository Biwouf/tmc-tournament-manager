import { useEffect, useMemo, useRef, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { keepPreviousData, useQuery, useQueryClient } from '@tanstack/react-query';
import { supabase } from '../lib/supabase';
import { useClub } from '../contexts/ClubContext';
import { clubTopic } from '../lib/liveChannel';
import { LIVE_SAFETY_POLL, useLiveTopic } from '../hooks/useLiveTopic';
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
  MatchEquipeListSkeleton,
  type EnrichedRencontre,
} from '../components/matchesEquipes/MatchEquipeList';
import { competitionLabel, competitionShortLabel } from '../components/matchesEquipes/labels';
import CalendarExport from '../components/matchesEquipes/CalendarExport';
import { useAuth } from '../hooks/useAuth';
import '../components/matchesEquipes/matchesEquipes.css';

export default function MatchesEquipesPage() {
  const { clubId } = useClub();
  const { user } = useAuth();
  // Filtres dans l'URL : le Retour depuis une fiche rencontre les retrouve.
  const [params, setParams] = useSearchParams();
  const saisonId = params.get('saison'); // null = défaut (saison active)
  const equipeId = params.get('equipe'); // null = "Toutes les équipes"
  const upcomingTab: 'upcoming' | 'past' = params.get('periode') === 'passes' ? 'past' : 'upcoming';
  const setFilters = (next: { saison?: string | null; equipe?: string | null; periode?: 'upcoming' | 'past' }) =>
    setParams((prev) => {
      const p = new URLSearchParams(prev);
      const put = (k: string, v: string | null) => (v ? p.set(k, v) : p.delete(k));
      if (next.saison !== undefined) put('saison', next.saison);
      if (next.equipe !== undefined) put('equipe', next.equipe);
      if (next.periode !== undefined) put('periode', next.periode === 'past' ? 'passes' : null);
      return p;
    }, { replace: true });
  const [openSheet, setOpenSheet] = useState<'saison' | 'equipe' | null>(null);

  // 1) Saisons (rare, cache long)
  const saisonsQuery = useQuery({
    queryKey: ['team-saisons', clubId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('team_saisons')
        .select('*')
        .eq('club_id', clubId)
        .order('created_at', { ascending: false });
      if (error) throw error;
      return data as TeamSaison[];
    },
    staleTime: 5 * 60_000,
  });
  const saisons = saisonsQuery.data;
  const activeSaison = saisons?.find((s) => s.actif) ?? saisons?.[0];
  const currentSaisonId = saisonId ?? activeSaison?.id ?? null;

  // 2) Compétitions + équipes de la saison sélectionnée
  const equipesQuery = useQuery({
    queryKey: ['team-equipes', currentSaisonId, clubId],
    enabled: !!currentSaisonId,
    queryFn: async () => {
      const { data: comps, error: e1 } = await supabase
        .from('team_competitions')
        .select('*')
        .eq('club_id', clubId)
        .eq('saison_id', currentSaisonId);
      if (e1) throw e1;
      if (!comps?.length) return { competitions: [], equipes: [] };
      const { data: eqs, error: e2 } = await supabase
        .from('team_equipes')
        .select('*')
        .eq('club_id', clubId)
        .in('competition_id', (comps as TeamCompetition[]).map((c) => c.id));
      if (e2) throw e2;
      return {
        competitions: comps as TeamCompetition[],
        equipes: eqs as TeamEquipe[],
      };
    },
    staleTime: 60_000,
  });
  const equipesCtx = equipesQuery.data;

  // Broadcast `live:club:<id>` : une rencontre ou un match d'équipe a changé ('team'), ou un live
  // lié vient de démarrer ou de s'arrêter ('live' dont le statut ne correspond plus à l'affichage).
  const queryClient = useQueryClient();
  const pending = useRef<ReturnType<typeof setTimeout>>(undefined);
  const rencontresRef = useRef<EnrichedRencontre[] | undefined>(undefined);
  const subscribed = useLiveTopic(clubId ? clubTopic(clubId) : null, ({ event, payload }) => {
    if (event === 'live') {
      const shown = rencontresRef.current?.find((x) => x.rencontre.id === payload.team_rencontre_id);
      if (!shown || shown.isLive === (payload.status === 'live')) return;
    } else if (event !== 'team' && event !== 'subscribed') return;
    if (pending.current) return;
    pending.current = setTimeout(() => {
      pending.current = undefined;
      void queryClient.invalidateQueries({ queryKey: ['team-rencontres'] });
    }, 250);
  });
  // 3) Rencontres de la saison + équipe sélectionnée
  const rencontresQuery = useQuery({
    queryKey: ['team-rencontres', currentSaisonId, equipeId, clubId],
    staleTime: 0,
    refetchInterval: subscribed ? LIVE_SAFETY_POLL : 15_000,
    // Changer d'équipe garde la liste affichée jusqu'à l'arrivée de la nouvelle.
    placeholderData: keepPreviousData,
    enabled: !!currentSaisonId && !!equipesCtx,
    queryFn: async (): Promise<EnrichedRencontre[]> => {
      const equipeIds = equipeId ? [equipeId] : equipesCtx!.equipes.map((e) => e.id);
      if (equipeIds.length === 0) return [];
      const { data: etapes, error: e1 } = await supabase
        .from('team_etapes')
        .select('*')
        .eq('club_id', clubId)
        .in('equipe_id', equipeIds);
      if (e1) throw e1;
      if ((etapes as TeamEtape[]).length === 0) return [];
      const { data: rencs, error: e2 } = await supabase
        .from('team_rencontres')
        .select('*')
        .eq('club_id', clubId)
        .in('etape_id', (etapes as TeamEtape[]).map((et) => et.id))
        .order('date_heure', { ascending: true });
      if (e2) throw e2;
      if (!rencs?.length) return [];
      const { data: activeLives, error: liveError } = await supabase
        .from('live_matches')
        .select('team_rencontre_id')
        .eq('club_id', clubId)
        .eq('status', 'live')
        .in('team_rencontre_id', (rencs as TeamRencontre[]).map(r => r.id));
      if (liveError) throw liveError;
      const liveEncounterIds = new Set((activeLives ?? []).map(m => m.team_rencontre_id));
      return (rencs as TeamRencontre[]).map((r) => {
        const etape = (etapes as TeamEtape[]).find((et) => et.id === r.etape_id)!;
        const equipe = equipesCtx!.equipes.find((eq) => eq.id === etape.equipe_id)!;
        const comp = equipesCtx!.competitions.find((c) => c.id === equipe.competition_id)!;
        return { rencontre: r, etape, equipe, comp, isLive: !r.wo && liveEncounterIds.has(r.id) };
      });
    },
  });

  const { data: rencontres, isFetching, dataUpdatedAt, refetch } = rencontresQuery;
  useEffect(() => {
    rencontresRef.current = rencontres;
  }, [rencontres]);

  // Filtrage à venir / passés (côté client) : une rencontre commencée reste « à venir »
  // (en attente) jusqu'à confirmation du résultat ou WO, au plus tard jusqu'à minuit. Un live
  // ne compte que le jour de la rencontre : un live jamais clos ne la retient pas indéfiniment
  // dans « À venir » (même fenêtre que l'export du calendrier).
  const [mountedAt] = useState(Date.now);
  const { upcoming, past } = useMemo(() => {
    // Re-evaluate dates on every refresh, even when the server rows are unchanged.
    // Pendant le chargement d'une autre équipe, keepPreviousData expose dataUpdatedAt = 0 :
    // sans repli, 1970 ferait passer les rencontres jouées dans « À venir ».
    const now = new Date(dataUpdatedAt || mountedAt);
    const all = (rencontres ?? []).map((x) => {
      const start = new Date(x.rencontre.date_heure);
      const endOfDay = new Date(start);
      endOfDay.setHours(24, 0, 0, 0);
      const done = x.rencontre.wo || !!x.rencontre.confirmed_at || now >= endOfDay;
      const isLive = x.isLive && now < endOfDay;
      return { ...x, isLive, isPast: !isLive && done, isPending: !isLive && !done && start < now };
    });
    // Tri et regroupement par jour / compétition : MatchEquipeList.
    return { upcoming: all.filter((x) => !x.isPast), past: all.filter((x) => x.isPast) };
  }, [rencontres, dataUpdatedAt, mountedAt]);

  // Libellés chips
  const currentSaison = saisons?.find((s) => s.id === currentSaisonId);
  const saisonLabel = currentSaison?.label ?? '—';
  const selectedEquipe = equipeId ? equipesCtx?.equipes.find((e) => e.id === equipeId) : undefined;
  const selectedComp = selectedEquipe
    ? equipesCtx?.competitions.find((c) => c.id === selectedEquipe.competition_id)
    : undefined;
  const equipeLabel = selectedEquipe && selectedComp
    ? `${competitionShortLabel(selectedComp)} · Éq. ${selectedEquipe.numero}`
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
          label: `${competitionLabel(c)} · Équipe ${e.numero}`,
        });
      }
      return opts;
    }
    return [];
  }, [openSheet, saisons, equipesCtx]);

  const items = upcomingTab === 'upcoming' ? upcoming : past;

  // Première requête en échec sans donnée à montrer : écran d'erreur. Une actualisation qui
  // échoue sur une liste déjà affichée ne laisse qu'un bandeau discret.
  const failed = [saisonsQuery, equipesQuery, rencontresQuery].find((q) => q.isError && !q.data);
  const loading = !failed && (saisonsQuery.isPending || (!!currentSaisonId && (equipesQuery.isPending || rencontresQuery.isPending)));
  const retry = () => {
    for (const q of [saisonsQuery, equipesQuery, rencontresQuery]) if (q.isError) void q.refetch();
  };

  if (saisons && saisons.length === 0) {
    return <div className="me-page"><p className="me-empty">Aucune saison disponible.</p></div>;
  }

  return (
    <div className="me-page">
      {user && equipesCtx && currentSaison && (
        <CalendarExport
          saisonLabel={currentSaison.label}
          scopeLabel={`Saison ${currentSaison.label} · ${equipeId ? equipeLabel : 'Toutes les équipes'}`}
          competitions={equipesCtx.competitions}
          equipes={equipeId ? equipesCtx.equipes.filter((e) => e.id === equipeId) : equipesCtx.equipes}
        />
      )}
      <PullToRefreshWrapper onRefresh={async () => void (await refetch())} isRefreshing={isFetching && !loading}>
        <MatchEquipeFilterBar
          saisonLabel={saisonLabel}
          equipeLabel={equipeLabel}
          onOpenSaison={() => setOpenSheet('saison')}
          onOpenEquipe={() => setOpenSheet('equipe')}
          upcomingTab={upcomingTab}
          onUpcomingTabChange={(periode) => setFilters({ periode })}
          upcomingCount={rencontres ? upcoming.length : undefined}
          pastCount={rencontres ? past.length : undefined}
        />
        {failed ? (
          <div className="me-error" role="alert">
            <div className="icon" aria-hidden="true">
              <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round"><circle cx="12" cy="12" r="9" /><path d="M12 8v5M12 16h.01" /></svg>
            </div>
            <h2>Impossible de charger les rencontres</h2>
            <p>Vérifiez votre connexion, puis réessayez.</p>
            <button type="button" onClick={retry}>Réessayer</button>
          </div>
        ) : loading ? (
          <MatchEquipeListSkeleton />
        ) : (
          <>
            {rencontresQuery.isError && (
              <p className="me-stale" role="status">
                Actualisation impossible, la liste n’est peut-être plus à jour.{' '}
                <button type="button" onClick={() => void refetch()}>Réessayer</button>
              </p>
            )}
            <MatchEquipeList items={items} state={upcomingTab} />
          </>
        )}
      </PullToRefreshWrapper>

      {openSheet && (
        <MatchEquipeFilterSheet
          title={openSheet === 'saison' ? 'Saison' : 'Équipe'}
          options={sheetOptions}
          selectedId={openSheet === 'saison' ? currentSaisonId : equipeId}
          onSelect={(id) => {
            if (openSheet === 'saison') {
              setFilters({ saison: id, equipe: null }); // reset équipe quand on change de saison
            } else {
              setFilters({ equipe: id });
            }
          }}
          onClose={() => setOpenSheet(null)}
        />
      )}
    </div>
  );
}
