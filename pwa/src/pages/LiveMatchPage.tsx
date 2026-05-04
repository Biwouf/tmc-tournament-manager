import { useEffect, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { supabase } from '../lib/supabase';
import type { LiveMatch } from '../types';
import { getMatchWinner, getTeamLabel } from '../liveScoreRules';
import LiveScoreEntry from '../components/matches/LiveScoreEntry';
import { useAuth } from '../hooks/useAuth';

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
  const main = (p: 'j1' | 'j2' | 'j3' | 'j4') => {
    let label = `${m[`${p}_prenom`]} ${m[`${p}_nom`]}`;
    const cls = m[`${p}_classement`];
    const club = m[`${p}_club`];
    if (cls) label += ` (${cls})`;
    if (club) label += ` · ${club}`;
    return label;
  };
  if (team === 1) {
    parts.push(main('j1'));
    if (m.match_type === 'double' && m.j3_prenom && m.j3_nom) parts.push(main('j3'));
  } else {
    parts.push(main('j2'));
    if (m.match_type === 'double' && m.j4_prenom && m.j4_nom) parts.push(main('j4'));
  }
  return parts.join(' / ');
}

function flashAndRedirect(navigate: ReturnType<typeof useNavigate>, msg: string) {
  sessionStorage.setItem('matches:flash', msg);
  navigate('/matches', { replace: true });
}

export default function LiveMatchPage() {
  const { id } = useParams();
  const navigate = useNavigate();
  const { user, loading: authLoading } = useAuth();

  const [match, setMatch] = useState<LiveMatch | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [savingError, setSavingError] = useState<string | null>(null);

  useEffect(() => {
    if (!id || authLoading) return;
    if (!user) return; // RequireAuth gère la redirection vers /login
    let cancelled = false;
    supabase
      .from('live_matches')
      .select('*')
      .eq('id', id)
      .single()
      .then(({ data, error }) => {
        if (cancelled) return;
        if (error || !data) {
          setError(error?.message ?? 'Match introuvable');
          setLoading(false);
          return;
        }
        const m = data as LiveMatch;

        // Guard d'accès :
        if (m.status === 'pending') {
          flashAndRedirect(navigate, "Ce match n'est pas en cours.");
          return;
        }
        if (m.status === 'live' && m.scored_by !== user.id) {
          flashAndRedirect(navigate, "Ce live est géré par quelqu'un d'autre.");
          return;
        }

        setMatch(m);
        setLoading(false);
      });
    return () => { cancelled = true; };
  }, [id, user, authLoading, navigate]);

  const applyPatch = async (patch: Partial<LiveMatch>) => {
    if (!match) return;
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

    setMatch({ ...match, ...finalPatch });

    const { error } = await supabase.from('live_matches').update(finalPatch).eq('id', match.id);
    if (error) {
      setSavingError(error.message);
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
    };
    setMatch({ ...match, ...patch });
    const { error } = await supabase.from('live_matches').update(patch).eq('id', match.id);
    if (error) setSavingError(error.message);
    else setSavingError(null);
  };

  if (authLoading || loading) {
    return <div className="p-8 text-center text-muted-foreground">Chargement...</div>;
  }

  if (error || !match) {
    return (
      <div className="p-6 flex flex-col items-center gap-3">
        <p className="text-red-600 text-sm">{error ?? 'Match introuvable'}</p>
        <Link to="/matches" className="text-sm text-muted-foreground hover:underline">
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
    <div className="p-4 flex flex-col gap-4">
      <div>
        <Link to="/matches" className="text-sm text-muted-foreground hover:underline">
          ← Retour à la liste
        </Link>
      </div>

      <div className="rounded-2xl border border-border bg-card p-4 shadow-sm">
        <div className="mb-2 flex items-center gap-2">
          <span className={`rounded-full px-2.5 py-0.5 text-xs font-medium ${statusStyles[match.status]}`}>
            {statusLabels[match.status]}
          </span>
          <span className="text-xs font-medium text-muted-foreground">
            {match.match_type === 'double' ? 'Double' : 'Simple'}
          </span>
        </div>
        <div className="space-y-1 text-sm">
          <div className={`font-medium ${match.winner === 'j1' ? 'text-emerald-700 font-bold' : 'text-foreground'}`}>
            {match.match_type === 'double' ? 'Équipe 1 : ' : ''}
            {teamLabel(match, 1)}
          </div>
          <div className={`font-medium ${match.winner === 'j2' ? 'text-emerald-700 font-bold' : 'text-foreground'}`}>
            {match.match_type === 'double' ? 'Équipe 2 : ' : ''}
            {teamLabel(match, 2)}
          </div>
        </div>
        <p className="mt-2 text-xs text-muted-foreground">
          {formatDate(match.match_date)}
          {match.start_time && ` — ${match.start_time.slice(0, 5)}`}
        </p>
      </div>

      {match.status === 'finished' && match.winner && (
        <div className="rounded-xl border border-emerald-200 bg-emerald-50 p-3">
          <p className="text-sm font-medium text-emerald-900">
            Match terminé — vainqueur : {getTeamLabel(match, match.winner === 'j1' ? 1 : 2)}.
          </p>
          <button
            onClick={handleCancelFinish}
            className="mt-2 min-h-11 rounded-lg border border-emerald-300 bg-white px-3 py-2 text-sm font-medium text-emerald-800 transition hover:bg-emerald-100"
          >
            Annuler la fin de match
          </button>
        </div>
      )}

      <LiveScoreEntry match={match} onPatch={applyPatch} />

      {savingError && (
        <div className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
          Erreur de sauvegarde : {savingError}
        </div>
      )}
    </div>
  );
}
