import { useEffect, useMemo, useRef, useState } from 'react';
import { useClub } from '../../../contexts/ClubContext';
import { useClubConfig } from '../../../hooks/useClubConfig';
import type { TeamCompetition, TeamEquipe, TeamEtape, TeamMatchLine, TeamRencontre } from '../../../types';
import { competitionLabel, etapeLabel } from '../teamMatchLabels';
import PhotoFocusPicker from './PhotoFocusPicker';
import { finalResult } from './resultPoster';
import { renderResultPoster, type ResultPosterInput } from './renderResultPoster';

interface Props {
  rencontre: TeamRencontre;
  lines: TeamMatchLine[];
  competition: TeamCompetition;
  equipe: TeamEquipe;
  etape: TeamEtape;
}
const button = 'rounded-lg border border-border bg-card px-4 py-2 text-sm font-medium hover:bg-muted disabled:opacity-50';

export default function ResultPosterSection(props: Props) {
  const [open, setOpen] = useState(false);
  const result = finalResult(props.rencontre, props.lines, props.competition.format);
  return <section className="rounded-2xl border bg-card/90 p-6 shadow-sm">
    <div className="flex flex-wrap items-center justify-between gap-3">
      <h2 className="text-xs font-semibold uppercase tracking-[0.08em] text-primary">Visuel du résultat</h2>
      <button type="button" className={button} disabled={!result} aria-expanded={open && !!result} onClick={() => setOpen(!open)}>
        {open ? 'Fermer l’aperçu' : 'Générer le visuel'}
      </button>
    </div>
    {!result && <p className="mt-3 text-sm text-muted-foreground">Disponible après le résultat de tous les matchs, ou après la saisie du score final d’une rencontre sans détail.</p>}
    {open && result && <ResultPosterEditor {...props} result={result} />}
  </section>;
}

function ResultPosterEditor({ rencontre, lines, competition, equipe, etape, result }: Props & { result: { club: number; adverse: number } }) {
  const { config, loading } = useClubConfig();
  const { club } = useClub();
  const [model, setModel] = useState<'photo' | 'details'>('details');
  const [photo, setPhoto] = useState(rencontre.photo_urls[0] || '');
  const [crop, setCrop] = useState({ x: 50, y: 50, zoom: 1 });
  const [uploadError, setUploadError] = useState('');
  const [uploading, setUploading] = useState(false);
  const [retry, setRetry] = useState(0);
  const uploadRequest = useRef(0);
  const [rendered, setRendered] = useState<{ input: ResultPosterInput; url?: string; error?: string } | null>(null);
  const input = useMemo<ResultPosterInput>(() => ({ rencontre, lines, config, result, model, photo, crop,
    clubName: config.brand.name || club?.name || 'Notre club',
    heading: competitionLabel(competition), stage: `Équipe ${equipe.numero} · ${etapeLabel(etape)}`,
  }), [rencontre, lines, config, result, model, photo, crop, club, competition, equipe.numero, etape]);
  const partnerCount = config.partners.filter(partner => partner.logo || partner.name).length;
  const frameHeight = 1350 - Math.max(190, 76 + Math.ceil(partnerCount / 4) * 92) - 150;
  const needsPhoto = model === 'photo' && !photo;
  useEffect(() => {
    if (loading || needsPhoto) return;
    let cancelled = false;
    // Debounce the crop sliders; an outdated render must never replace the latest preview.
    const timer = window.setTimeout(() => {
      renderResultPoster(input).then(url => {
        if (!cancelled) setRendered({ input, url });
      }).catch((error: unknown) => {
        if (!cancelled) setRendered({ input, error: error instanceof Error ? error.message : 'Impossible de générer le visuel.' });
      });
    }, 180);
    return () => { cancelled = true; clearTimeout(timer); };
  }, [input, loading, needsPhoto, retry]);
  useEffect(() => () => { uploadRequest.current++; }, []);
  const current = rendered?.input === input && !loading && !needsPhoto;
  const url = current ? rendered?.url : undefined;
  const error = current ? rendered?.error : undefined;
  function choosePhoto(value: string) {
    uploadRequest.current++;
    setPhoto(value); setCrop({ x: 50, y: 50, zoom: 1 }); setUploadError(''); setUploading(false);
  }
  async function importPhoto(file?: File) {
    if (!file) return;
    const request = ++uploadRequest.current;
    setUploadError('');
    if (!['image/jpeg', 'image/png', 'image/webp'].includes(file.type) || file.size > 10 * 1024 * 1024) {
      setUploading(false); setUploadError('Choisissez une image JPEG, PNG ou WebP de 10 Mo maximum.'); return;
    }
    setUploading(true);
    try {
      const value = await new Promise<string>((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(String(reader.result)); reader.onerror = () => reject(new Error('Lecture impossible.'));
        reader.readAsDataURL(file);
      });
      // Decode before replacing the current valid photo.
      const image = new Image(); image.src = value; await image.decode();
      if (request === uploadRequest.current) choosePhoto(value);
    } catch {
      if (request === uploadRequest.current) setUploadError('Cette image ne peut pas être lue. Essayez un autre fichier.');
    } finally { if (request === uploadRequest.current) setUploading(false); }
  }
  return <div className="mt-5 space-y-5">
    <fieldset className="flex flex-wrap gap-4">
      <legend className="mb-2 text-sm font-medium">Modèle</legend>
      <label className="flex items-center gap-2"><input type="radio" name="result-model" checked={model === 'photo'} onChange={() => setModel('photo')} />Esprit d’équipe</label>
      <label className="flex items-center gap-2"><input type="radio" name="result-model" checked={model === 'details'} onChange={() => setModel('details')} />Résultats détaillés</label>
    </fieldset>
    {model === 'photo' && <div className="space-y-4">
      {rencontre.photo_urls.length > 0 && <label className="block text-sm font-medium">Photo de la rencontre
        <select className="mt-1 block w-full rounded-lg border bg-background p-2" value={rencontre.photo_urls.includes(photo) ? photo : ''} onChange={event => choosePhoto(event.target.value)}>
          <option value="" disabled>Choisir une photo</option>
          {rencontre.photo_urls.map((value, index) => <option key={value} value={value}>Photo {index + 1}</option>)}
        </select>
      </label>}
      <label className="block text-sm font-medium">Importer ma propre image
        <input type="file" accept="image/jpeg,image/png,image/webp" className="mt-2 block w-full text-sm" onChange={event => { void importPhoto(event.target.files?.[0]); event.target.value = ''; }} />
      </label>
      <p className="text-xs text-muted-foreground">JPEG, PNG ou WebP · 10 Mo maximum. L’image importée reste dans cet aperçu jusqu’à sa fermeture.</p>
      {uploading && <p role="status">Lecture de l’image…</p>}
      {uploadError && <p role="alert" className="text-sm text-red-600">{uploadError}</p>}
      {photo && <fieldset className="grid gap-3 sm:grid-cols-3"><legend className="mb-2 text-sm font-medium">Cadrage</legend>
        {(['x', 'y', 'zoom'] as const).map(key => <label key={key} className="text-sm">
          {key === 'x' ? 'Focus horizontal' : key === 'y' ? 'Focus vertical' : 'Zoom'}
          <input aria-label={key === 'x' ? 'Focus horizontal' : key === 'y' ? 'Focus vertical' : 'Zoom'} type="range" className="mt-2 block w-full" min={key === 'zoom' ? 1 : 0} max={key === 'zoom' ? 3 : 100} step={key === 'zoom' ? 0.05 : 1} value={crop[key]} onChange={event => setCrop(previous => ({ ...previous, [key]: Number(event.target.value) }))} />
        </label>)}
      </fieldset>}
    </div>}
    {model === 'photo' && photo && <PhotoFocusPicker key={photo} photo={photo} crop={crop} frameHeight={frameHeight} onChange={setCrop} />}
    <p className="text-xs text-muted-foreground">PNG · 1080 × 1350 px · couleurs, logo et partenaires du club inclus.</p>
    {needsPhoto ? <p role="status" className="text-sm">Choisissez ou importez une photo pour afficher ce modèle.</p> : error ? <p role="alert" className="text-sm text-red-600">{error}</p> : !url ? <p role="status" className="text-sm">Préparation de l’aperçu…</p> : <img src={url} alt={`Aperçu du résultat : ${input.clubName} ${result.club} – ${result.adverse} ${rencontre.club_adverse}`} className="mx-auto w-full max-w-md rounded-lg border" />}
    {error && <button type="button" className={button} onClick={() => { setRendered(null); setRetry(previous => previous + 1); }}>Réessayer</button>}
    {url && !uploading && <a href={url} download={`resultat-${rencontre.id}-${model}.png`} className="inline-block rounded-lg bg-primary px-5 py-2.5 text-sm font-semibold text-primary-foreground">Télécharger le PNG</a>}
  </div>;
}
