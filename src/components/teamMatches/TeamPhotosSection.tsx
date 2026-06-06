import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { supabase } from '../../lib/supabase';
import type { TeamRencontre } from '../../types';

const STORAGE_BUCKET = 'team-match-photos';
const MAX_SIZE = 10 * 1024 * 1024;
const ACCEPTED = ['image/jpeg', 'image/png'];

function sanitizeFilename(name: string): string {
  return name.toLowerCase().replace(/[^a-z0-9.-]/g, '-').replace(/-+/g, '-');
}

function extractStoragePath(publicUrl: string): string | null {
  const marker = `/storage/v1/object/public/${STORAGE_BUCKET}/`;
  const idx = publicUrl.indexOf(marker);
  if (idx === -1) return null;
  return publicUrl.slice(idx + marker.length);
}

interface Props {
  rencontre: TeamRencontre;
  onChange: () => void;
}

export default function TeamPhotosSection({ rencontre, onChange }: Props) {
  const navigate = useNavigate();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const photoUrls = rencontre.photo_urls;

  const persist = async (urls: string[]) => {
    const { error: err } = await supabase
      .from('team_rencontres')
      .update({ photo_urls: urls })
      .eq('id', rencontre.id);
    if (err) {
      setError(err.message);
      return false;
    }
    onChange();
    return true;
  };

  const handleAdd = async (files: FileList | null) => {
    if (!files || files.length === 0) return;
    setError(null);
    setBusy(true);

    const uploaded: string[] = [];
    for (const file of Array.from(files)) {
      if (!ACCEPTED.includes(file.type)) {
        setError(`Format non supporté pour "${file.name}" (JPEG ou PNG).`);
        continue;
      }
      if (file.size > MAX_SIZE) {
        setError(`"${file.name}" dépasse 10 Mo.`);
        continue;
      }
      const path = `${rencontre.id}/${Date.now()}-${sanitizeFilename(file.name)}`;
      const { error: upErr } = await supabase.storage.from(STORAGE_BUCKET).upload(path, file, {
        contentType: file.type,
        cacheControl: '3600',
      });
      if (upErr) {
        setError(upErr.message);
        continue;
      }
      const { data } = supabase.storage.from(STORAGE_BUCKET).getPublicUrl(path);
      uploaded.push(data.publicUrl);
    }

    if (uploaded.length > 0) {
      await persist([...photoUrls, ...uploaded]);
    }
    setBusy(false);
  };

  const handleRemove = async (url: string) => {
    setError(null);
    setBusy(true);
    const path = extractStoragePath(url);
    if (path) await supabase.storage.from(STORAGE_BUCKET).remove([path]);
    await persist(photoUrls.filter((u) => u !== url));
    setBusy(false);
  };

  const handleCreateActu = () => {
    const dateCourte = new Date(rencontre.date_heure).toLocaleDateString('fr-FR', {
      day: '2-digit',
      month: 'short',
      year: 'numeric',
    });
    navigate('/actus/new', {
      state: {
        titre: `Match par équipe — ${rencontre.club_adverse} (${dateCourte})`,
        image_urls: photoUrls,
      },
    });
  };

  return (
    <section className="rounded-2xl border bg-card/90 p-6 shadow-sm">
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <h2 className="text-xs font-semibold uppercase tracking-[0.08em] text-primary">Photos</h2>
        {photoUrls.length > 0 && (
          <button
            onClick={handleCreateActu}
            className="rounded-lg border border-border bg-card px-4 py-2 text-sm font-medium text-muted-foreground transition hover:bg-muted"
          >
            Créer une actu
          </button>
        )}
      </div>

      <input
        type="file"
        accept="image/jpeg,image/png"
        multiple
        disabled={busy}
        onChange={(e) => {
          handleAdd(e.target.files);
          e.target.value = '';
        }}
        className="block w-full text-sm"
      />
      <p className="mt-1 text-xs text-muted-foreground">JPEG/PNG, max 10 Mo par fichier.</p>

      {error && <p className="mt-3 text-sm text-red-600">{error}</p>}

      {photoUrls.length > 0 && (
        <div className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-3 md:grid-cols-4">
          {photoUrls.map((url) => (
            <div key={url} className="relative">
              <img src={url} alt="" className="h-28 w-full rounded-lg object-cover" />
              <button
                onClick={() => handleRemove(url)}
                disabled={busy}
                className="absolute right-1 top-1 rounded-md border border-red-200 bg-red-50 px-2 py-1 text-xs font-medium text-red-700 transition hover:bg-red-100 disabled:opacity-50"
              >
                Retirer
              </button>
            </div>
          ))}
        </div>
      )}
    </section>
  );
}
