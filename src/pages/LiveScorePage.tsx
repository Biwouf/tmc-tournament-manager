import { useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { supabase } from '../lib/supabase';
import type { LiveMatch } from '../types';
import LiveMatchCard from '../components/LiveMatchCard';

export default function LiveScorePage() {
  const navigate = useNavigate();
  const [matches, setMatches] = useState<LiveMatch[]>([]);
  const [loading, setLoading] = useState(true);
  const [courtDialog, setCourtDialog] = useState<{ matchId: string; value: string } | null>(null);

  const fetchMatches = async () => {
    const { data, error } = await supabase
      .from('live_matches')
      .select('*')
      .order('match_date', { ascending: true })
      .order('start_time', { ascending: true, nullsFirst: true });
    if (error) console.error(error);
    else if (data) setMatches(data as LiveMatch[]);
    setLoading(false);
  };

  useEffect(() => {
    fetchMatches();

    const channel = supabase
      .channel('live_matches_bo')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'live_matches' }, () => {
        fetchMatches();
      })
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, []);

  const confirmStart = async () => {
    if (!courtDialog) return;
    const { matchId, value } = courtDialog;
    const { data: sessionData } = await supabase.auth.getSession();
    const uid = sessionData.session?.user.id ?? null;
    const { error } = await supabase
      .from('live_matches')
      .update({ status: 'live', scored_by: uid, court: value.trim() || null })
      .eq('id', matchId);
    if (error) {
      alert(`Erreur : ${error.message}`);
      return;
    }
    setCourtDialog(null);
    navigate(`/live-score/${matchId}`);
  };

  const handlePrimary = (m: LiveMatch) => {
    if (m.status === 'pending') setCourtDialog({ matchId: m.id, value: '' });
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
    fetchMatches();
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
            <Link
              to="/"
              className="mb-2 inline-flex items-center text-sm text-muted-foreground transition hover:text-foreground"
            >
              ← Accueil
            </Link>
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

      {courtDialog && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4"
          onClick={() => setCourtDialog(null)}
        >
          <div
            className="w-full max-w-sm rounded-2xl border bg-card p-6 shadow-lg"
            onClick={(e) => e.stopPropagation()}
          >
            <h3 className="text-lg font-semibold tracking-tight">Démarrer le live</h3>
            <label className="mt-4 block text-sm font-medium text-card-foreground">
              Court (optionnel)
              <input
                type="text"
                autoFocus
                value={courtDialog.value}
                onChange={(e) => setCourtDialog({ ...courtDialog, value: e.target.value })}
                onKeyDown={(e) => e.key === 'Enter' && confirmStart()}
                placeholder="ex: Court 1, Court central"
                className="mt-1.5 w-full rounded-lg border border-border bg-background px-3 py-2 text-sm font-normal text-foreground outline-none focus:border-primary"
              />
            </label>
            <div className="mt-6 flex justify-end gap-2">
              <button
                onClick={() => setCourtDialog(null)}
                className="rounded-lg border border-border bg-card px-4 py-2 text-sm font-medium text-muted-foreground transition hover:bg-muted"
              >
                Annuler
              </button>
              <button
                onClick={confirmStart}
                className="rounded-lg bg-primary px-4 py-2 text-sm font-medium text-primary-foreground shadow-sm transition hover:brightness-95"
              >
                Démarrer
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
