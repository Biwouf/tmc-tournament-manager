import { useState, useEffect, useMemo } from 'react';
import { useNavigate, useParams, Link } from 'react-router-dom';
import ReactMarkdown from 'react-markdown';
import { supabase } from '../lib/supabase';
import type { Actu } from '../types';

const MAX_IMAGE_SIZE = 5 * 1024 * 1024;
const ACCEPTED_IMAGE_TYPES = ['image/jpeg', 'image/png'];
const STORAGE_BUCKET = 'actu-images';

function extractStoragePath(publicUrl: string): string | null {
  const marker = `/storage/v1/object/public/${STORAGE_BUCKET}/`;
  const idx = publicUrl.indexOf(marker);
  if (idx === -1) return null;
  return publicUrl.slice(idx + marker.length);
}

function sanitizeFilename(name: string): string {
  return name.toLowerCase().replace(/[^a-z0-9.-]/g, '-').replace(/-+/g, '-');
}

function describeError(err: unknown): string {
  if (err instanceof Error) return err.message;
  if (err && typeof err === 'object') {
    const e = err as { message?: unknown; details?: unknown; hint?: unknown; code?: unknown };
    const parts = [e.message, e.details, e.hint, e.code]
      .filter((v) => v !== undefined && v !== null && v !== '')
      .map(String);
    if (parts.length > 0) return parts.join(' — ');
  }
  return 'Erreur inconnue';
}

interface FieldErrors {
  titre?: string;
  contenu?: string;
  image?: string;
}

interface NewFile {
  localId: string;
  file: File;
  previewUrl: string;
}

export default function ActuForm() {
  const { id } = useParams();
  const isEdit = Boolean(id);
  const navigate = useNavigate();

  const [loading, setLoading] = useState(isEdit);
  const [saving, setSaving] = useState(false);
  const [contenuTab, setContenuTab] = useState<'write' | 'preview'>('write');

  const [titre, setTitre] = useState('');
  const [contenu, setContenu] = useState('');

  const [actu, setActu] = useState<Actu | null>(null);
  const [existingImages, setExistingImages] = useState<string[]>([]);
  const [urlsToRemove, setUrlsToRemove] = useState<string[]>([]);
  const [newFiles, setNewFiles] = useState<NewFile[]>([]);

  const [errors, setErrors] = useState<FieldErrors>({});
  const [submitError, setSubmitError] = useState<string | null>(null);

  const visibleExisting = useMemo(
    () => existingImages.filter((u) => !urlsToRemove.includes(u)),
    [existingImages, urlsToRemove]
  );

  useEffect(() => {
    return () => {
      newFiles.forEach((f) => URL.revokeObjectURL(f.previewUrl));
    };
  }, [newFiles]);

  useEffect(() => {
    if (!isEdit || !id) return;
    supabase
      .from('actus')
      .select('*')
      .eq('id', id)
      .single()
      .then(({ data, error }) => {
        if (error || !data) {
          setSubmitError(`Actu introuvable : ${error?.message ?? ''}`);
          setLoading(false);
          return;
        }
        const a = data as Actu;
        setActu(a);
        setTitre(a.titre);
        setContenu(a.contenu);
        setExistingImages(a.image_urls ?? []);
        setLoading(false);
      });
  }, [id, isEdit]);

  const handleAddFiles = (files: FileList | null) => {
    if (!files || files.length === 0) return;
    const accepted: NewFile[] = [];
    let imgError: string | undefined;

    for (const file of Array.from(files)) {
      if (!ACCEPTED_IMAGE_TYPES.includes(file.type)) {
        imgError = `Format non supporté pour "${file.name}" (JPEG ou PNG uniquement).`;
        continue;
      }
      if (file.size > MAX_IMAGE_SIZE) {
        imgError = `"${file.name}" est trop lourd (max 5 Mo).`;
        continue;
      }
      accepted.push({
        localId: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
        file,
        previewUrl: URL.createObjectURL(file),
      });
    }

    setErrors((e) => ({ ...e, image: imgError }));
    if (accepted.length > 0) setNewFiles((prev) => [...prev, ...accepted]);
  };

  const handleRemoveExisting = (url: string) => {
    setUrlsToRemove((prev) => (prev.includes(url) ? prev : [...prev, url]));
  };

  const handleRemoveNewFile = (localId: string) => {
    setNewFiles((prev) => {
      const target = prev.find((f) => f.localId === localId);
      if (target) URL.revokeObjectURL(target.previewUrl);
      return prev.filter((f) => f.localId !== localId);
    });
  };

  const validate = (): FieldErrors => {
    const errs: FieldErrors = {};
    if (!titre.trim()) errs.titre = 'Titre obligatoire.';
    if (!contenu.trim()) errs.contenu = 'Contenu obligatoire.';
    return errs;
  };

  const uploadFile = async (file: File, actuId: string, index: number): Promise<string> => {
    const path = `${actuId}/${Date.now()}-${index}-${sanitizeFilename(file.name)}`;
    const { error } = await supabase.storage.from(STORAGE_BUCKET).upload(path, file, {
      contentType: file.type,
      cacheControl: '3600',
    });
    if (error) throw error;
    const { data } = supabase.storage.from(STORAGE_BUCKET).getPublicUrl(path);
    return data.publicUrl;
  };

  const deleteStorageFiles = async (publicUrls: string[]) => {
    const paths = publicUrls
      .map(extractStoragePath)
      .filter((p): p is string => p !== null);
    if (paths.length > 0) {
      await supabase.storage.from(STORAGE_BUCKET).remove(paths);
    }
  };

  const persist = async (publish: boolean) => {
    setSubmitError(null);
    const errs = validate();
    setErrors(errs);
    if (Object.keys(errs).length > 0) return;

    setSaving(true);
    try {
      const nowIso = new Date().toISOString();
      const basePayload: Partial<Actu> = {
        titre: titre.trim(),
        contenu,
        published: publish,
      };
      if (publish && !actu?.published_at) {
        basePayload.published_at = nowIso;
      }

      let targetId = id;

      if (isEdit && targetId) {
        const { error: updateErr } = await supabase
          .from('actus')
          .update(basePayload)
          .eq('id', targetId);
        if (updateErr) throw updateErr;
      } else {
        const { data, error: insertErr } = await supabase
          .from('actus')
          .insert({ ...basePayload, image_urls: [] })
          .select('id')
          .single();
        if (insertErr || !data) throw insertErr ?? new Error('Insert failed');
        targetId = data.id;
      }

      if (!targetId) throw new Error('Identifiant manquant après sauvegarde');

      if (urlsToRemove.length > 0) {
        await deleteStorageFiles(urlsToRemove);
      }

      const uploadedUrls: string[] = [];
      for (let i = 0; i < newFiles.length; i++) {
        const url = await uploadFile(newFiles[i].file, targetId, i);
        uploadedUrls.push(url);
      }

      const finalUrls = [...visibleExisting, ...uploadedUrls];
      const { error: imgErr } = await supabase
        .from('actus')
        .update({ image_urls: finalUrls })
        .eq('id', targetId);
      if (imgErr) throw imgErr;

      navigate('/actus');
    } catch (err) {
      console.error(err);
      setSubmitError(describeError(err));
    } finally {
      setSaving(false);
    }
  };

  const handleLogout = () => supabase.auth.signOut();

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center text-muted-foreground">
        Chargement...
      </div>
    );
  }

  return (
    <div className="min-h-screen">
      <header className="border-b border-border/70 bg-card/85 text-card-foreground shadow-sm backdrop-blur">
        <div className="container mx-auto flex items-start justify-between px-4 py-8">
          <div>
            <h1 className="text-3xl font-semibold tracking-tight">
              {isEdit ? "Modifier l'actu" : 'Nouvelle actu'}
            </h1>
            <Link to="/actus" className="mt-2 inline-block text-sm text-muted-foreground hover:underline">
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
        <form
          onSubmit={(e) => e.preventDefault()}
          className="space-y-6 rounded-2xl border bg-card/90 p-6 shadow-sm"
        >
          {/* Titre */}
          <div>
            <label className="block text-sm font-medium text-foreground">Titre *</label>
            <input
              type="text"
              value={titre}
              onChange={(e) => setTitre(e.target.value)}
              className="mt-1 block w-full rounded-lg border border-border bg-background px-3 py-2 text-sm"
            />
            {errors.titre && <p className="mt-1 text-xs text-red-600">{errors.titre}</p>}
          </div>

          {/* Contenu + Markdown preview */}
          <div>
            <div className="flex items-center justify-between">
              <label className="block text-sm font-medium text-foreground">Contenu * (Markdown)</label>
              <div className="flex gap-1 text-xs">
                <button
                  type="button"
                  onClick={() => setContenuTab('write')}
                  className={`rounded px-2 py-1 ${contenuTab === 'write' ? 'bg-muted text-foreground' : 'text-muted-foreground'}`}
                >
                  Écrire
                </button>
                <button
                  type="button"
                  onClick={() => setContenuTab('preview')}
                  className={`rounded px-2 py-1 ${contenuTab === 'preview' ? 'bg-muted text-foreground' : 'text-muted-foreground'}`}
                >
                  Aperçu
                </button>
              </div>
            </div>
            {contenuTab === 'write' ? (
              <textarea
                value={contenu}
                onChange={(e) => setContenu(e.target.value)}
                rows={12}
                placeholder="**gras**, *italique*, - liste, # titre..."
                className="mt-1 block w-full rounded-lg border border-border bg-background px-3 py-2 font-mono text-sm"
              />
            ) : (
              <div className="prose prose-sm mt-1 min-h-[14rem] max-w-none rounded-lg border border-border bg-background px-3 py-2">
                {contenu.trim() ? (
                  <ReactMarkdown>{contenu}</ReactMarkdown>
                ) : (
                  <p className="text-sm text-muted-foreground">Rien à prévisualiser.</p>
                )}
              </div>
            )}
            {errors.contenu && <p className="mt-1 text-xs text-red-600">{errors.contenu}</p>}
          </div>

          {/* Images (multi) */}
          <div>
            <label className="block text-sm font-medium text-foreground">
              Images (JPEG/PNG, max 5 Mo par fichier — facultatif)
            </label>
            <input
              type="file"
              accept="image/jpeg,image/png"
              multiple
              onChange={(e) => {
                handleAddFiles(e.target.files);
                e.target.value = '';
              }}
              className="mt-1 block w-full text-sm"
            />
            {errors.image && <p className="mt-1 text-xs text-red-600">{errors.image}</p>}

            {(visibleExisting.length > 0 || newFiles.length > 0) && (
              <div className="mt-3 grid grid-cols-2 gap-3 sm:grid-cols-3">
                {visibleExisting.map((url) => (
                  <div key={url} className="relative">
                    <img src={url} alt="" className="h-32 w-full rounded-lg object-cover" />
                    <button
                      type="button"
                      onClick={() => handleRemoveExisting(url)}
                      className="absolute right-1 top-1 rounded-md border border-red-200 bg-red-50 px-2 py-1 text-xs font-medium text-red-700 transition hover:bg-red-100"
                    >
                      Retirer
                    </button>
                  </div>
                ))}
                {newFiles.map((f) => (
                  <div key={f.localId} className="relative">
                    <img src={f.previewUrl} alt="" className="h-32 w-full rounded-lg object-cover" />
                    <span className="absolute left-1 top-1 rounded-md bg-blue-50 px-2 py-0.5 text-xs font-medium text-blue-700">
                      Nouveau
                    </span>
                    <button
                      type="button"
                      onClick={() => handleRemoveNewFile(f.localId)}
                      className="absolute right-1 top-1 rounded-md border border-red-200 bg-red-50 px-2 py-1 text-xs font-medium text-red-700 transition hover:bg-red-100"
                    >
                      Retirer
                    </button>
                  </div>
                ))}
              </div>
            )}
          </div>

          {submitError && (
            <div className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
              {submitError}
            </div>
          )}

          <div className="flex flex-wrap justify-end gap-3">
            <Link
              to="/actus"
              className="rounded-lg border border-border bg-card px-4 py-2 text-sm font-medium text-muted-foreground transition hover:bg-muted"
            >
              Annuler
            </Link>
            <button
              type="button"
              disabled={saving}
              onClick={() => persist(false)}
              className="rounded-lg border border-border bg-card px-5 py-2 text-sm font-medium text-foreground shadow-sm transition hover:bg-muted disabled:opacity-50"
            >
              {saving ? 'Enregistrement...' : 'Enregistrer en brouillon'}
            </button>
            <button
              type="button"
              disabled={saving}
              onClick={() => persist(true)}
              className="rounded-lg bg-primary px-5 py-2 text-sm font-medium text-primary-foreground shadow-sm transition hover:brightness-95 disabled:opacity-50"
            >
              {saving ? 'Enregistrement...' : 'Publier'}
            </button>
          </div>
        </form>
      </main>
    </div>
  );
}
