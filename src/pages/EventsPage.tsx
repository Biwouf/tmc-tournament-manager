import { useState, useEffect } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { supabase } from '../lib/supabase';
import type { ClubEvent } from '../types';
import EventCard from '../components/EventCard';

const PAGE_SIZE = 10;

function extractStoragePath(publicUrl: string): string | null {
  const marker = '/storage/v1/object/public/event-images/';
  const idx = publicUrl.indexOf(marker);
  if (idx === -1) return null;
  return publicUrl.slice(idx + marker.length);
}

export default function EventsPage() {
  const navigate = useNavigate();
  const [events, setEvents] = useState<ClubEvent[]>([]);
  const [loading, setLoading] = useState(true);
  const [showPast, setShowPast] = useState(false);
  const [page, setPage] = useState(0);
  const [total, setTotal] = useState(0);
  const [reloadKey, setReloadKey] = useState(0);

  useEffect(() => {
    const nowIso = new Date().toISOString();
    const from = page * PAGE_SIZE;
    const to = from + PAGE_SIZE - 1;

    // "à venir" : date_fin >= now OR (date_fin IS NULL AND date_debut >= now)
    // "passé"   : date_fin < now  OR (date_fin IS NULL AND date_debut < now)
    const filter = showPast
      ? `and(date_fin.lt.${nowIso}),and(date_fin.is.null,date_debut.lt.${nowIso})`
      : `and(date_fin.gte.${nowIso}),and(date_fin.is.null,date_debut.gte.${nowIso})`;

    let cancelled = false;
    supabase
      .from('events')
      .select('*', { count: 'exact' })
      .or(filter)
      .order('date_debut', { ascending: !showPast })
      .range(from, to)
      .then(({ data, error, count }) => {
        if (cancelled) return;
        if (!error && data) {
          setEvents(data as ClubEvent[]);
          setTotal(count ?? 0);
        } else if (error) {
          console.error(error);
        }
        setLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [page, showPast, reloadKey]);

  const reload = () => setReloadKey((k) => k + 1);

  const handleDelete = async (ev: ClubEvent) => {
    if (!window.confirm(`Supprimer l'événement "${ev.titre}" ?`)) return;
    if (ev.image_url) {
      const path = extractStoragePath(ev.image_url);
      if (path) await supabase.storage.from('event-images').remove([path]);
    }
    const { error } = await supabase.from('events').delete().eq('id', ev.id);
    if (error) {
      alert(`Erreur suppression : ${error.message}`);
      return;
    }
    reload();
  };

  const handleDuplicate = async (ev: ClubEvent) => {
    const { data, error } = await supabase
      .from('events')
      .insert({
        type: ev.type,
        titre: `Copie de ${ev.titre}`,
        description: ev.description,
        date_debut: ev.date_debut,
        date_fin: ev.date_fin,
        image_url: ev.image_url,
        prix: ev.prix,
      })
      .select('id')
      .single();
    if (error || !data) {
      alert(`Erreur duplication : ${error?.message ?? 'inconnue'}`);
      return;
    }
    navigate(`/events/${data.id}/edit`);
  };

  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));

  const handleToggle = () => {
    setShowPast((v) => !v);
    setPage(0);
  };

  const handleLogout = () => supabase.auth.signOut();

  return (
    <div className="min-h-screen">
      <header className="border-b border-border/70 bg-card/85 text-card-foreground shadow-sm backdrop-blur">
        <div className="container mx-auto flex items-start justify-between px-4 py-8">
          <div>
            <Link
              to="/"
              className="mb-2 inline-flex items-center gap-1 text-sm text-muted-foreground transition hover:text-foreground"
            >
              ← Accueil
            </Link>
            <h1 className="text-3xl font-semibold tracking-tight">Événements du club</h1>
            <p className="mt-2 text-muted-foreground">Créer, modifier et gérer les événements.</p>
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
        <div className="mb-6 flex flex-wrap items-center justify-between gap-4">
          <label className="flex items-center gap-2 text-sm text-muted-foreground">
            <input
              type="checkbox"
              checked={showPast}
              onChange={handleToggle}
              className="rounded border-border"
            />
            Voir les événements passés
          </label>
          <Link
            to="/events/new"
            className="rounded-lg bg-primary px-5 py-2.5 text-sm font-medium text-primary-foreground shadow-sm transition hover:brightness-95"
          >
            Créer un événement
          </Link>
        </div>

        {loading ? (
          <div className="text-center text-muted-foreground py-12">Chargement...</div>
        ) : events.length === 0 ? (
          <div className="rounded-2xl border border-dashed border-border bg-card/50 p-12 text-center text-muted-foreground">
            {showPast ? 'Aucun événement passé.' : 'Aucun événement à venir.'}
          </div>
        ) : (
          <div className="grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-3">
            {events.map((ev) => (
              <EventCard
                key={ev.id}
                event={ev}
                onDelete={() => handleDelete(ev)}
                onDuplicate={() => handleDuplicate(ev)}
              />
            ))}
          </div>
        )}

        {totalPages > 1 && (
          <div className="mt-8 flex items-center justify-center gap-3 text-sm">
            <button
              disabled={page === 0}
              onClick={() => setPage((p) => Math.max(0, p - 1))}
              className="rounded-lg border border-border bg-card px-4 py-2 font-medium text-muted-foreground transition hover:bg-muted disabled:opacity-40"
            >
              Précédent
            </button>
            <span className="text-muted-foreground">
              Page {page + 1} / {totalPages}
            </span>
            <button
              disabled={page >= totalPages - 1}
              onClick={() => setPage((p) => p + 1)}
              className="rounded-lg border border-border bg-card px-4 py-2 font-medium text-muted-foreground transition hover:bg-muted disabled:opacity-40"
            >
              Suivant
            </button>
          </div>
        )}
      </main>
    </div>
  );
}
