import { useState, useEffect, useMemo, type MouseEvent } from 'react';
import { useNavigate, useParams, useLocation, Link } from 'react-router-dom';
import { supabase } from '../lib/supabase';
import MarkdownEditor from './MarkdownEditor';
import type { Actu, ActuFocalPoint } from '../types';

const MAX_IMAGE_SIZE = 5 * 1024 * 1024;
const ACCEPTED_IMAGE_TYPES = ['image/jpeg', 'image/png'];
const STORAGE_BUCKET = 'actu-images';
const DEFAULT_FOCAL_POINT: ActuFocalPoint = { x: 50, y: 50 };

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
  focalPoint: ActuFocalPoint;
  caption: string;
}

function clampPercent(v: number): number {
  return Math.max(0, Math.min(100, v));
}

function computeFocalPoint(e: MouseEvent<HTMLDivElement>): ActuFocalPoint {
  const rect = e.currentTarget.getBoundingClientRect();
  const x = ((e.clientX - rect.left) / rect.width) * 100;
  const y = ((e.clientY - rect.top) / rect.height) * 100;
  return { x: clampPercent(x), y: clampPercent(y) };
}

interface ActuPrefill {
  titre?: string;
  image_urls?: string[];
}

export default function ActuForm() {
  const { id } = useParams();
  const isEdit = Boolean(id);
  const navigate = useNavigate();
  const location = useLocation();

  const [loading, setLoading] = useState(isEdit);
  const [saving, setSaving] = useState(false);

  const [titre, setTitre] = useState('');
  const [contenu, setContenu] = useState('');

  const [actu, setActu] = useState<Actu | null>(null);
  const [existingImages, setExistingImages] = useState<string[]>([]);
  const [existingFocalPoints, setExistingFocalPoints] = useState<ActuFocalPoint[]>([]);
  const [existingCaptions, setExistingCaptions] = useState<string[]>([]);
  const [urlsToRemove, setUrlsToRemove] = useState<string[]>([]);
  const [newFiles, setNewFiles] = useState<NewFile[]>([]);

  const [postToFacebook, setPostToFacebook] = useState(false);
  const [facebookDebug, setFacebookDebug] = useState(false);
  const [facebookStatus, setFacebookStatus] = useState<
    | { kind: 'idle' }
    | { kind: 'loading' }
    | { kind: 'success'; postUrl: string; debug: boolean }
    | { kind: 'error'; message: string }
  >({ kind: 'idle' });

  const [errors, setErrors] = useState<FieldErrors>({});
  const [submitError, setSubmitError] = useState<string | null>(null);

  const visibleExistingItems = useMemo(
    () =>
      existingImages
        .map((url, i) => ({
          url,
          focalPoint: existingFocalPoints[i] ?? DEFAULT_FOCAL_POINT,
          caption: existingCaptions[i] ?? '',
        }))
        .filter(({ url }) => !urlsToRemove.includes(url)),
    [existingImages, existingFocalPoints, existingCaptions, urlsToRemove]
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
        const urls = a.image_urls ?? [];
        const fps = a.image_focal_points ?? [];
        const caps = a.image_captions ?? [];
        setExistingImages(urls);
        setExistingFocalPoints(urls.map((_, i) => fps[i] ?? DEFAULT_FOCAL_POINT));
        setExistingCaptions(urls.map((_, i) => caps[i] ?? ''));
        setLoading(false);
      });
  }, [id, isEdit]);

  // Préremplissage depuis un autre module (ex. « Créer une actu » d'une rencontre).
  // location.state = { titre?, image_urls? }. Appliqué une seule fois, en création.
  useEffect(() => {
    if (isEdit) return;
    const prefill = location.state as ActuPrefill | null;
    if (!prefill) return;
    if (prefill.titre) setTitre(prefill.titre);
    if (prefill.image_urls && prefill.image_urls.length > 0) {
      setExistingImages(prefill.image_urls);
      setExistingFocalPoints(prefill.image_urls.map(() => DEFAULT_FOCAL_POINT));
      setExistingCaptions(prefill.image_urls.map(() => ''));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

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
        focalPoint: { ...DEFAULT_FOCAL_POINT },
        caption: '',
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

  const handleSetExistingFocalPoint = (url: string, fp: ActuFocalPoint) => {
    setExistingFocalPoints((prev) => {
      const idx = existingImages.indexOf(url);
      if (idx === -1) return prev;
      const next = [...prev];
      next[idx] = fp;
      return next;
    });
  };

  const handleSetNewFileFocalPoint = (localId: string, fp: ActuFocalPoint) => {
    setNewFiles((prev) =>
      prev.map((f) => (f.localId === localId ? { ...f, focalPoint: fp } : f))
    );
  };

  const handleSetExistingCaption = (url: string, caption: string) => {
    setExistingCaptions((prev) => {
      const idx = existingImages.indexOf(url);
      if (idx === -1) return prev;
      const next = [...prev];
      next[idx] = caption;
      return next;
    });
  };

  const handleSetNewFileCaption = (localId: string, caption: string) => {
    setNewFiles((prev) =>
      prev.map((f) => (f.localId === localId ? { ...f, caption } : f))
    );
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

  const facebookDisabled = Boolean(actu?.published);

  const persist = async (publish: boolean) => {
    setSubmitError(null);
    setFacebookStatus({ kind: 'idle' });
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

      const finalUrls = [
        ...visibleExistingItems.map((item) => item.url),
        ...uploadedUrls,
      ];
      const finalFocalPoints: (ActuFocalPoint | null)[] = [
        ...visibleExistingItems.map((item) => item.focalPoint),
        ...newFiles.map((f) => f.focalPoint),
      ];
      const finalCaptions: string[] = [
        ...visibleExistingItems.map((item) => item.caption),
        ...newFiles.map((f) => f.caption),
      ];
      const { error: imgErr } = await supabase
        .from('actus')
        .update({
          image_urls: finalUrls,
          image_focal_points: finalFocalPoints,
          image_captions: finalCaptions,
        })
        .eq('id', targetId);
      if (imgErr) throw imgErr;

      const shouldPostToFacebook = publish && postToFacebook && !facebookDisabled;

      if (shouldPostToFacebook) {
        setFacebookStatus({ kind: 'loading' });
        try {
          const { data: fbData, error: fbErr } = await supabase.functions.invoke(
            'post-to-facebook',
            { body: { actu_id: targetId, debug: facebookDebug } }
          );

          // Sur une réponse non-2xx, supabase-js renvoie une FunctionsHttpError
          // et data=null. Le body de la réponse est accessible via error.context.
          let body: { success?: boolean; error?: string; post_url?: string; debug?: boolean } | null =
            (fbData as typeof body) ?? null;
          if (fbErr && !body) {
            const ctx = (fbErr as { context?: Response }).context;
            if (ctx && typeof ctx.json === 'function') {
              try {
                body = await ctx.json();
              } catch {
                /* body non-JSON — on ignore */
              }
            }
          }

          if (body?.success && body.post_url) {
            setFacebookStatus({
              kind: 'success',
              postUrl: body.post_url,
              debug: Boolean(body.debug),
            });
          } else {
            const message =
              body?.error ||
              fbErr?.message ||
              'Erreur inconnue lors de la publication Facebook.';
            setFacebookStatus({ kind: 'error', message });
          }
        } catch (e) {
          setFacebookStatus({
            kind: 'error',
            message: 'Erreur réseau lors de la communication avec Facebook. ' + describeError(e),
          });
        }
        // On NE navigue PAS automatiquement quand on a posté sur Facebook —
        // l'utilisateur doit pouvoir lire le lien / le message d'erreur.
      } else {
        navigate('/actus');
      }
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
            <label className="block text-sm font-medium text-foreground">Contenu * (Markdown)</label>
            <MarkdownEditor
              value={contenu}
              onChange={setContenu}
              rows={12}
              placeholder="**gras**, *italique*, - liste, # titre..."
            />
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

            {(visibleExistingItems.length > 0 || newFiles.length > 0) && (
              <>
                <p className="mt-3 text-xs text-muted-foreground">
                  Cliquez sur une image pour définir son point de focus (zone qui restera visible dans le cadrage PWA).
                </p>
                <div className="mt-2 grid grid-cols-2 gap-3 sm:grid-cols-3">
                  {visibleExistingItems.map(({ url, focalPoint, caption }) => (
                    <FocalPointPreview
                      key={url}
                      src={url}
                      focalPoint={focalPoint}
                      caption={caption}
                      onPick={(fp) => handleSetExistingFocalPoint(url, fp)}
                      onCaptionChange={(c) => handleSetExistingCaption(url, c)}
                      onRemove={() => handleRemoveExisting(url)}
                    />
                  ))}
                  {newFiles.map((f) => (
                    <FocalPointPreview
                      key={f.localId}
                      src={f.previewUrl}
                      focalPoint={f.focalPoint}
                      caption={f.caption}
                      onPick={(fp) => handleSetNewFileFocalPoint(f.localId, fp)}
                      onCaptionChange={(c) => handleSetNewFileCaption(f.localId, c)}
                      onRemove={() => handleRemoveNewFile(f.localId)}
                      badge="Nouveau"
                    />
                  ))}
                </div>
              </>
            )}
          </div>

          {/* Options Facebook (appliquées uniquement au clic sur "Publier") */}
          <div className="rounded-lg border border-border/70 bg-muted/40 px-4 py-3">
            <label
              className={`flex items-start gap-2 text-sm ${
                facebookDisabled ? 'text-muted-foreground' : 'text-foreground'
              }`}
            >
              <input
                type="checkbox"
                checked={postToFacebook && !facebookDisabled}
                disabled={facebookDisabled || saving}
                onChange={(e) => {
                  setPostToFacebook(e.target.checked);
                  if (!e.target.checked) setFacebookDebug(false);
                }}
                className="mt-0.5"
              />
              <span>
                Publier aussi sur Facebook
                {facebookDisabled && (
                  <span className="ml-2 text-xs italic">
                    (désactivé — actu déjà publiée)
                  </span>
                )}
              </span>
            </label>
            {postToFacebook && !facebookDisabled && (
              <label className="mt-2 ml-6 flex items-start gap-2 text-sm text-foreground">
                <input
                  type="checkbox"
                  checked={facebookDebug}
                  disabled={saving}
                  onChange={(e) => setFacebookDebug(e.target.checked)}
                  className="mt-0.5"
                />
                <span>
                  Mode debug
                  <span className="ml-1 text-xs text-muted-foreground">
                    (post caché — visible uniquement par les admins de la page)
                  </span>
                </span>
              </label>
            )}
          </div>

          {submitError && (
            <div className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
              {submitError}
            </div>
          )}

          {facebookStatus.kind === 'loading' && (
            <div className="rounded-lg border border-blue-200 bg-blue-50 px-4 py-3 text-sm text-blue-700">
              Publication sur Facebook…
            </div>
          )}
          {facebookStatus.kind === 'success' && (
            <div className="rounded-lg border border-green-200 bg-green-50 px-4 py-3 text-sm text-green-700">
              {facebookStatus.debug
                ? 'Post publié en mode caché (visible uniquement par les admins de la page).'
                : 'Post publié sur Facebook.'}
              {' '}
              <a
                href={facebookStatus.postUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="font-medium underline"
              >
                Voir le post
              </a>
            </div>
          )}
          {facebookStatus.kind === 'error' && (
            <div className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700 whitespace-pre-wrap">
              {facebookStatus.message}
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

interface FocalPointPreviewProps {
  src: string;
  focalPoint: ActuFocalPoint;
  caption: string;
  onPick: (fp: ActuFocalPoint) => void;
  onCaptionChange: (caption: string) => void;
  onRemove: () => void;
  badge?: string;
}

function FocalPointPreview({
  src,
  focalPoint,
  caption,
  onPick,
  onCaptionChange,
  onRemove,
  badge,
}: FocalPointPreviewProps) {
  const [loaded, setLoaded] = useState(false);

  return (
    <div className="space-y-1.5">
      <div className="relative">
        <img
          src={src}
          alt=""
          onLoad={() => setLoaded(true)}
          className="h-32 w-full rounded-lg object-cover"
          style={{ objectPosition: `${focalPoint.x}% ${focalPoint.y}%` }}
        />
        {loaded && (
          <div
            role="presentation"
            onClick={(e) => onPick(computeFocalPoint(e))}
            className="absolute inset-0 cursor-crosshair rounded-lg"
            title="Cliquez pour définir le point de focus"
          />
        )}
        <div
          aria-hidden
          className="pointer-events-none absolute h-3 w-3 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-white shadow"
          style={{
            left: `${focalPoint.x}%`,
            top: `${focalPoint.y}%`,
            backgroundColor: 'rgba(0,0,0,0.7)',
          }}
        />
        {badge && (
          <span className="pointer-events-none absolute left-1 top-1 rounded-md bg-blue-50 px-2 py-0.5 text-xs font-medium text-blue-700">
            {badge}
          </span>
        )}
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation();
            onRemove();
          }}
          className="absolute right-1 top-1 z-10 rounded-md border border-red-200 bg-red-50 px-2 py-1 text-xs font-medium text-red-700 transition hover:bg-red-100"
        >
          Retirer
        </button>
      </div>
      <textarea
        value={caption}
        onChange={(e) => onCaptionChange(e.target.value)}
        rows={2}
        placeholder="Légende Facebook (optionnelle)"
        className="block w-full resize-y rounded-md border border-border bg-background px-2 py-1 text-xs"
      />
      <p className="text-[10px] leading-tight text-muted-foreground">
        Visible uniquement quand l’image est ouverte en plein écran sur Facebook.
      </p>
    </div>
  );
}
