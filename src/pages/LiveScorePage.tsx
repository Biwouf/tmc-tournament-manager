import { useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { supabase } from '../lib/supabase';
import type { LiveMatch } from '../types';
import LiveMatchCard from '../components/LiveMatchCard';
import LivePulse from '../components/LivePulse';

type SectionAccent = 'live' | 'pending' | 'finished';

const SECTION_ACCENT: Record<SectionAccent, string> = {
  live: 'bg-red-100 text-red-700',
  pending: 'bg-slate-200 text-slate-700',
  finished: 'bg-emerald-100 text-emerald-700',
};

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

  const renderSection = (
    title: string,
    accent: SectionAccent,
    list: LiveMatch[],
    emptyText: string,
  ) => (
    <section className="mb-8">
      <div className="mb-4 flex items-center gap-3">
        <h2 className="text-base font-bold tracking-wide uppercase text-slate-900">{title}</h2>
        <span
          className={`inline-flex items-center justify-center min-w-6 h-6 px-1.5 rounded-md text-xs font-bold ${SECTION_ACCENT[accent]}`}
        >
          {list.length}
        </span>
        <div className="flex-1 h-px bg-slate-200" />
      </div>
      {list.length === 0 ? (
        <div className="rounded-2xl border border-dashed border-border bg-card/50 p-8 text-center text-sm text-muted-foreground">
          {emptyText}
        </div>
      ) : (
        <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
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
      <header className="bg-white border-b border-slate-200">
        <div className="px-8 py-5 flex items-center justify-between gap-4">
          <div className="flex items-center gap-4 min-w-0">
            <Link
              to="/"
              className="text-sm text-slate-500 hover:text-slate-800 transition"
            >
              ← Accueil
            </Link>
            <span className="text-slate-300">/</span>
            <h1 className="text-2xl font-bold tracking-tight">Live Score</h1>
            {live.length > 0 && (
              <span className="inline-flex items-center gap-1.5 ml-2 text-[11px] font-semibold uppercase tracking-wider text-red-600">
                <LivePulse />
                {live.length} en cours
              </span>
            )}
          </div>
          <div className="flex items-center gap-2 shrink-0">
            <Link
              to="/live-score/new"
              className="rounded-lg bg-primary text-primary-foreground px-4 py-2 text-sm font-semibold shadow-sm transition hover:brightness-95"
            >
              + Créer un match
            </Link>
            <button
              onClick={handleLogout}
              className="rounded-lg border border-slate-200 text-slate-600 text-sm px-3 py-2 hover:bg-slate-50 transition"
            >
              Se déconnecter
            </button>
          </div>
        </div>
      </header>

      <main className="px-8 py-8 max-w-[1400px] mx-auto">
        {loading ? (
          <div className="py-12 text-center text-muted-foreground">Chargement...</div>
        ) : (
          <>
            {renderSection('En live', 'live', live, 'Aucun match en cours.')}
            {renderSection('En attente', 'pending', pending, 'Aucun match en attente.')}
            {renderSection('Terminés', 'finished', finished, 'Aucun match terminé.')}
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
