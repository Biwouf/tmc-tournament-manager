import { useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { supabase } from '../lib/supabase';
import type { LiveMatch, LiveMatchWinner } from '../types';
import { getMatchWinner, getTeamLabel } from '../liveScoreRules';
import LiveScoreEntry from '../components/LiveScoreEntry';

function formatDate(iso: string): string {
  return new Date(iso + 'T00:00:00').toLocaleDateString('fr-FR', {
    weekday: 'long',
    day: '2-digit',
    month: 'long',
    year: 'numeric',
  });
}

function teamLabel(m: LiveMatch, team: 1 | 2): string {
  const parts: string[] = [];
  if (team === 1) {
    let label = `${m.j1_prenom} ${m.j1_nom}`;
    if (m.j1_classement) label += ` (${m.j1_classement})`;
    if (m.j1_club) label += ` · ${m.j1_club}`;
    parts.push(label);
    if (m.match_type === 'double' && m.j3_prenom && m.j3_nom) {
      let p = `${m.j3_prenom} ${m.j3_nom}`;
      if (m.j3_classement) p += ` (${m.j3_classement})`;
      if (m.j3_club) p += ` · ${m.j3_club}`;
      parts.push(p);
    }
  } else {
    let label = `${m.j2_prenom} ${m.j2_nom}`;
    if (m.j2_classement) label += ` (${m.j2_classement})`;
    if (m.j2_club) label += ` · ${m.j2_club}`;
    parts.push(label);
    if (m.match_type === 'double' && m.j4_prenom && m.j4_nom) {
      let p = `${m.j4_prenom} ${m.j4_nom}`;
      if (m.j4_classement) p += ` (${m.j4_classement})`;
      if (m.j4_club) p += ` · ${m.j4_club}`;
      parts.push(p);
    }
  }
  return parts.join(' / ');
}

export default function LiveMatchPage() {
  const { id } = useParams();
  const [match, setMatch] = useState<LiveMatch | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [savingError, setSavingError] = useState<string | null>(null);
  const [currentUserId, setCurrentUserId] = useState<string | null>(null);
  const [showRetireConfirm, setShowRetireConfirm] = useState(false);

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => {
      setCurrentUserId(data.session?.user.id ?? null);
    });
  }, []);

  useEffect(() => {
    if (!id) return;
    supabase
      .from('live_matches')
      .select('*')
      .eq('id', id)
      .single()
      .then(({ data, error }) => {
        if (error || !data) {
          setError(error?.message ?? 'Match introuvable');
          setLoading(false);
          return;
        }
        setMatch(data as LiveMatch);
        setLoading(false);
      });

    const channel = supabase
      .channel(`live_match_bo_${id}`)
      .on(
        'postgres_changes',
        { event: 'UPDATE', schema: 'public', table: 'live_matches', filter: `id=eq.${id}` },
        (payload) => {
          setMatch(payload.new as LiveMatch);
        },
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [id]);

  const applyPatch = async (patch: Partial<LiveMatch>) => {
    if (!match) return;
    // Compute the post-patch match locally, then derive winner
    const merged: LiveMatch = { ...match, ...patch };
    const winner = getMatchWinner(merged);

    let finalPatch: Partial<LiveMatch> = patch;
    if (winner && match.status === 'live') {
      finalPatch = {
        ...patch,
        status: 'finished',
        winner,
        finished_at: new Date().toISOString(),
      };
    }

    // Optimistic local update
    setMatch({ ...match, ...finalPatch });

    const { error } = await supabase.from('live_matches').update(finalPatch).eq('id', match.id);
    if (error) {
      setSavingError(error.message);
      // Revert local state to server truth
      const { data } = await supabase.from('live_matches').select('*').eq('id', match.id).single();
      if (data) setMatch(data as LiveMatch);
    } else {
      setSavingError(null);
    }
  };

  const handleCancelFinish = async () => {
    if (!match) return;
    const patch: Partial<LiveMatch> = {
      status: 'live',
      winner: null,
      finished_at: null,
      retired_player: null,
    };
    setMatch({ ...match, ...patch });
    const { error } = await supabase.from('live_matches').update(patch).eq('id', match.id);
    if (error) setSavingError(error.message);
    else setSavingError(null);
  };

  const handleRetire = async (retiredPlayer: LiveMatchWinner) => {
    if (!match) return;
    const winner: LiveMatchWinner = retiredPlayer === 'j1' ? 'j2' : 'j1';
    const patch: Partial<LiveMatch> = {
      status: 'finished',
      winner,
      retired_player: retiredPlayer,
      finished_at: new Date().toISOString(),
    };
    setMatch({ ...match, ...patch });
    const { error } = await supabase.from('live_matches').update(patch).eq('id', match.id);
    if (error) setSavingError(error.message);
    else setSavingError(null);
  };

  const handleLogout = () => supabase.auth.signOut();

  if (loading) {
    return <div className="min-h-screen flex items-center justify-center text-muted-foreground">Chargement...</div>;
  }

  if (error || !match) {
    return (
      <div className="min-h-screen flex flex-col items-center justify-center gap-4">
        <p className="text-red-600">{error ?? 'Match introuvable'}</p>
        <Link to="/live-score" className="text-sm text-muted-foreground hover:underline">
          ← Retour à la liste
        </Link>
      </div>
    );
  }

  const statusStyles: Record<LiveMatch['status'], string> = {
    pending: 'bg-slate-100 text-slate-700',
    live: 'bg-red-100 text-red-700',
    finished: 'bg-emerald-100 text-emerald-700',
  };
  const statusLabels: Record<LiveMatch['status'], string> = {
    pending: 'En attente',
    live: 'LIVE',
    finished: 'Terminé',
  };

  return (
    <div className="min-h-screen">
      <header className="border-b border-border/70 bg-card/85 text-card-foreground shadow-sm backdrop-blur">
        <div className="container mx-auto flex items-start justify-between px-4 py-8">
          <div>
            <h1 className="text-2xl font-semibold tracking-tight">Match en direct</h1>
            <Link to="/live-score" className="mt-2 inline-block text-sm text-muted-foreground hover:underline">
              ← Retour à la liste
            </Link>
          </div>
          <button
            onClick={handleLogout}
            className="mt-1 rounded-lg border border-border bg-card px-4 py-2 text-sm font-medium text-muted-foreground transition hover:bg-muted"
          >
            Se déconnecter
          </button>
        </div>
      </header>

      <main className="container mx-auto max-w-3xl px-4 py-8">
        {/* Résumé du match */}
        <div className="mb-6 rounded-2xl border bg-card/90 p-6 shadow-sm">
          <div className="mb-3 flex items-center gap-2">
            <span className={`rounded-full px-2.5 py-0.5 text-xs font-medium ${statusStyles[match.status]}`}>
              {statusLabels[match.status]}
            </span>
            <span className="text-xs font-medium text-muted-foreground">
              {match.match_type === 'double' ? 'Double' : 'Simple'}
            </span>
          </div>
          <div className="space-y-2 text-sm">
            <div className={`font-medium ${match.winner === 'j1' ? 'text-emerald-700' : 'text-card-foreground'}`}>
              {match.match_type === 'double' ? 'Équipe 1 : ' : ''}
              {teamLabel(match, 1)}
            </div>
            <div className={`font-medium ${match.winner === 'j2' ? 'text-emerald-700' : 'text-card-foreground'}`}>
              {match.match_type === 'double' ? 'Équipe 2 : ' : ''}
              {teamLabel(match, 2)}
            </div>
          </div>
          <p className="mt-3 text-xs text-muted-foreground">
            {formatDate(match.match_date)}
            {match.start_time && ` — ${match.start_time.slice(0, 5)}`}
          </p>
        </div>

        {match.status === 'finished' && match.winner && (
          <div className="mb-6 rounded-xl border border-emerald-200 bg-emerald-50 p-4">
            <p className="text-sm font-medium text-emerald-900">
              Match terminé — vainqueur : {getTeamLabel(match, match.winner === 'j1' ? 1 : 2)}.
            </p>
            <button
              onClick={handleCancelFinish}
              className="mt-3 rounded-lg border border-emerald-300 bg-white px-3 py-1.5 text-sm font-medium text-emerald-800 transition hover:bg-emerald-100"
            >
              Annuler la fin de match
            </button>
          </div>
        )}

        {match.status === 'pending' && (
          <div className="mb-6 rounded-xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-900">
            Ce match n'est pas encore démarré. Retourne à la liste et clique sur "Démarrer le live".
          </div>
        )}

        {(() => {
          const hasLostControl =
            match.status === 'live' &&
            currentUserId !== null &&
            match.scored_by !== null &&
            match.scored_by !== currentUserId;
          const canRetire = match.status === 'live' && !hasLostControl;
          return (
            <>
              {hasLostControl && (
                <div className="mb-6 rounded-xl border border-red-200 bg-red-50 p-4 text-sm text-red-800">
                  ⚠️ Ce live a été repris par quelqu'un d'autre. Vous êtes en lecture seule.
                </div>
              )}
              <LiveScoreEntry match={match} onPatch={applyPatch} forceDisabled={hasLostControl} />
              {canRetire && (
                <div className="mt-4">
                  {!showRetireConfirm ? (
                    <button
                      onClick={() => setShowRetireConfirm(true)}
                      className="rounded-lg border border-amber-300 bg-amber-50 px-3 py-1.5 text-sm font-medium text-amber-800 transition hover:bg-amber-100"
                    >
                      Abandon d'un joueur
                    </button>
                  ) : (
                    <div className="rounded-xl border border-amber-200 bg-amber-50 p-4">
                      <p className="text-sm font-medium text-amber-900">Quel joueur abandonne ?</p>
                      <div className="mt-3 flex flex-wrap gap-2">
                        <button
                          onClick={() => {
                            handleRetire('j1');
                            setShowRetireConfirm(false);
                          }}
                          className="rounded-lg border border-amber-300 bg-white px-3 py-1.5 text-sm font-medium text-amber-800 transition hover:bg-amber-100"
                        >
                          {getTeamLabel(match, 1)} abandonne
                        </button>
                        <button
                          onClick={() => {
                            handleRetire('j2');
                            setShowRetireConfirm(false);
                          }}
                          className="rounded-lg border border-amber-300 bg-white px-3 py-1.5 text-sm font-medium text-amber-800 transition hover:bg-amber-100"
                        >
                          {getTeamLabel(match, 2)} abandonne
                        </button>
                        <button
                          onClick={() => setShowRetireConfirm(false)}
                          className="rounded-lg border border-border bg-card px-3 py-1.5 text-sm font-medium text-muted-foreground transition hover:bg-muted"
                        >
                          Annuler
                        </button>
                      </div>
                    </div>
                  )}
                </div>
              )}
            </>
          );
        })()}

        {savingError && (
          <div className="mt-4 rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
            Erreur de sauvegarde : {savingError}
          </div>
        )}
      </main>
    </div>
  );
}
