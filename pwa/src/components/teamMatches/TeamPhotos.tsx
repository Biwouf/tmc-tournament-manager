import { useRef, useState } from 'react';
import { supabase } from '../../lib/supabase';
import { compressPhoto } from '../../lib/liveActivity';

const BUCKET = 'team-match-photos';

interface Props {
  clubId: string;
  rencontreId: string;
  photoUrls: string[];
  userId: string | null;
  canAdd: boolean;
  onChanged: () => void;
}

// Photos de la rencontre : admins et capitaines ajoutent, chacun ne retire que les siennes.
// L'auteur est porté par le nom du fichier : <club>/<rencontre>/<user>-<horodatage>.jpg.
export default function TeamPhotos({ clubId, rencontreId, photoUrls, userId, canAdd, onChanged }: Props) {
  const input = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const prefix = userId ? `${clubId}/${rencontreId}/${userId}-` : null;
  const pathOf = (url: string) => url.split(`/object/public/${BUCKET}/`)[1] ?? '';
  const isMine = (url: string) => !!prefix && pathOf(url).startsWith(prefix);

  const add = async (files: FileList | null) => {
    if (!files?.length || !prefix) return;
    setBusy(true);
    setError('');
    try {
      const urls: string[] = [];
      for (const [i, file] of Array.from(files).entries()) {
        const photo = await compressPhoto(file);
        const path = `${prefix}${Date.now()}-${i}.jpg`;
        const { error: upErr } = await supabase.storage.from(BUCKET).upload(path, photo, { contentType: 'image/jpeg', upsert: false });
        if (upErr) throw new Error('Envoi de la photo impossible.');
        urls.push(supabase.storage.from(BUCKET).getPublicUrl(path).data.publicUrl);
      }
      const { error: rpcErr } = await supabase.rpc('team_rencontre_add_photos', { p_club: clubId, p_rencontre: rencontreId, p_urls: urls });
      if (rpcErr) throw new Error('Envoi de la photo impossible.');
      onChanged();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Envoi de la photo impossible.');
    } finally {
      setBusy(false);
      if (input.current) input.current.value = '';
    }
  };

  const remove = async (url: string) => {
    setBusy(true);
    setError('');
    const { error: rpcErr } = await supabase.rpc('team_rencontre_remove_photo', { p_club: clubId, p_rencontre: rencontreId, p_url: url });
    if (rpcErr) {
      setBusy(false);
      setError('Impossible de retirer la photo.');
      return;
    }
    // Le fichier orphelin éventuel est sans conséquence : la rencontre ne le référence plus.
    await supabase.storage.from(BUCKET).remove([pathOf(url)]);
    setBusy(false);
    onChanged();
  };

  if (!photoUrls.length && !canAdd) return null;
  return <section className="space-y-3">
    <h2 className="text-lg font-bold">Photos</h2>
    {photoUrls.length > 0 && <div className="grid grid-cols-2 gap-2">{photoUrls.map(url => <figure key={url} className="relative overflow-hidden rounded-xl border border-border">
      <a href={url} target="_blank" rel="noreferrer"><img src={url} alt="Photo de la rencontre" loading="lazy" className="aspect-square w-full object-cover" /></a>
      {isMine(url) && <button disabled={busy} onClick={() => void remove(url)} className="absolute right-1 top-1 min-h-9 rounded-lg bg-background/90 px-2 text-xs font-semibold text-red-700 disabled:opacity-40">Retirer</button>}
    </figure>)}</div>}
    {canAdd && <>
      <input ref={input} type="file" accept="image/*" multiple hidden onChange={e => void add(e.target.files)} />
      <button disabled={busy} onClick={() => input.current?.click()} className="min-h-12 w-full rounded-xl border border-primary p-3 font-semibold text-primary disabled:opacity-40">{busy ? 'Envoi en cours…' : 'Ajouter des photos'}</button>
    </>}
    {error && <p role="alert" className="text-sm text-red-700">{error}</p>}
  </section>;
}
