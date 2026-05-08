import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { supabase } from '../lib/supabase';
import type { LiveMatch } from '../types';
import MatchCard from '../components/matches/MatchCard';
import { useAuth } from '../hooks/useAuth';
import { useHeaderAction } from '../components/layout/HeaderActionContext';

async function fetchMatches(): Promise<LiveMatch[]> {
  const today = new Date().toISOString().split('T')[0]; // "YYYY-MM-DD"

  const { data, error } = await supabase
    .from('live_matches')
    .select('*')
    .gte('match_date', today)
    .order('match_date', { ascending: true })
    .order('start_time', { ascending: true, nullsFirst: false });

  if (error) throw error;

  return (data as LiveMatch[]).filter((m) => {
    if (m.status === 'finished' && m.match_date < today) return false;
    return true;
  });
}

export default function MatchesPage() {
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const { user } = useAuth();
  const [flash, setFlash] = useState<string | null>(null);

  const { data: matches, isLoading, isError } = useQuery({
    queryKey: ['matches'],
    queryFn: fetchMatches,
    refetchInterval: 30_000,
  });

  useEffect(() => {
    const channel = supabase
      .channel('live_matches_pwa')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'live_matches' }, () => {
        queryClient.invalidateQueries({ queryKey: ['matches'] });
      })
      .subscribe();

    return () => { supabase.removeChannel(channel); };
  }, [queryClient]);

  // Lecture du flash venant d'une redirection (ex: /matches/:id/score → /matches)
  useEffect(() => {
    const stored = sessionStorage.getItem('matches:flash');
    if (stored) {
      setFlash(stored);
      sessionStorage.removeItem('matches:flash');
      const t = setTimeout(() => setFlash(null), 4000);
      return () => clearTimeout(t);
    }
  }, []);

  const handleLogout = async () => {
    await supabase.auth.signOut();
  };

  useHeaderAction({
    kind: 'text',
    label: user ? 'Déconnexion' : 'Connexion',
    onClick: () => {
      if (user) void handleLogout();
      else navigate('/login', { state: { from: '/matches' } });
    },
  });

  if (isError) {
    return <div className="p-6 text-center text-muted-foreground">Impossible de charger les matchs.</div>;
  }

  const liveMatches    = matches?.filter((m) => m.status === 'live')     ?? [];
  const pendingMatches = matches?.filter((m) => m.status === 'pending')  ?? [];
  const finishedMatches = matches?.filter((m) => m.status === 'finished') ?? [];

  return (
    <div className="p-4 flex flex-col gap-6">
      {flash && (
        <div className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-800">
          {flash}
        </div>
      )}

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
          {liveMatches.map((m) => <MatchCard key={m.id} match={m} userId={user?.id ?? null} />)}
        </section>
      )}

      {pendingMatches.length > 0 && (
        <section className="flex flex-col gap-3">
          <h2 className="text-sm font-semibold text-muted-foreground uppercase tracking-wide">À venir</h2>
          {pendingMatches.map((m) => <MatchCard key={m.id} match={m} userId={user?.id ?? null} />)}
        </section>
      )}

      {finishedMatches.length > 0 && (
        <section className="flex flex-col gap-3">
          <h2 className="text-sm font-semibold text-muted-foreground uppercase tracking-wide">Terminés</h2>
          {finishedMatches.map((m) => <MatchCard key={m.id} match={m} userId={user?.id ?? null} />)}
        </section>
      )}

      {user && (
        <button
          type="button"
          onClick={() => navigate('/matches/new')}
          className="fixed right-5 z-40 flex h-14 w-14 items-center justify-center rounded-full bg-primary text-primary-foreground shadow-lg transition hover:brightness-95 active:scale-95"
          style={{ bottom: 'calc(56px + 16px + env(safe-area-inset-bottom))' }}
          aria-label="Créer un match"
        >
          <svg
            xmlns="http://www.w3.org/2000/svg"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2.5"
            strokeLinecap="round"
            strokeLinejoin="round"
            className="h-6 w-6"
          >
            <path d="M12 5v14M5 12h14" />
          </svg>
        </button>
      )}
    </div>
  );
}
