import { useEffect } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { supabase } from '../lib/supabase';
import type { LiveMatch } from '../types';
import MatchCard from '../components/matches/MatchCard';

async function fetchMatches(): Promise<LiveMatch[]> {
  const today = new Date().toISOString().split('T')[0]; // "YYYY-MM-DD"

  const { data, error } = await supabase
    .from('live_matches')
    .select('*')
    .gte('match_date', today)
    .order('match_date', { ascending: true })
    .order('start_time', { ascending: true, nullsFirst: false });

  if (error) throw error;

  // Exclure les matchs finished dont la date est passée (avant aujourd'hui)
  return (data as LiveMatch[]).filter((m) => {
    if (m.status === 'finished' && m.match_date < today) return false;
    return true;
  });
}

export default function MatchesPage() {
  const queryClient = useQueryClient();

  const { data: matches, isLoading, isError } = useQuery({
    queryKey: ['matches'],
    queryFn: fetchMatches,
    refetchInterval: 30_000, // Fallback : rafraîchissement toutes les 30s
  });

  // Abonnement Supabase Realtime → invalide le cache à chaque changement
  useEffect(() => {
    const channel = supabase
      .channel('live_matches_pwa')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'live_matches' }, () => {
        queryClient.invalidateQueries({ queryKey: ['matches'] });
      })
      .subscribe();

    return () => { supabase.removeChannel(channel); };
  }, [queryClient]);

  if (isError) {
    return <div className="p-6 text-center text-muted-foreground">Impossible de charger les matchs.</div>;
  }

  const liveMatches    = matches?.filter((m) => m.status === 'live')     ?? [];
  const pendingMatches = matches?.filter((m) => m.status === 'pending')  ?? [];
  const finishedMatches = matches?.filter((m) => m.status === 'finished') ?? [];

  return (
    <div className="p-4 flex flex-col gap-6">
      <h1 className="text-xl font-bold text-foreground">Matches</h1>

      {isLoading && (
        <div className="flex flex-col gap-4">
          {[...Array(3)].map((_, i) => (
            <div key={i} className="bg-muted rounded-xl h-28 animate-pulse" />
          ))}
        </div>
      )}

      {!isLoading && matches?.length === 0 && (
        <p className="text-center text-muted-foreground py-8">Aucun match prévu aujourd'hui.</p>
      )}

      {liveMatches.length > 0 && (
        <section className="flex flex-col gap-3">
          <h2 className="text-sm font-semibold text-primary uppercase tracking-wide">En cours</h2>
          {liveMatches.map((m) => <MatchCard key={m.id} match={m} />)}
        </section>
      )}

      {pendingMatches.length > 0 && (
        <section className="flex flex-col gap-3">
          <h2 className="text-sm font-semibold text-muted-foreground uppercase tracking-wide">À venir</h2>
          {pendingMatches.map((m) => <MatchCard key={m.id} match={m} />)}
        </section>
      )}

      {finishedMatches.length > 0 && (
        <section className="flex flex-col gap-3">
          <h2 className="text-sm font-semibold text-muted-foreground uppercase tracking-wide">Terminés</h2>
          {finishedMatches.map((m) => <MatchCard key={m.id} match={m} />)}
        </section>
      )}
    </div>
  );
}
