import { useEffect, useMemo, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { supabase } from '../lib/supabase';
import { useClub } from '../contexts/ClubContext';
import { invokeEdgeFunction } from '../lib/functions';
import { DEFAULT_FOCAL_POINT, clubPhotoForActu, saveActu, type ActuImage, type NewActuImage } from '../lib/actuWrites';
import { insertInlineImages } from '../lib/actuInlineImages';
import { STORAGE_BUCKETS, clubPath } from '../lib/storage';
import ActuGenerateImages, { type ActuImagePick, type ActuImagePicks } from '../components/ActuGenerateImages';
import { buildPostFacts, CONTEXTE_MAX, MAX_RENCONTRES, NOTE_MAX } from '../../shared/teamPostFacts.mjs';
import { useTeamSaisons } from '../components/teamMatches/useTeamSaisons';
import { useTeamSeasonGrid } from '../components/teamMatches/useTeamSeasonGrid';
import { competitionLabel, etapeLabelCourt } from '../components/teamMatches/teamMatchLabels';
import { formatRencontreDate } from '../components/teamMatches/poster/posterHelpers';
import type { RencontreEntry } from '../components/teamMatches/gridTypes';
import type { TeamMatchLine } from '../types';

// Génération d'une actu depuis des rencontres par équipe (docs/specs/ACTUS.md, « Génération
// depuis des rencontres ») : l'admin coche des rencontres, Claude rédige (Edge Function
// generate-post), l'admin ajuste puis crée un brouillon d'actu avec les visuels « Esprit d'équipe »
// et photos des rencontres cochés « À la une » (galerie) et/ou « Dans le texte ».

type Extras = Record<string, { note: string; contexte: string }>;
/** `anchors` : pour chaque rencontre, le paragraphe qui la raconte (y accrocher son visuel). */
type Generated = { titre: string; text: string; anchors: Record<string, string>; warnings: string[]; remaining: number | null };
type GenerateOptions = { length: 'short' | 'normal'; tone: 'fun' | 'serious'; consigne: string; previous?: string };

/** Rencontres proposées d'emblée ; les plus anciennes restent dans la liste, non cochées. */
const RECENT_DAYS = 7;

/** Visuel rendu en PNG → JPEG pour l'actu (fichier bien plus léger, même rendu). */
async function posterToJpeg(dataUrl: string): Promise<Blob> {
  const image = new Image();
  image.src = dataUrl;
  await image.decode();
  const canvas = document.createElement('canvas');
  canvas.width = image.naturalWidth;
  canvas.height = image.naturalHeight;
  canvas.getContext('2d')?.drawImage(image, 0, 0);
  const blob = await new Promise<Blob | null>(resolve => canvas.toBlob(resolve, 'image/jpeg', 0.9));
  if (!blob) throw new Error('conversion du visuel impossible');
  return blob;
}

/**
 * Image placée dans le texte, envoyée comme une image insérée depuis l'éditeur
 * (`content-images/<club>/inline/…`). Une photo est copiée (un capitaine peut retirer la sienne de
 * la rencontre) ; copie impossible : l'URL d'origine, plutôt que rien.
 */
async function uploadInline(clubId: string | null, pick: ActuImagePick, index: number): Promise<string> {
  let blob: Blob;
  try {
    blob = pick.kind === 'visuel' ? await posterToJpeg(pick.src) : await fetch(pick.src).then(r => { if (!r.ok) throw new Error(`HTTP ${r.status}`); return r.blob(); });
  } catch (err) {
    if (pick.kind === 'visuel') throw err;
    console.warn('[ActuGeneratePage] copie de la photo impossible', err);
    return pick.src;
  }
  const extension = blob.type === 'image/png' ? 'png' : blob.type === 'image/webp' ? 'webp' : 'jpg';
  const path = clubPath(clubId, 'inline', `${Date.now()}-${pick.kind === 'visuel' ? 'esprit-equipe' : 'photo'}-${index + 1}.${extension}`);
  const bucket = supabase.storage.from(STORAGE_BUCKETS.contentImages);
  const { error } = await bucket.upload(path, blob, { contentType: blob.type || 'image/jpeg', cacheControl: '3600' });
  if (error) throw error;
  return bucket.getPublicUrl(path).data.publicUrl;
}

export default function ActuGeneratePage() {
  const { saisons, error, ready, saisonId, selectSaison } = useTeamSaisons();
  return (
    <div className="min-h-screen bg-background text-foreground">
      <header className="border-b border-border bg-card">
        <div className="container mx-auto px-4 py-6">
          <Link to="/actus" className="text-sm text-muted-foreground hover:text-foreground">← Actus</Link>
          <h1 className="mt-2 text-3xl font-semibold tracking-tight">Actu depuis les rencontres</h1>
          <p className="mt-2 text-muted-foreground">Cochez les rencontres, générez le texte, ajustez-le puis créez le brouillon d’actu avec ses images.</p>
        </div>
      </header>
      <main className="container mx-auto max-w-3xl space-y-6 px-4 py-8">
        {error ? <p className="text-sm text-destructive">Erreur de chargement : {error}</p>
          : !ready ? <p className="text-sm text-muted-foreground">Chargement des saisons…</p>
          : saisons.length === 0 ? <p className="rounded-xl border border-dashed border-border p-8 text-center text-muted-foreground">Aucune saison de rencontres par équipe.</p>
          : <>
            <label className="flex items-center gap-3 text-sm font-medium">
              Saison
              <select value={saisonId} onChange={e => selectSaison(e.target.value)} className="rounded-lg border border-border bg-background px-3 py-2 text-sm font-normal">
                {saisons.map(s => <option key={s.id} value={s.id}>{s.label}{s.actif ? ' (active)' : ''}</option>)}
              </select>
            </label>
            <SeasonGenerator key={saisonId} saisonId={saisonId} />
          </>}
      </main>
    </div>
  );
}

function SeasonGenerator({ saisonId }: { saisonId: string }) {
  const { loading, error, entries } = useTeamSeasonGrid(saisonId);
  // Rencontres jouées (score saisi), les plus récentes d'abord.
  const played = useMemo(() => entries
    .filter(e => e.rencontre.score_club !== null && e.rencontre.score_adverse !== null)
    .sort((a, b) => b.rencontre.date_heure.localeCompare(a.rencontre.date_heure)), [entries]);
  if (loading) return <p className="text-sm text-muted-foreground">Chargement des rencontres…</p>;
  if (error) return <p className="text-sm text-destructive">Erreur de chargement : {error}</p>;
  if (played.length === 0) return <p className="rounded-xl border border-dashed border-border p-8 text-center text-muted-foreground">Aucune rencontre jouée sur cette saison.</p>;
  return <Generator played={played} />;
}

function Generator({ played }: { played: RencontreEntry[] }) {
  const { clubId } = useClub();
  const navigate = useNavigate();
  const [since] = useState(() => Date.now() - RECENT_DAYS * 24 * 60 * 60 * 1000);
  const [selected, setSelected] = useState<Set<string>>(() => new Set(played
    .filter(e => new Date(e.rencontre.date_heure).getTime() >= since).slice(0, MAX_RENCONTRES).map(e => e.rencontre.id)));
  const [extras, setExtras] = useState<Extras>({});
  const [lines, setLines] = useState<Record<string, TeamMatchLine[]>>({});
  const [images, setImages] = useState<ActuImagePicks>({ une: [], texte: [], ready: true });
  const [length, setLength] = useState<'short' | 'normal'>('short');
  const [tone, setTone] = useState<'fun' | 'serious'>('fun');
  const [consigne, setConsigne] = useState('');
  const [busy, setBusy] = useState(false);
  const [failure, setFailure] = useState('');
  const [result, setResult] = useState<Generated | null>(null);
  const [titre, setTitre] = useState('');
  const [text, setText] = useState('');
  const [copied, setCopied] = useState(false);
  const [saving, setSaving] = useState(false);

  const chosen = played.filter(e => selected.has(e.rencontre.id));
  const missingLines = chosen.filter(e => !lines[e.rencontre.id]).map(e => e.rencontre.id).join(',');

  // Matchs des rencontres cochées, pour l'aperçu des données envoyées.
  useEffect(() => {
    if (!missingLines) return;
    let cancelled = false;
    supabase.from('team_match_lines').select('*').eq('club_id', clubId).in('rencontre_id', missingLines.split(','))
      .then(({ data }) => {
        if (cancelled || !data) return;
        const byRencontre: Record<string, TeamMatchLine[]> = Object.fromEntries(missingLines.split(',').map(id => [id, []]));
        for (const line of data as TeamMatchLine[]) byRencontre[line.rencontre_id].push(line);
        setLines(previous => ({ ...previous, ...byRencontre }));
      });
    return () => { cancelled = true; };
  }, [missingLines, clubId]);

  const preview = useMemo(() => {
    if (chosen.some(e => !lines[e.rencontre.id])) return null;
    return buildPostFacts({ rencontres: chosen.map(e => ({ ...e, lines: lines[e.rencontre.id] })), extras });
  }, [chosen, lines, extras]);

  function toggle(id: string) {
    setSelected(previous => {
      const next = new Set(previous);
      if (!next.delete(id) && next.size < MAX_RENCONTRES) next.add(id);
      return next;
    });
  }

  function setExtra(id: string, field: 'note' | 'contexte', value: string) {
    setExtras(previous => {
      const current = previous[id] ?? { note: '', contexte: '' };
      return { ...previous, [id]: { ...current, [field]: value } };
    });
  }

  async function generate(options: GenerateOptions) {
    setBusy(true); setFailure(''); setCopied(false);
    const response = await invokeEdgeFunction<Generated>('generate-post', {
      club_id: clubId,
      rencontre_ids: chosen.map(e => e.rencontre.id),
      extras,
      length: options.length,
      tone: options.tone,
      consigne: options.consigne,
      previous: options.previous ?? '',
    }, 'Le texte n’a pas pu être généré.');
    setBusy(false);
    if (!response.success) { setFailure(response.error); return; }
    setResult(response);
    setTitre(response.titre);
    setText(response.text);
  }

  async function copy() {
    try { await navigator.clipboard.writeText(text); setCopied(true); }
    catch { setFailure('Copie impossible : sélectionnez le texte et copiez-le à la main.'); }
  }

  async function createDraft() {
    setSaving(true); setFailure('');
    try {
      // « Dans le texte » : après le paragraphe qui raconte la rencontre (repère de Claude).
      const inline = [];
      for (const [index, pick] of images.texte.entries()) {
        inline.push({ anchor: result?.anchors?.[pick.rencontreId], adversaire: pick.adversaire, url: await uploadInline(clubId, pick, index) });
      }
      // « À la une » : galerie de l'actu, dans l'ordre affiché. Visuels en JPEG ; photos copiées
      // (une copie impossible garde l'URL d'origine, cf. `clubPhotoForActu`).
      const keptImages: ActuImage[] = [];
      const newImages: NewActuImage[] = [];
      for (const [index, pick] of images.une.entries()) {
        if (pick.kind === 'visuel') {
          const file = new File([await posterToJpeg(pick.src)], `esprit-equipe-${index + 1}.jpg`, { type: 'image/jpeg' });
          newImages.push({ file, focalPoint: DEFAULT_FOCAL_POINT, caption: '' });
        } else {
          const copy = await clubPhotoForActu(pick.src);
          keptImages.push(...copy.keptImages);
          newImages.push(...copy.newImages);
        }
      }
      const id = await saveActu(clubId, {
        titre: titre.trim() || 'Résultats des équipes',
        contenu: insertInlineImages(text, inline),
        publish: false,
        keptImages,
        newImages,
        notify: false,
      });
      navigate(`/actus/${id}/edit`);
    } catch (err) {
      setSaving(false);
      setFailure(`Le brouillon n’a pas pu être créé : ${err instanceof Error ? err.message : 'erreur inconnue'}.`);
    }
  }

  const field = 'w-full rounded-lg border border-border bg-background px-3 py-2 text-sm';
  const secondary = 'rounded-lg border border-border bg-card px-4 py-2 text-sm font-medium transition hover:bg-muted disabled:opacity-50';
  return (
    <div className="space-y-6">
      <fieldset className="min-w-0 rounded-2xl border border-border bg-card p-4 shadow-sm sm:p-5">
        <legend className="sr-only">Rencontres jouées</legend>
        <p className="font-semibold">Rencontres</p>
        <p className="mb-3 text-xs text-muted-foreground">{selected.size} sélectionnée{selected.size > 1 ? 's' : ''} · {MAX_RENCONTRES} au plus</p>
        <ul className="max-h-96 space-y-2 overflow-y-auto">
          {played.map(entry => {
            const { rencontre, etape, equipe, competition } = entry;
            const checked = selected.has(rencontre.id);
            return (
              <li key={rencontre.id} className={`rounded-xl border px-3 py-2.5 ${checked ? 'border-primary bg-primary/5' : 'border-border'}`}>
                <label className="flex cursor-pointer items-center gap-3">
                  <input type="checkbox" checked={checked} onChange={() => toggle(rencontre.id)} className="h-4 w-4 shrink-0 accent-primary" />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-sm font-semibold">{rencontre.club_adverse}</span>
                    <span className="block truncate text-xs text-muted-foreground">
                      {formatRencontreDate(rencontre.date_heure)} · Éq. {equipe.numero} {etapeLabelCourt(etape)} · {competitionLabel(competition)}
                      {rencontre.photo_urls.length > 0 && ` · ${rencontre.photo_urls.length} photo${rencontre.photo_urls.length > 1 ? 's' : ''}`}
                    </span>
                  </span>
                  <span className="shrink-0 text-xs font-semibold tabular-nums">{rencontre.wo ? 'WO ' : ''}{rencontre.score_club}–{rencontre.score_adverse}</span>
                </label>
                {checked && (
                  <div className="mt-2 grid gap-2 pl-7 sm:grid-cols-2">
                    <input className={field} maxLength={NOTE_MAX} placeholder="Note (facultatif) : premier match en équipe adulte…" value={extras[rencontre.id]?.note ?? ''} onChange={e => setExtra(rencontre.id, 'note', e.target.value)} />
                    <input className={field} maxLength={CONTEXTE_MAX} placeholder="Classement (facultatif) : 1re place en jeu…" value={extras[rencontre.id]?.contexte ?? ''} onChange={e => setExtra(rencontre.id, 'contexte', e.target.value)} />
                  </div>
                )}
              </li>
            );
          })}
        </ul>
      </fieldset>

      <ActuGenerateImages chosen={chosen} lines={lines} onChange={setImages} />

      <section className="space-y-4 rounded-2xl border border-border bg-card p-4 shadow-sm sm:p-5">
        <div className="flex flex-wrap gap-4 text-sm">
          <label className="flex items-center gap-2">Longueur
            <select value={length} onChange={e => setLength(e.target.value as 'short' | 'normal')} className="rounded-lg border border-border bg-background px-2 py-1.5">
              <option value="short">Courte</option><option value="normal">Normale</option>
            </select>
          </label>
          <label className="flex items-center gap-2">Ton
            <select value={tone} onChange={e => setTone(e.target.value as 'fun' | 'serious')} className="rounded-lg border border-border bg-background px-2 py-1.5">
              <option value="fun">Familial et fun</option><option value="serious">Sérieux</option>
            </select>
          </label>
        </div>
        <label className="block text-sm">Consigne (facultatif)
          <textarea className={`${field} mt-1`} rows={2} maxLength={500} value={consigne} onChange={e => setConsigne(e.target.value)} placeholder="Ex. : insister sur la montée en régionale" />
        </label>
        <details className="text-sm">
          <summary className="cursor-pointer text-muted-foreground">Aperçu des données envoyées à l’IA</summary>
          <p className="mt-2 text-xs text-muted-foreground">Seuls les prénoms partent : ni nom de famille, ni classement, ni joueur adverse, ni photo.</p>
          <pre className="mt-2 max-h-80 overflow-auto rounded-lg bg-muted p-3 text-xs">{preview ? JSON.stringify(preview.facts, null, 2) : 'Chargement des matchs…'}</pre>
        </details>
        <button type="button" disabled={busy || selected.size === 0} onClick={() => generate({ length, tone, consigne })}
          className="rounded-lg bg-primary px-5 py-2.5 text-sm font-semibold text-primary-foreground shadow-sm disabled:opacity-50">
          {busy ? 'Génération…' : result ? 'Régénérer avec la consigne' : 'Générer la publication'}
        </button>
        {failure && <p role="alert" className="rounded-lg border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm text-destructive">{failure}</p>}
      </section>

      {result && (
        <section className="space-y-4 rounded-2xl border border-border bg-card p-4 shadow-sm sm:p-5">
          {result.warnings.length > 0 && (
            <div role="status" className="rounded-lg border border-amber-400 bg-amber-50 px-3 py-2 text-sm text-amber-900 dark:bg-amber-950 dark:text-amber-100">
              <p className="font-semibold">À vérifier avant de publier</p>
              <ul className="mt-1 list-disc space-y-1 pl-5">{result.warnings.map(w => <li key={w}>{w}</li>)}</ul>
            </div>
          )}
          <label className="block text-sm font-medium">Titre
            <input className={`${field} mt-1`} value={titre} maxLength={120} onChange={e => setTitre(e.target.value)} />
          </label>
          <label className="block text-sm font-medium">Texte
            <textarea className={`${field} mt-1 font-normal`} rows={14} value={text} onChange={e => setText(e.target.value)} />
          </label>
          <div className="flex flex-wrap gap-2">
            <button type="button" className={secondary} onClick={copy}>{copied ? 'Copié ✓' : 'Copier'}</button>
            <button type="button" className={secondary} disabled={busy} onClick={() => generate({ length: 'short', tone, consigne: 'Raccourcis nettement ce texte.', previous: text })}>Plus court</button>
            <button type="button" className={secondary} disabled={busy} onClick={() => { setTone('serious'); generate({ length, tone: 'serious', consigne: 'Rends le ton plus sobre et plus sérieux.', previous: text }); }}>Plus sérieux</button>
            <button type="button" disabled={saving || !text.trim() || !images.ready} onClick={createDraft}
              className="ml-auto rounded-lg bg-primary px-5 py-2 text-sm font-semibold text-primary-foreground disabled:opacity-50">
              {saving ? 'Création…' : !images.ready ? 'Préparation des visuels…' : `Créer le brouillon d’actu${images.une.length + images.texte.length ? ` (${images.une.length} à la une, ${images.texte.length} dans le texte)` : ''}`}
            </button>
          </div>
          {result.remaining !== null && <p className="text-xs text-muted-foreground">Générations restantes ce mois-ci : {result.remaining}</p>}
        </section>
      )}
    </div>
  );
}
