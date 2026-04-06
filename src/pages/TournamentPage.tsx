import { useState, useEffect } from 'react';
import { useParams, useNavigate, Link } from 'react-router-dom';
import type { User } from '@supabase/supabase-js';
import type { GlobalConfig, TournamentEntry } from '../types';
import ConfigurationForm from '../components/ConfigurationForm';
import ScheduleView from '../components/ScheduleView';
import { generateSchedule } from '../scheduler';
import { moveMatches } from '../moveMatch';
import { supabase } from '../lib/supabase';

interface Props {
  user: User;
}

export default function TournamentPage({ user }: Props) {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();

  const isNew = id === 'new';

  const [entry, setEntry] = useState<TournamentEntry | null>(null);
  const [loading, setLoading] = useState(!isNew);
  const [error, setError] = useState<string | null>(null);
  const [confirmDelete, setConfirmDelete] = useState(false);

  useEffect(() => {
    if (isNew) return;
    supabase
      .from('tournaments')
      .select('id, config, schedule')
      .eq('id', id!)
      .single()
      .then(({ data, error }) => {
        if (!error && data) {
          setEntry({ id: data.id, config: data.config, schedule: data.schedule });
        }
        setLoading(false);
      });
  }, [id, isNew]);

  const handleConfigSubmit = async (newConfig: GlobalConfig) => {
    try {
      setError(null);
      const schedule = generateSchedule(newConfig);

      if (isNew) {
        const { data, error } = await supabase
          .from('tournaments')
          .insert({ config: newConfig, schedule, user_id: user.id })
          .select('id')
          .single();
        if (error) throw error;
        navigate(`/tmc-planning/${data.id}`);
      } else {
        const { error } = await supabase
          .from('tournaments')
          .update({ config: newConfig, schedule })
          .eq('id', id!);
        if (error) throw error;
        setEntry((prev) => prev ? { ...prev, config: newConfig, schedule } : prev);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Une erreur est survenue');
    }
  };

  const handleMoveMatch = (matchIds: string[], newDate: string, newStartTime: string) => {
    if (!entry?.schedule) return;
    const result = moveMatches(
      entry.schedule.scheduledMatches,
      matchIds,
      newDate,
      newStartTime,
      entry.config
    );
    if (!result) return;

    const updatedSchedule = {
      ...entry.schedule,
      scheduledMatches: result.scheduledMatches,
      warnings: result.warnings.length > 0 ? result.warnings : entry.schedule.warnings,
    };

    // Optimistic update
    setEntry((prev) => prev ? { ...prev, schedule: updatedSchedule } : prev);

    // Persist
    supabase.from('tournaments').update({ schedule: updatedSchedule }).eq('id', id!);
  };

  const handleDelete = async () => {
    await supabase.from('tournaments').delete().eq('id', id!);
    navigate('/tmc-planning');
  };

  const handleReset = async () => {
    const { error } = await supabase
      .from('tournaments')
      .update({ schedule: null })
      .eq('id', id!);
    if (!error) setEntry((prev) => prev ? { ...prev, schedule: null } : prev);
  };

  if (loading) {
    return (
      <div className="flex min-h-screen items-center justify-center text-muted-foreground">
        Chargement...
      </div>
    );
  }

  if (!isNew && !entry) {
    return (
      <div className="container mx-auto px-4 py-8">
        <p className="text-muted-foreground">Tournoi introuvable.</p>
        <Link to="/tmc-planning" className="text-primary hover:underline">
          Retour à l'accueil
        </Link>
      </div>
    );
  }

  return (
    <div className="min-h-screen">
      <header className="border-b border-border/70 bg-card/85 text-card-foreground shadow-sm backdrop-blur">
        <div className="container mx-auto px-4 py-8">
          <Link
            to="/tmc-planning"
            className="mb-2 inline-flex items-center gap-1 text-sm text-muted-foreground transition hover:text-foreground"
          >
            ← Tous les tournois
          </Link>
          <h1 className="text-3xl font-semibold tracking-tight">
            {isNew ? 'Nouveau tournoi' : entry!.config.name}
          </h1>
          {!isNew && entry?.config.startDate && (
            <p className="mt-2 text-muted-foreground">
              {entry.config.startDate} → {entry.config.endDate}
            </p>
          )}
        </div>
      </header>

      <main className="container mx-auto px-4 py-8">
        {error && (
          <div className="mb-6 rounded-xl border border-destructive/30 bg-destructive/10 px-4 py-3 text-destructive">
            <strong className="font-bold">Erreur : </strong>
            <span>{error}</span>
          </div>
        )}

        {!entry?.schedule ? (
          <ConfigurationForm onSubmit={handleConfigSubmit} initialConfig={entry?.config} />
        ) : (
          <div>
            <div className="mb-6 flex flex-wrap items-center gap-3">
              <button
                onClick={handleReset}
                className="inline-flex items-center rounded-lg border border-border bg-card px-5 py-2.5 text-sm font-medium text-card-foreground transition hover:bg-muted"
              >
                Reconfigurer
              </button>

              {!confirmDelete ? (
                <button
                  onClick={() => setConfirmDelete(true)}
                  className="inline-flex items-center rounded-lg border border-destructive/30 bg-destructive/10 px-5 py-2.5 text-sm font-medium text-destructive transition hover:bg-destructive/20"
                >
                  Supprimer le tournoi
                </button>
              ) : (
                <div className="flex items-center gap-3 rounded-lg border border-destructive/30 bg-destructive/10 px-4 py-2.5">
                  <span className="text-sm text-destructive">Confirmer la suppression ?</span>
                  <button
                    onClick={handleDelete}
                    className="text-sm font-medium text-destructive transition hover:opacity-80"
                  >
                    Oui, supprimer
                  </button>
                  <button
                    onClick={() => setConfirmDelete(false)}
                    className="text-sm font-medium text-muted-foreground transition hover:opacity-80"
                  >
                    Annuler
                  </button>
                </div>
              )}
            </div>

            <ScheduleView
              schedule={entry.schedule}
              config={entry.config}
              onConfigUpdate={handleConfigSubmit}
              onMoveMatch={handleMoveMatch}
            />
          </div>
        )}
      </main>

      <footer className="mt-12 border-t border-border/70 py-6 text-muted-foreground">
        <div className="container mx-auto px-4 text-center">
          <p>Gestionnaire de Tournois TMC</p>
        </div>
      </footer>
    </div>
  );
}
