import { useEffect, useRef, useState } from 'react';
import TeamMatchImagePreview from '../TeamMatchImagePreview';
import EquipesPreview from './EquipesPreview';
import type { StepPreviewProps } from './FirstStepsFlow';
import { setStorySlot, useMediaQuery, usePosterPreview } from './posterSignal';

// SaaS S7 — aperçu de l'étape « Vos affiches ». Depuis W1, sur grand écran : l'emplacement où
// l'étape rend son aperçu animé de la story (portail, maquette `05d`). Sur petit écran, la story
// est dans l'étape et « Voir l'aperçu » montre l'affiche réelle (`TeamMatchImagePreview`, le rendu
// exporté). Sans rencontre cochée : l'onglet « Matchs équipes », comme l'étape précédente.

const POSTER_W = 1414;

function ScaledPoster() {
  const { matches, background, color, partnerLogos } = usePosterPreview();
  const box = useRef<HTMLDivElement>(null);
  const [scale, setScale] = useState(440 / POSTER_W);
  useEffect(() => {
    const node = box.current;
    if (!node) return;
    const measure = () => { if (node.clientWidth) setScale(node.clientWidth / POSTER_W); };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(node);
    return () => observer.disconnect();
  }, []);
  return (
    <div ref={box} className="fs-poster" role="img" aria-label={`Aperçu de l’affiche : ${matches.length} rencontre${matches.length > 1 ? 's' : ''}`}>
      <div style={{ width: POSTER_W, transform: `scale(${scale})`, transformOrigin: 'top left' }}>
        <TeamMatchImagePreview matches={matches} background={background} color={color} partnerLogos={partnerLogos} />
      </div>
    </div>
  );
}

export default function AffichesPreview(props: StepPreviewProps) {
  const { matches } = usePosterPreview();
  const wide = useMediaQuery('(min-width: 861px)');
  if (!matches.length) return <EquipesPreview {...props} />;
  if (wide) return <div ref={setStorySlot} className="fs-story-slot" />;
  return <div className="fs-poster-stage"><ScaledPoster /></div>;
}
