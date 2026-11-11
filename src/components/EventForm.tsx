import { useState, useEffect, useMemo } from 'react';
import { useNavigate, useParams, Link } from 'react-router-dom';
import { supabase } from '../lib/supabase';
import { useClub } from '../contexts/ClubContext';
import MarkdownEditor from './MarkdownEditor';
import { EVENT_TYPES, type ClubEvent, type EventSection, type EventType } from '../types';
import {
  STORAGE_BUCKETS,
  clubPath,
  extractStoragePath,
  sanitizeFilename,
} from '../lib/storage';

const MAX_IMAGE_SIZE = 5 * 1024 * 1024;
const ACCEPTED_IMAGE_TYPES = ['image/jpeg', 'image/png'];
const STORAGE_BUCKET = STORAGE_BUCKETS.eventImages;

function isoToLocalInput(iso: string | null): string {
  if (!iso) return '';
  const d = new Date(iso);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

function localInputToIso(value: string): string {
  return new Date(value).toISOString();
}

interface SectionDraft {
  key: string;
  id: string | null; // null = section pas encore enregistrée
  titre: string;
  heure: string; // datetime-local
  prix: string;
  capacity: string;
}

let draftKey = 0;
const newDraft = (): SectionDraft => ({ key: `new-${++draftKey}`, id: null, titre: '', heure: '', prix: '', capacity: '' });

interface FieldErrors {
  titre?: string;
  description?: string;
  date_debut?: string;
  date_fin?: string;
  image?: string;
  prix?: string;
  registration?: string;
  sections?: string;
}

export default function EventForm() {
  const { id } = useParams();
  const isEdit = Boolean(id);
  const navigate = useNavigate();
  const { clubId } = useClub();

  const [loading, setLoading] = useState(isEdit);
  const [saving, setSaving] = useState(false);

  const [type, setType] = useState<EventType>('Animation');
  const [titre, setTitre] = useState('');
  const [description, setDescription] = useState('');
  const [dateDebut, setDateDebut] = useState('');
  const [dateFin, setDateFin] = useState('');
  const [prix, setPrix] = useState('');
  const [notifyMembers, setNotifyMembers] = useState(true);
  const [regEnabled, setRegEnabled] = useState(false);
  const [regMax, setRegMax] = useState('1');
  const [regCapacity, setRegCapacity] = useState('');
  const [regDeadline, setRegDeadline] = useState('');
  const [sections, setSections] = useState<SectionDraft[]>([]);
  const [savedSectionIds, setSavedSectionIds] = useState<string[]>([]);

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
      .eq('club_id', clubId)
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
        setRegEnabled(ev.registration_enabled);
        setRegMax(String(ev.registration_max_per_member));
        setRegCapacity(ev.registration_capacity === null ? '' : String(ev.registration_capacity));
        setRegDeadline(isoToLocalInput(ev.registration_deadline));
      })
      .then(() =>
        supabase.from('event_sections').select('*').eq('event_id', id).order('position').order('id'),
      )
      .then(({ data }) => {
        const rows = (data ?? []) as EventSection[];
        setSections(
          rows.map((r) => ({
            key: r.id,
            id: r.id,
            titre: r.titre,
            heure: isoToLocalInput(r.heure_debut),
            prix: r.prix === null ? '' : String(r.prix),
            capacity: r.capacity === null ? '' : String(r.capacity),
          })),
        );
        setSavedSectionIds(rows.map((r) => r.id));
        setLoading(false);
      });
  }, [id, isEdit, clubId]);

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
    const max = Number(regMax);
    if (!Number.isInteger(max) || max < 1 || max > 50) {
      errs.registration = 'Le nombre de places par réservation doit être un entier entre 1 et 50.';
    } else if (regCapacity && (!Number.isInteger(Number(regCapacity)) || Number(regCapacity) < 1)) {
      errs.registration = 'La jauge doit être un entier supérieur ou égal à 1.';
    } else if (regDeadline && dateDebut && new Date(regDeadline) > new Date(dateDebut)) {
      errs.registration = "La date limite d'inscription doit précéder le début de l'événement.";
    }
    if (sections.some((sec) => !sec.titre.trim())) {
      errs.sections = 'Chaque section doit avoir un titre.';
    } else if (sections.some((sec) => sec.prix && (isNaN(Number(sec.prix)) || Number(sec.prix) < 0))) {
      errs.sections = "Le prix d'une section doit être un nombre positif.";
    } else if (
      sections.some((sec) => sec.capacity && (!Number.isInteger(Number(sec.capacity)) || Number(sec.capacity) < 1))
    ) {
      errs.sections = "La jauge d'une section doit être un entier supérieur ou égal à 1.";
    }
    return errs;
  };

  const updateSection = (key: string, patch: Partial<SectionDraft>) =>
    setSections((list) => list.map((sec) => (sec.key === key ? { ...sec, ...patch } : sec)));

  const moveSection = (index: number, delta: number) =>
    setSections((list) => {
      const next = [...list];
      const [item] = next.splice(index, 1);
      next.splice(index + delta, 0, item);
      return next;
    });

  // Supprime d'abord les sections retirées : refusé (23503) si quelqu'un l'a choisie explicitement.
  const deleteRemovedSections = async () => {
    const kept = new Set(sections.map((sec) => sec.id).filter(Boolean));
    for (const sectionId of savedSectionIds.filter((sid) => !kept.has(sid))) {
      const { error } = await supabase.from('event_sections').delete().eq('id', sectionId).eq('club_id', clubId);
      if (error?.code === '23503') {
        throw new Error(
          'Une section retirée a des inscrits qui l’ont choisie : retirez-les ou changez leurs sections avant de la supprimer.',
        );
      }
      if (error) throw error;
    }
  };

  const saveSections = async (eventId: string) => {
    const rows = sections.map((sec, position) => ({
      titre: sec.titre.trim(),
      position,
      heure_debut: sec.heure ? localInputToIso(sec.heure) : null,
      prix: sec.prix === '' ? null : Number(sec.prix),
      capacity: sec.capacity === '' ? null : Number(sec.capacity),
    }));
    for (const [i, sec] of sections.entries()) {
      if (!sec.id) continue;
      const { error } = await supabase.from('event_sections').update(rows[i]).eq('id', sec.id).eq('club_id', clubId);
      if (error) throw error;
    }
    const inserts = sections.flatMap((sec, i) => (sec.id ? [] : [{ ...rows[i], event_id: eventId, club_id: clubId }]));
    if (inserts.length) {
      const { error } = await supabase.from('event_sections').insert(inserts);
      if (error) throw error;
    }
  };

  const uploadImage = async (file: File, eventId: string): Promise<string> => {
    const path = clubPath(clubId, eventId, `${Date.now()}-${sanitizeFilename(file.name)}`);
    const { error } = await supabase.storage.from(STORAGE_BUCKET).upload(path, file, {
      contentType: file.type,
      cacheControl: '3600',
    });
    if (error) throw error;
    const { data } = supabase.storage.from(STORAGE_BUCKET).getPublicUrl(path);
    return data.publicUrl;
  };

  const deleteStorageFile = async (publicUrl: string) => {
    const path = extractStoragePath(STORAGE_BUCKET, publicUrl);
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
        registration_enabled: regEnabled,
        registration_max_per_member: Number(regMax),
        registration_capacity: regCapacity === '' ? null : Number(regCapacity),
        registration_deadline: regDeadline ? localInputToIso(regDeadline) : null,
      };

      let targetId = id;

      if (isEdit && targetId) {
        await deleteRemovedSections();
        const { error: updateErr } = await supabase
          .from('events')
          .update(basePayload)
          .eq('id', targetId)
          .eq('club_id', clubId);
        if (updateErr) throw updateErr;
      } else {
        const { data, error: insertErr } = await supabase
          .from('events')
          .insert({ ...basePayload, image_url: null, club_id: clubId })
          .select('id')
          .single();
        if (insertErr || !data) throw insertErr ?? new Error('Insert failed');
        targetId = data.id;
      }

      if (!targetId) throw new Error('Identifiant événement manquant');
      await saveSections(targetId);

      // Image precedence: uploaded file > remove > keep.
      let finalImageUrl = existingImageUrl;

      if (imageFile) {
        if (existingImageUrl) await deleteStorageFile(existingImageUrl);
        finalImageUrl = await uploadImage(imageFile, targetId);
      } else if (removeExistingImage && existingImageUrl) {
        await deleteStorageFile(existingImageUrl);
        finalImageUrl = null;
      }

      if (finalImageUrl !== existingImageUrl) {
        const { error: imgErr } = await supabase
          .from('events')
          .update({ image_url: finalImageUrl })
          .eq('id', targetId)
          .eq('club_id', clubId);
        if (imgErr) throw imgErr;
      }

      // La notification ne bloque jamais l'enregistrement (au pire, pas de notification).
      if (!isEdit && notifyMembers) {
        await supabase.rpc('content_push_announce', { p_club: clubId, p_kind: 'event', p_id: targetId });
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
            <label className="block text-sm font-medium text-foreground">Description * (Markdown)</label>
            <MarkdownEditor
              value={description}
              onChange={setDescription}
              rows={10}
              placeholder="**gras**, *italique*, - liste, # titre..."
            />
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
            {sections.length > 0 && (
              <p className="mt-1 text-xs text-muted-foreground">
                Prix de l'événement complet, affiché dans la liste. Chaque section a son propre prix.
              </p>
            )}
            {errors.prix && <p className="mt-1 text-xs text-red-600">{errors.prix}</p>}
          </div>

          {/* Sections */}
          <fieldset className="space-y-3 rounded-xl border border-border p-4">
            <legend className="px-2 text-sm font-medium text-foreground">Sections</legend>
            <p className="text-xs text-muted-foreground">
              Pour un événement en plusieurs temps (ex. animation puis repas). Chaque personne inscrite choisit
              tout l'événement ou certaines sections. Sans section, on s'inscrit à l'événement entier.
            </p>
            {sections.map((sec, index) => (
              <div key={sec.key} className="space-y-3 rounded-lg border border-border bg-background/60 p-3">
                <div className="flex items-center gap-2">
                  <input
                    type="text"
                    value={sec.titre}
                    placeholder="Titre de la section (ex. Repas)"
                    onChange={(e) => updateSection(sec.key, { titre: e.target.value })}
                    className="block w-full rounded-lg border border-border bg-background px-3 py-2 text-sm"
                  />
                  <button
                    type="button"
                    title="Monter"
                    disabled={index === 0}
                    onClick={() => moveSection(index, -1)}
                    className="rounded-lg border border-border px-2 py-1.5 text-sm text-muted-foreground transition hover:bg-muted disabled:opacity-30"
                  >
                    ↑
                  </button>
                  <button
                    type="button"
                    title="Descendre"
                    disabled={index === sections.length - 1}
                    onClick={() => moveSection(index, 1)}
                    className="rounded-lg border border-border px-2 py-1.5 text-sm text-muted-foreground transition hover:bg-muted disabled:opacity-30"
                  >
                    ↓
                  </button>
                  <button
                    type="button"
                    onClick={() => setSections((list) => list.filter((x) => x.key !== sec.key))}
                    className="rounded-lg border border-red-200 bg-red-50 px-3 py-1.5 text-sm font-medium text-red-700 transition hover:bg-red-100"
                  >
                    Retirer
                  </button>
                </div>
                <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
                  <div>
                    <label className="block text-xs font-medium text-foreground">
                      Début <span className="text-muted-foreground">(optionnel)</span>
                    </label>
                    <input
                      type="datetime-local"
                      value={sec.heure}
                      onChange={(e) => updateSection(sec.key, { heure: e.target.value })}
                      className="mt-1 block w-full rounded-lg border border-border bg-background px-3 py-2 text-sm"
                    />
                  </div>
                  <div>
                    <label className="block text-xs font-medium text-foreground">Prix (€)</label>
                    <input
                      type="number"
                      min="0"
                      step="0.01"
                      value={sec.prix}
                      placeholder="Gratuit"
                      onChange={(e) => updateSection(sec.key, { prix: e.target.value })}
                      className="mt-1 block w-full rounded-lg border border-border bg-background px-3 py-2 text-sm"
                    />
                  </div>
                  <div>
                    <label className="block text-xs font-medium text-foreground">Jauge</label>
                    <input
                      type="number"
                      min="1"
                      step="1"
                      value={sec.capacity}
                      placeholder="Illimitée"
                      onChange={(e) => updateSection(sec.key, { capacity: e.target.value })}
                      className="mt-1 block w-full rounded-lg border border-border bg-background px-3 py-2 text-sm"
                    />
                  </div>
                </div>
              </div>
            ))}
            <button
              type="button"
              onClick={() => setSections((list) => [...list, newDraft()])}
              className="rounded-lg border border-border bg-card px-3 py-1.5 text-sm font-medium text-muted-foreground transition hover:bg-muted"
            >
              + Ajouter une section
            </button>
            {errors.sections && <p className="text-xs text-red-600">{errors.sections}</p>}
          </fieldset>

          {/* Inscriptions */}
          <fieldset className="space-y-4 rounded-xl border border-border p-4">
            <legend className="px-2 text-sm font-medium text-foreground">Inscriptions</legend>
            <label className="flex items-center gap-2 text-sm text-foreground">
              <input type="checkbox" checked={regEnabled} onChange={(e) => setRegEnabled(e.target.checked)} />
              Inscription en ligne depuis l'application des membres
            </label>
            <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
              <div>
                <label className="block text-sm font-medium text-foreground">Places max par réservation</label>
                <input
                  type="number"
                  min="1"
                  max="50"
                  step="1"
                  value={regMax}
                  onChange={(e) => setRegMax(e.target.value)}
                  className="mt-1 block w-full rounded-lg border border-border bg-background px-3 py-2 text-sm"
                />
                <p className="mt-1 text-xs text-muted-foreground">Le membre compris (1 = seul).</p>
              </div>
              <div>
                <label className="block text-sm font-medium text-foreground">
                  Jauge totale <span className="text-muted-foreground">(optionnel)</span>
                </label>
                <input
                  type="number"
                  min="1"
                  step="1"
                  value={regCapacity}
                  placeholder="Illimitée"
                  onChange={(e) => setRegCapacity(e.target.value)}
                  className="mt-1 block w-full rounded-lg border border-border bg-background px-3 py-2 text-sm"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-foreground">
                  Date limite <span className="text-muted-foreground">(optionnel)</span>
                </label>
                <input
                  type="datetime-local"
                  value={regDeadline}
                  onChange={(e) => setRegDeadline(e.target.value)}
                  className="mt-1 block w-full rounded-lg border border-border bg-background px-3 py-2 text-sm"
                />
                <p className="mt-1 text-xs text-muted-foreground">Vide = jusqu'au début de l'événement.</p>
              </div>
            </div>
            {errors.registration && <p className="text-xs text-red-600">{errors.registration}</p>}
          </fieldset>

          {!isEdit && (
            <label className="flex items-center gap-2 text-sm text-foreground">
              <input
                type="checkbox"
                checked={notifyMembers}
                disabled={saving}
                onChange={(e) => setNotifyMembers(e.target.checked)}
              />
              Envoyer une notification aux membres du club
            </label>
          )}

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
