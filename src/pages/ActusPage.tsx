import { useState, useEffect } from 'react';
import { Link } from 'react-router-dom';
import { supabase } from '../lib/supabase';
import type { Actu } from '../types';

const STORAGE_BUCKET = 'actu-images';

function extractStoragePath(publicUrl: string): string | null {
  const marker = `/storage/v1/object/public/${STORAGE_BUCKET}/`;
  const idx = publicUrl.indexOf(marker);
  if (idx === -1) return null;
  return publicUrl.slice(idx + marker.length);
}

function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString('fr-FR', { dateStyle: 'medium' });
}

export default function ActusPage() {
  const [actus, setActus] = useState<Actu[]>([]);
  const [loading, setLoading] = useState(true);
  const [reloadKey, setReloadKey] = useState(0);

  useEffect(() => {
    let cancelled = false;
    supabase
      .from('actus')
      .select('*')
      .order('created_at', { ascending: false })
      .then(({ data, error }) => {
        if (cancelled) return;
        if (error) console.error(error);
        if (data) setActus(data as Actu[]);
        setLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [reloadKey]);

  const reload = () => setReloadKey((k) => k + 1);

  const handlePublish = async (a: Actu) => {
    const payload: Partial<Actu> = { published: true };
    if (!a.published_at) payload.published_at = new Date().toISOString();
    const { error } = await supabase.from('actus').update(payload).eq('id', a.id);
    if (error) {
      alert(`Erreur publication : ${error.message}`);
      return;
    }
    reload();
  };

  const handleUnpublish = async (a: Actu) => {
    const { error } = await supabase.from('actus').update({ published: false }).eq('id', a.id);
    if (error) {
      alert(`Erreur dépublication : ${error.message}`);
      return;
    }
    reload();
  };

  const handleDelete = async (a: Actu) => {
    if (!window.confirm(`Supprimer l'actu "${a.titre}" ?`)) return;
    if (a.image_urls.length > 0) {
      const paths = a.image_urls
        .map(extractStoragePath)
        .filter((p): p is string => p !== null);
      if (paths.length > 0) await supabase.storage.from(STORAGE_BUCKET).remove(paths);
    }
    const { error } = await supabase.from('actus').delete().eq('id', a.id);
    if (error) {
      alert(`Erreur suppression : ${error.message}`);
      return;
    }
    reload();
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
            <h1 className="text-3xl font-semibold tracking-tight">Actus du club</h1>
            <p className="mt-2 text-muted-foreground">Rédiger et publier les actualités du club.</p>
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
            to="/actus/new"
            className="rounded-lg bg-primary px-5 py-2.5 text-sm font-medium text-primary-foreground shadow-sm transition hover:brightness-95"
          >
            Créer une actu
          </Link>
        </div>

        {loading ? (
          <div className="text-center text-muted-foreground py-12">Chargement...</div>
        ) : actus.length === 0 ? (
          <div className="rounded-2xl border border-dashed border-border bg-card/50 p-12 text-center text-muted-foreground">
            Aucune actu pour le moment.
          </div>
        ) : (
          <div className="grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-3">
            {actus.map((a) => (
              <ActuCard
                key={a.id}
                actu={a}
                onPublish={() => handlePublish(a)}
                onUnpublish={() => handleUnpublish(a)}
                onDelete={() => handleDelete(a)}
              />
            ))}
          </div>
        )}
      </main>
    </div>
  );
}

interface CardProps {
  actu: Actu;
  onPublish: () => void;
  onUnpublish: () => void;
  onDelete: () => void;
}

function ActuCard({ actu, onPublish, onUnpublish, onDelete }: CardProps) {
  const badgeClass = actu.published
    ? 'bg-emerald-100 text-emerald-800'
    : 'bg-gray-100 text-gray-700';
  const badgeLabel = actu.published ? 'Publié' : 'Brouillon';

  return (
    <div className="flex flex-col rounded-2xl border bg-card/90 p-6 shadow-sm transition hover:shadow-md">
      <div className="mb-3 flex items-center gap-2">
        <span className={`rounded-full px-2.5 py-0.5 text-xs font-medium ${badgeClass}`}>
          {badgeLabel}
        </span>
        {actu.image_urls.length > 0 && (
          <span className="ml-auto text-xs text-muted-foreground">
            {actu.image_urls.length} image{actu.image_urls.length > 1 ? 's' : ''}
          </span>
        )}
      </div>

      <h3 className="text-lg font-semibold text-card-foreground">{actu.titre}</h3>
      <p className="mt-2 text-sm text-muted-foreground">Créée le {formatDate(actu.created_at)}</p>

      <div className="mt-4 flex flex-wrap gap-2 pt-2">
        <Link
          to={`/actus/${actu.id}/edit`}
          className="rounded-lg border border-border bg-card px-3 py-1.5 text-sm font-medium text-muted-foreground transition hover:bg-muted"
        >
          Modifier
        </Link>
        {actu.published ? (
          <button
            onClick={onUnpublish}
            className="rounded-lg border border-border bg-card px-3 py-1.5 text-sm font-medium text-muted-foreground transition hover:bg-muted"
          >
            Dépublier
          </button>
        ) : (
          <button
            onClick={onPublish}
            className="rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-1.5 text-sm font-medium text-emerald-700 transition hover:bg-emerald-100"
          >
            Publier
          </button>
        )}
        <button
          onClick={onDelete}
          className="ml-auto rounded-lg border border-red-200 bg-red-50 px-3 py-1.5 text-sm font-medium text-red-700 transition hover:bg-red-100"
        >
          Supprimer
        </button>
      </div>
    </div>
  );
}
