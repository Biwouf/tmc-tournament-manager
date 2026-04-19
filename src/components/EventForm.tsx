import { useState, useEffect, useMemo } from 'react';
import { useNavigate, useParams, Link } from 'react-router-dom';
import ReactMarkdown from 'react-markdown';
import { supabase } from '../lib/supabase';
import { EVENT_TYPES, type ClubEvent, type EventType } from '../types';

const MAX_IMAGE_SIZE = 5 * 1024 * 1024;
const ACCEPTED_IMAGE_TYPES = ['image/jpeg', 'image/png'];
const STORAGE_BUCKET = 'event-images';

function extractStoragePath(publicUrl: string): string | null {
  const marker = `/storage/v1/object/public/${STORAGE_BUCKET}/`;
  const idx = publicUrl.indexOf(marker);
  if (idx === -1) return null;
  return publicUrl.slice(idx + marker.length);
}

function isoToLocalInput(iso: string | null): string {
  if (!iso) return '';
  const d = new Date(iso);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

function localInputToIso(value: string): string {
  return new Date(value).toISOString();
}

function sanitizeFilename(name: string): string {
  return name.toLowerCase().replace(/[^a-z0-9.-]/g, '-').replace(/-+/g, '-');
}

interface FieldErrors {
  titre?: string;
  description?: string;
  date_debut?: string;
  date_fin?: string;
  image?: string;
  prix?: string;
}

export default function EventForm() {
  const { id } = useParams();
  const isEdit = Boolean(id);
  const navigate = useNavigate();

  const [loading, setLoading] = useState(isEdit);
  const [saving, setSaving] = useState(false);
  const [descTab, setDescTab] = useState<'write' | 'preview'>('write');

  const [type, setType] = useState<EventType>('Animation');
  const [titre, setTitre] = useState('');
  const [description, setDescription] = useState('');
  const [dateDebut, setDateDebut] = useState('');
  const [dateFin, setDateFin] = useState('');
  const [prix, setPrix] = useState('');

  const [existingImageUrl, setExistingImageUrl] = useState<string | null>(null);
  const [imageFile, setImageFile] = useState<File | null>(null);
  const [removeExistingImage, setRemoveExistingImage] = useState(false);

  const [errors, setErrors] = useState<FieldErrors>({});
  const [submitError, setSubmitError] = useState<string | null>(null);

  const imagePreviewUrl = useMemo(() => {
    if (imageFile) return URL.createObjectURL(imageFile);
    if (existingImageUrl && !removeExistingImage) return existingImageUrl;
    return null;
  }, [imageFile, existingImageUrl, removeExistingImage]);

  useEffect(() => {
    return () => {
      if (imageFile && imagePreviewUrl && imagePreviewUrl.startsWith('blob:')) {
        URL.revokeObjectURL(imagePreviewUrl);
      }
    };
  }, [imageFile, imagePreviewUrl]);

  useEffect(() => {
    if (!isEdit || !id) return;
    supabase
      .from('events')
      .select('*')
      .eq('id', id)
      .single()
      .then(({ data, error }) => {
        if (error || !data) {
          setSubmitError(`Événement introuvable : ${error?.message ?? ''}`);
          setLoading(false);
          return;
        }
        const ev = data as ClubEvent;
        setType(ev.type);
        setTitre(ev.titre);
        setDescription(ev.description);
        setDateDebut(isoToLocalInput(ev.date_debut));
        setDateFin(isoToLocalInput(ev.date_fin));
        setPrix(ev.prix === null ? '' : String(ev.prix));
        setExistingImageUrl(ev.image_url);
        setLoading(false);
      });
  }, [id, isEdit]);

  const handleImageChange = (file: File | null) => {
    if (!file) {
      setImageFile(null);
      return;
    }
    if (!ACCEPTED_IMAGE_TYPES.includes(file.type)) {
      setErrors((e) => ({ ...e, image: 'Format non supporté (JPEG ou PNG uniquement).' }));
      return;
    }
    if (file.size > MAX_IMAGE_SIZE) {
      setErrors((e) => ({ ...e, image: 'Fichier trop lourd (max 5 Mo).' }));
      return;
    }
    setErrors((e) => ({ ...e, image: undefined }));
    setImageFile(file);
    setRemoveExistingImage(false);
  };

  const handleRemoveImage = () => {
    setImageFile(null);
    if (existingImageUrl) setRemoveExistingImage(true);
  };

  const validate = (): FieldErrors => {
    const errs: FieldErrors = {};
    if (!titre.trim()) errs.titre = 'Titre obligatoire.';
    if (!description.trim()) errs.description = 'Description obligatoire.';
    if (!dateDebut) errs.date_debut = 'Date de début obligatoire.';
    if (type === 'Tournoi' && !dateFin) {
      errs.date_fin = 'Date de fin obligatoire pour un tournoi.';
    }
    if (dateDebut && dateFin && new Date(dateFin) <= new Date(dateDebut)) {
      errs.date_fin = 'La date de fin doit être postérieure à la date de début.';
    }
    if (prix && (isNaN(Number(prix)) || Number(prix) < 0)) {
      errs.prix = 'Le prix doit être un nombre positif.';
    }
    return errs;
  };

  const uploadImage = async (file: File, eventId: string): Promise<string> => {
    const path = `${eventId}/${Date.now()}-${sanitizeFilename(file.name)}`;
    const { error } = await supabase.storage.from(STORAGE_BUCKET).upload(path, file, {
      contentType: file.type,
      cacheControl: '3600',
    });
    if (error) throw error;
    const { data } = supabase.storage.from(STORAGE_BUCKET).getPublicUrl(path);
    return data.publicUrl;
  };

  const deleteStorageFile = async (publicUrl: string) => {
    const path = extractStoragePath(publicUrl);
    if (path) await supabase.storage.from(STORAGE_BUCKET).remove([path]);
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setSubmitError(null);
    const errs = validate();
    setErrors(errs);
    if (Object.keys(errs).length > 0) return;

    setSaving(true);
    try {
      const basePayload = {
        type,
        titre: titre.trim(),
        description,
        date_debut: localInputToIso(dateDebut),
        date_fin: dateFin ? localInputToIso(dateFin) : null,
        prix: prix === '' ? null : Number(prix),
      };

      let targetId = id;
      let finalImageUrl = existingImageUrl;

      if (isEdit && targetId) {
        // Update first (without image change) to ensure the row exists
        const { error: updateErr } = await supabase
          .from('events')
          .update(basePayload)
          .eq('id', targetId);
        if (updateErr) throw updateErr;

        if (removeExistingImage && existingImageUrl) {
          await deleteStorageFile(existingImageUrl);
          finalImageUrl = null;
        }
        if (imageFile) {
          if (existingImageUrl) await deleteStorageFile(existingImageUrl);
          finalImageUrl = await uploadImage(imageFile, targetId);
        }
        if (finalImageUrl !== existingImageUrl) {
          const { error: imgErr } = await supabase
            .from('events')
            .update({ image_url: finalImageUrl })
            .eq('id', targetId);
          if (imgErr) throw imgErr;
        }
      } else {
        const { data, error: insertErr } = await supabase
          .from('events')
          .insert({ ...basePayload, image_url: null })
          .select('id')
          .single();
        if (insertErr || !data) throw insertErr ?? new Error('Insert failed');
        targetId = data.id;
        if (imageFile && targetId) {
          finalImageUrl = await uploadImage(imageFile, targetId);
          const { error: imgErr } = await supabase
            .from('events')
            .update({ image_url: finalImageUrl })
            .eq('id', targetId);
          if (imgErr) throw imgErr;
        }
      }

      navigate('/events');
    } catch (err) {
      console.error(err);
      setSubmitError(err instanceof Error ? err.message : 'Erreur inconnue');
    } finally {
      setSaving(false);
    }
  };

  const handleLogout = () => supabase.auth.signOut();

  if (loading) {
    return <div className="min-h-screen flex items-center justify-center text-muted-foreground">Chargement...</div>;
  }

  const tournoiDateFinRequired = type === 'Tournoi';

  return (
    <div className="min-h-screen">
      <header className="border-b border-border/70 bg-card/85 text-card-foreground shadow-sm backdrop-blur">
        <div className="container mx-auto flex items-start justify-between px-4 py-8">
          <div>
            <h1 className="text-3xl font-semibold tracking-tight">
              {isEdit ? "Modifier l'événement" : 'Nouvel événement'}
            </h1>
            <Link to="/events" className="mt-2 inline-block text-sm text-muted-foreground hover:underline">
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
        <form onSubmit={handleSubmit} className="space-y-6 rounded-2xl border bg-card/90 p-6 shadow-sm">
          {/* Type */}
          <div>
            <label className="block text-sm font-medium text-foreground">Type</label>
            <select
              value={type}
              onChange={(e) => setType(e.target.value as EventType)}
              className="mt-1 block w-full rounded-lg border border-border bg-background px-3 py-2 text-sm"
            >
              {EVENT_TYPES.map((t) => (
                <option key={t} value={t}>
                  {t}
                </option>
              ))}
            </select>
          </div>

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

          {/* Description + Markdown preview */}
          <div>
            <div className="flex items-center justify-between">
              <label className="block text-sm font-medium text-foreground">Description * (Markdown)</label>
              <div className="flex gap-1 text-xs">
                <button
                  type="button"
                  onClick={() => setDescTab('write')}
                  className={`rounded px-2 py-1 ${descTab === 'write' ? 'bg-muted text-foreground' : 'text-muted-foreground'}`}
                >
                  Écrire
                </button>
                <button
                  type="button"
                  onClick={() => setDescTab('preview')}
                  className={`rounded px-2 py-1 ${descTab === 'preview' ? 'bg-muted text-foreground' : 'text-muted-foreground'}`}
                >
                  Aperçu
                </button>
              </div>
            </div>
            {descTab === 'write' ? (
              <textarea
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                rows={10}
                placeholder="**gras**, *italique*, - liste, # titre..."
                className="mt-1 block w-full rounded-lg border border-border bg-background px-3 py-2 font-mono text-sm"
              />
            ) : (
              <div className="prose prose-sm mt-1 min-h-[12rem] max-w-none rounded-lg border border-border bg-background px-3 py-2">
                {description.trim() ? (
                  <ReactMarkdown>{description}</ReactMarkdown>
                ) : (
                  <p className="text-sm text-muted-foreground">Rien à prévisualiser.</p>
                )}
              </div>
            )}
            {errors.description && <p className="mt-1 text-xs text-red-600">{errors.description}</p>}
          </div>

          {/* Dates */}
          <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
            <div>
              <label className="block text-sm font-medium text-foreground">Date début *</label>
              <input
                type="datetime-local"
                value={dateDebut}
                onChange={(e) => setDateDebut(e.target.value)}
                className="mt-1 block w-full rounded-lg border border-border bg-background px-3 py-2 text-sm"
              />
              {errors.date_debut && <p className="mt-1 text-xs text-red-600">{errors.date_debut}</p>}
            </div>
            <div>
              <label className="block text-sm font-medium text-foreground">
                Date fin {tournoiDateFinRequired ? '*' : <span className="text-muted-foreground">(optionnel)</span>}
              </label>
              <input
                type="datetime-local"
                value={dateFin}
                onChange={(e) => setDateFin(e.target.value)}
                className="mt-1 block w-full rounded-lg border border-border bg-background px-3 py-2 text-sm"
              />
              {errors.date_fin && <p className="mt-1 text-xs text-red-600">{errors.date_fin}</p>}
            </div>
          </div>

          {/* Image */}
          <div>
            <label className="block text-sm font-medium text-foreground">Image (JPEG/PNG, max 5 Mo)</label>
            <input
              type="file"
              accept="image/jpeg,image/png"
              onChange={(e) => handleImageChange(e.target.files?.[0] ?? null)}
              className="mt-1 block w-full text-sm"
            />
            {errors.image && <p className="mt-1 text-xs text-red-600">{errors.image}</p>}
            {imagePreviewUrl && (
              <div className="mt-3 flex items-start gap-4">
                <img src={imagePreviewUrl} alt="Aperçu" className="h-32 w-32 rounded-lg object-cover" />
                <button
                  type="button"
                  onClick={handleRemoveImage}
                  className="rounded-lg border border-red-200 bg-red-50 px-3 py-1.5 text-sm font-medium text-red-700 transition hover:bg-red-100"
                >
                  Supprimer l'image
                </button>
              </div>
            )}
          </div>

          {/* Prix */}
          <div>
            <label className="block text-sm font-medium text-foreground">Prix (€)</label>
            <input
              type="number"
              min="0"
              step="0.01"
              value={prix}
              placeholder="Laisser vide si gratuit"
              onChange={(e) => setPrix(e.target.value)}
              className="mt-1 block w-full rounded-lg border border-border bg-background px-3 py-2 text-sm"
            />
            {errors.prix && <p className="mt-1 text-xs text-red-600">{errors.prix}</p>}
          </div>

          {submitError && (
            <div className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
              {submitError}
            </div>
          )}

          <div className="flex justify-end gap-3">
            <Link
              to="/events"
              className="rounded-lg border border-border bg-card px-4 py-2 text-sm font-medium text-muted-foreground transition hover:bg-muted"
            >
              Annuler
            </Link>
            <button
              type="submit"
              disabled={saving}
              className="rounded-lg bg-primary px-5 py-2 text-sm font-medium text-primary-foreground shadow-sm transition hover:brightness-95 disabled:opacity-50"
            >
              {saving ? 'Enregistrement...' : isEdit ? 'Mettre à jour' : 'Créer'}
            </button>
          </div>
        </form>
      </main>
    </div>
  );
}
