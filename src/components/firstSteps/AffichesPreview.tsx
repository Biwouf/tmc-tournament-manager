import { useEffect, useRef, useState } from 'react';
import TeamMatchImagePreview from '../TeamMatchImagePreview';
import ActuPreview from './ActuPreview';
import type { StepPreviewProps } from './FirstStepsFlow';
import { usePosterPreview } from './posterSignal';

// SaaS S7 — aperçu de l'étape « Vos affiches » (maquette `Stepper.dc.html`) : l'affiche réelle
// (`TeamMatchImagePreview`, le rendu exporté) à la place du téléphone ; une fois l'affiche générée,
// le téléphone revient avec l'onglet Actu, où l'affiche apparaît si elle est publiée.

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
  const { matches, generated, published } = usePosterPreview();
  if (!matches.length) return <ActuPreview {...props} />;
  return (
    <div className="fs-poster-stage">
      <ScaledPoster />
      {generated && <div className="fs-poster-phone"><ActuPreview {...props} version={props.version + published} /></div>}
    </div>
  );
}
