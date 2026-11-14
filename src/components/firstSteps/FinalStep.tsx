import { useState } from 'react';
import { Link } from 'react-router-dom';
import { clubAppHost } from '../../lib/firstSteps';
import { QrCode } from './QrCode';
import { useCopy } from './useCopy';
import type { StepProps } from './FirstStepsFlow';

export default function FinalStep({ club, state, steps, finish }: StepProps) {
  const host = clubAppHost(club.slug);
  const { state: copy, copy: copyText } = useCopy();
  const recap = steps.flatMap((step) => (step.recap ? [{ id: step.id, ok: step.isDone(state), ...step.recap }] : []));

  const copyLink = () => copyText(`https://${host}`);

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
    <FinishButton finish={finish} />
  </>;
}

/** « Finir l'installation » : clôt les premiers pas (`finished_at`) et ouvre le tableau de bord,
 *  où la checklist attend. Présent sous l'étape et dans la carte « Et plus encore ». */
function FinishButton({ finish }: Pick<StepProps, 'finish'>) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const go = async () => {
    setBusy(true);
    setError(await finish());
    setBusy(false);
  };
  return <>
    {error && <p role="alert" className="fs-error">{error}</p>}
    <button type="button" className="fs-btn fs-btn-p fs-finish" disabled={busy} onClick={go}>Finir l’installation</button>
  </>;
}

/** « Et ce n'est que l'échauffement » : des liens vers les pages du BO. */
export function Discover({ finish }: Pick<StepProps, 'finish'>) {
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
          <FinishButton finish={finish} />
        </article>
      </div>
    </section>
  );
}
