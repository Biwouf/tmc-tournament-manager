import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { encode } from 'uqr';
import { clubAppHost } from '../../lib/firstSteps';
import type { StepProps } from './FirstStepsFlow';

/** QR code réel, en SVG : modules sombres sur fond blanc quelle que soit la couleur du club, pour
 *  rester lisible par un téléphone. La marge blanche fait partie du code (`border`). */
function QrCode({ value }: { value: string }) {
  const { path, size } = useMemo(() => {
    const qr = encode(value, { ecc: 'M', border: 3 });
    let d = '';
    qr.data.forEach((row, y) => row.forEach((dark, x) => { if (dark) d += `M${x} ${y}h1v1h-1z`; }));
    return { path: d, size: qr.size };
  }, [value]);
  return (
    <svg role="img" aria-label="QR code vers l'app" viewBox={`0 0 ${size} ${size}`} shapeRendering="crispEdges" className="fs-qr">
      <rect width={size} height={size} fill="#fff" />
      <path d={path} fill="#2a201f" />
    </svg>
  );
}

export default function FinalStep({ club, state, steps, finish }: StepProps) {
  const host = clubAppHost(club.slug);
  const [copy, setCopy] = useState<'idle' | 'copied' | 'failed'>('idle');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const recap = steps.flatMap((step) => (step.recap ? [{ id: step.id, ok: step.isDone(state), ...step.recap }] : []));

  const copyLink = async () => {
    try {
      await navigator.clipboard.writeText(`https://${host}`);
      setCopy('copied');
    } catch {
      setCopy('failed');
    }
  };
  const goToDashboard = async () => {
    setBusy(true);
    setError(await finish());
    setBusy(false);
  };

  return <>
    <span className="fs-chip fs-chip-fill fs-pop">C’est prêt</span>
    <h2 className="fs-h" tabIndex={-1}>Votre app est prête.</h2>
    <ul className="fs-recap">
      {recap.map((item) => (
        <li key={item.id}>
          <span aria-hidden="true" className={item.ok ? 'fs-mark ok' : 'fs-mark'}>{item.ok ? '✓' : '·'}</span>
          {item.ok ? item.done : item.todo}
        </li>
      ))}
    </ul>
    <div className="fs-share">
      <QrCode value={`https://${host}`} />
      <div className="fs-share-body">
        <a className="fs-share-host" href={`https://${host}`} target="_blank" rel="noopener noreferrer">{host}</a>
        <span className="fs-note">Partagez-la sur le groupe du club : vos adhérents l’installent en 2 secondes.</span>
        <button type="button" className="fs-btn fs-btn-o fs-btn-small" onClick={copyLink}>
          {copy === 'copied' ? 'Lien copié ✓' : 'Copier le lien'}
        </button>
        {copy === 'failed' && <span role="alert" className="fs-error">Copie impossible : sélectionnez l’adresse ci-dessus.</span>}
      </div>
    </div>
    <div className="fs-todo">
      <span className="fs-label">Pour finir d’installer le club</span>
      <span className="fs-note">Votre site et votre bureau vous attendent dans la checklist du tableau de bord.</span>
    </div>
    {error && <p role="alert" className="fs-error">{error}</p>}
    <button type="button" className="fs-btn fs-btn-p" disabled={busy} onClick={goToDashboard}>Aller au tableau de bord</button>
  </>;
}

/** « Et ce n'est que l'échauffement » : des liens vers les pages du BO. */
export function Discover() {
  return (
    <section className="fs-discover" aria-labelledby="fs-discover-title">
      <div className="fs-discover-head">
        <span className="fs-eyebrow">Et ce n’est que l’échauffement</span>
        <h2 id="fs-discover-title">Il y a bien plus à découvrir.</h2>
      </div>
      <div className="fs-discover-grid">
        <article className="fs-card fs-disc">
          <div className="fs-disc-live">
            <span className="fs-disc-tag">LIVE</span><span className="fs-disc-player">L. Garnier</span><span className="fs-disc-score">6 3</span><span className="fs-disc-point">40</span>
          </div>
          <h3>Le live score</h3>
          <p>Chaque point saisi au bord du court s’affiche en direct dans l’app. Familles et adhérents suivent le match, réactions comprises.</p>
          <Link to="/live-score">Découvrir →</Link>
        </article>
        <article className="fs-card fs-disc">
          <div className="fs-disc-course"><span>Mardi 18 h · Adultes</span><span>5 / 6</span></div>
          <h3>La gestion des cours</h3>
          <p>Créneaux, quotas, demandes de place depuis l’app : vos enseignants valident en un clic.</p>
          <Link to="/courses">Découvrir →</Link>
        </article>
        <article className="fs-card fs-disc">
          <div aria-hidden="true" className="fs-disc-sheet"><span className="fs-disc-paper" /><span className="fs-disc-arrow">→</span><span className="fs-disc-lines"><span /><span /><span /></span></div>
          <h3>La feuille de match en photo</h3>
          <p>Au début de la rencontre, le capitaine photographie la feuille : joueurs et matchs sont saisis tout seuls. À la fin, TEN’UP vérifie les résultats et l’affiche se génère.</p>
          <Link to="/team-matches">Découvrir →</Link>
        </article>
        <article className="fs-card fs-disc fs-disc-more">
          <span aria-hidden="true" className="fs-disc-plus">+</span>
          <h3>Et plus encore</h3>
          <p>Planning et affiches de tournois TMC, événements du club, publication sur Facebook… et les nouveautés de la saison, incluses dans votre abonnement.</p>
        </article>
      </div>
    </section>
  );
}
