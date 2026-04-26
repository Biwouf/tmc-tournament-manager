import { useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { supabase } from '../lib/supabase';
import type { LiveMatch } from '../types';
import LiveMatchCard from '../components/LiveMatchCard';

export default function LiveScorePage() {
  const navigate = useNavigate();
  const [matches, setMatches] = useState<LiveMatch[]>([]);
  const [loading, setLoading] = useState(true);
  const [reloadKey, setReloadKey] = useState(0);

  useEffect(() => {
    let cancelled = false;
    supabase
      .from('live_matches')
      .select('*')
      .order('match_date', { ascending: true })
      .order('start_time', { ascending: true, nullsFirst: true })
      .then(({ data, error }) => {
        if (cancelled) return;
        if (!error && data) setMatches(data as LiveMatch[]);
        else if (error) console.error(error);
        setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [reloadKey]);

  const reload = () => setReloadKey((k) => k + 1);

  const handleStart = async (m: LiveMatch) => {
    const { data: sessionData } = await supabase.auth.getSession();
    const uid = sessionData.session?.user.id ?? null;
    const { error } = await supabase
      .from('live_matches')
      .update({ status: 'live', scored_by: uid })
      .eq('id', m.id);
    if (error) {
      alert(`Erreur : ${error.message}`);
      return;
    }
    navigate(`/live-score/${m.id}`);
  };

  const handlePrimary = (m: LiveMatch) => {
    if (m.status === 'pending') handleStart(m);
    else navigate(`/live-score/${m.id}`);
  };

  const handleDelete = async (m: LiveMatch) => {
    const team1 = `${m.j1_prenom} ${m.j1_nom}`;
    const team2 = `${m.j2_prenom} ${m.j2_nom}`;
    if (!window.confirm(`Supprimer le match ${team1} vs ${team2} ?`)) return;
    const { error } = await supabase.from('live_matches').delete().eq('id', m.id);
    if (error) {
      alert(`Erreur suppression : ${error.message}`);
      return;
    }
    reload();
  };

  const handleLogout = () => supabase.auth.signOut();

  const live = matches.filter((m) => m.status === 'live');
  const pending = matches.filter((m) => m.status === 'pending');
  const finished = matches.filter((m) => m.status === 'finished');

  const renderSection = (title: string, list: LiveMatch[], emptyText: string) => (
    <section className="mb-10">
      <h2 className="mb-4 text-xl font-semibold tracking-tight">{title}</h2>
      {list.length === 0 ? (
        <div className="rounded-2xl border border-dashed border-border bg-card/50 p-8 text-center text-sm text-muted-foreground">
          {emptyText}
        </div>
      ) : (
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-3">
          {list.map((m) => (
            <LiveMatchCard
              key={m.id}
              match={m}
              onPrimary={() => handlePrimary(m)}
              onDelete={() => handleDelete(m)}
            />
          ))}
        </div>
      )}
    </section>
  );

  return (
    <div className="min-h-screen">
      <header className="border-b border-border/70 bg-card/85 text-card-foreground shadow-sm backdrop-blur">
        <div className="container mx-auto flex items-start justify-between px-4 py-8">
          <div>
            <h1 className="text-3xl font-semibold tracking-tight">Live Score</h1>
            <p className="mt-2 text-muted-foreground">Suivre et saisir le score des matchs en direct.</p>
          </div>
          <button
            onClick={handleLogout}
            className="mt-1 rounded-lg border border-border bg-card px-4 py-2 text-sm font-medium text-muted-foreground transition hover:bg-muted"
          >
            Se déconnecter
          </button>
        </div>
      </header>

      <main className="container mx-auto px-4 py-8">
        <div className="mb-6 flex justify-end">
          <Link
            to="/live-score/new"
            className="rounded-lg bg-primary px-5 py-2.5 text-sm font-medium text-primary-foreground shadow-sm transition hover:brightness-95"
          >
            Créer un match
          </Link>
        </div>

        {loading ? (
          <div className="py-12 text-center text-muted-foreground">Chargement...</div>
        ) : (
          <>
            {renderSection('En live', live, 'Aucun match en cours.')}
            {renderSection('En attente', pending, 'Aucun match en attente.')}
            {renderSection('Terminés', finished, 'Aucun match terminé.')}
          </>
        )}
      </main>
    </div>
  );
}
