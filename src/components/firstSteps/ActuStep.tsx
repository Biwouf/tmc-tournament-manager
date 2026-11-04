import { useEffect, useRef, useState } from 'react';
import { actuImageProblem, clubPhotoForActu, DEFAULT_FOCAL_POINT, saveActu } from '../../lib/actuWrites';
import type { StepProps } from './FirstStepsFlow';

const DEFAULT_TITLE = 'Le club a sa nouvelle app !';
const DEFAULT_TEXT = 'Résultats des équipes, affiches des rencontres et matchs en direct : toute la vie du club est maintenant dans votre poche. Installez l’app sur votre écran d’accueil et suivez la saison avec nous.';

export default function ActuStep({ club, config, state, eyebrow, complete, next }: StepProps) {
  const [titre, setTitre] = useState(DEFAULT_TITLE);
  const [contenu, setContenu] = useState(DEFAULT_TEXT);
  const [photo, setPhoto] = useState<File | null>(null);
  const [photoError, setPhotoError] = useState<string | null>(null);
  const [titreError, setTitreError] = useState(false);
  const [contenuError, setContenuError] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [photoUrl, setPhotoUrl] = useState<string | null>(null);
  // Une relance après un échec reprend l'actu déjà créée au lieu d'en publier une seconde.
  const actuId = useRef<string | undefined>(undefined);
  const saved = useRef(false);
  const clubPhoto = config.home.hero_image;

  useEffect(() => {
    if (!photo) { setPhotoUrl(null); return; }
    const url = URL.createObjectURL(photo);
    setPhotoUrl(url);
    return () => URL.revokeObjectURL(url);
  }, [photo]);

  if (state.completed_steps.includes('actu')) {
    return <>
      <span className="fs-chip fs-chip-fill fs-pop">Étape terminée</span>
      <h2 className="fs-h" tabIndex={-1}>Votre première actu est en ligne.</h2>
      <p className="fs-lede">Elle est dans l’onglet Actu de l’app, et sera sur le site quand vous le publierez.</p>
      {next && <button type="button" className="fs-btn fs-btn-p" onClick={next.go}>Suivant : {next.label} →</button>}
    </>;
  }

  const choosePhoto = (file: File | undefined) => {
    if (!file) return;
    const problem = actuImageProblem(file);
    setPhotoError(problem);
    if (!problem) setPhoto(file);
  };

  const publish = async () => {
    const emptyTitle = !titre.trim(), emptyText = !contenu.trim();
    setTitreError(emptyTitle);
    setContenuError(emptyText);
    if (emptyTitle || emptyText) return;
    setSaving(true);
    setError(null);
    try {
      if (!saved.current) {
        const images = photo
          ? { keptImages: [], newImages: [{ file: photo, focalPoint: DEFAULT_FOCAL_POINT, caption: '' }] }
          : clubPhoto
            ? await clubPhotoForActu(clubPhoto, config.home.hero_image_focal)
            : { keptImages: [], newImages: [] };
        await saveActu(club.id, {
          id: actuId.current,
          titre: titre.trim(),
          contenu,
          publish: true,
          ...images,
          notify: true,
          onCreated: (id) => { actuId.current = id; },
        });
        saved.current = true;
      }
      const failure = await complete();
      if (failure) setError(`Votre actu est publiée, mais l’avancement n’a pas pu être enregistré. ${failure}`);
    } catch (err) {
      console.error('[premiers-pas] publication de l’actu impossible', err);
      setError('La publication n’a pas abouti. Vérifiez votre connexion puis réessayez.');
    } finally {
      setSaving(false);
    }
  };

  return <>
    <span className="fs-eyebrow">{eyebrow}</span>
    <h2 className="fs-h" tabIndex={-1}>Annoncez la nouvelle à vos adhérents.</h2>
    <p className="fs-lede">On vous a préparé un premier message. Modifiez-le si vous voulez, ajoutez une photo, publiez : il s’affiche aussitôt dans l’app.</p>
    <label className="fs-label">Titre
      <input className="fs-input" value={titre} aria-invalid={titreError} onChange={(e) => setTitre(e.target.value)} />
      {titreError && <span role="alert" className="fs-error">Titre obligatoire.</span>}
    </label>
    <label className="fs-label">Texte
      <textarea className="fs-input" rows={5} value={contenu} aria-invalid={contenuError} onChange={(e) => setContenu(e.target.value)} />
      {contenuError && <span role="alert" className="fs-error">Texte obligatoire.</span>}
    </label>
    <div className="fs-photo">
      <label className="fs-btn fs-btn-o fs-file">
        <input type="file" accept="image/jpeg,image/png" onChange={(e) => { choosePhoto(e.target.files?.[0]); e.target.value = ''; }} />
        {photo ? 'Photo ajoutée · changer' : 'Ajouter une photo'}
      </label>
      {photoUrl && <img src={photoUrl} alt="" className="fs-photo-thumb" />}
      {photo
        ? <button type="button" className="fs-link" onClick={() => setPhoto(null)}>Retirer la photo</button>
        : <span className="fs-note">{clubPhoto ? 'Sans photo, l’actu prend la photo du club.' : 'Photo facultative.'}</span>}
    </div>
    {photoError && <p role="alert" className="fs-error">{photoError}</p>}
    {error && <p role="alert" className="fs-error">{error}</p>}
    <button type="button" className="fs-btn fs-btn-p" disabled={saving} onClick={publish}>
      {saving ? 'Publication…' : 'Publier l’actu'}
    </button>
  </>;
}
