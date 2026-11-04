import { useEffect, useRef, useState, type ComponentType, type CSSProperties } from 'react';
import { useNavigate } from 'react-router-dom';
import { brandTokens } from '../../../shared/brandTokens.mjs';
import type { Club } from '../../contexts/ClubContext';
import type { ClubConfig, OnboardingState } from '../../lib/clubConfig';
import { completeFirstStep, currentStepIndex, finishFirstSteps, postponeFirstSteps, stepProgress, trialLabel, type OnboardingWrite } from '../../lib/firstSteps';
import type { PreviewData } from '../signup/SignupPreview';

// SaaS S5 — le cadre des premiers pas : en-tête, fil d'Ariane, étape, aperçu. Il ne connaît aucune
// étape : tout vient de la liste déclarative (`steps.ts`).

export type StepProps = {
  club: Club;
  config: ClubConfig;
  state: OnboardingState;
  /** Résultat de l'étape écrit dans l'avancement ; rend le message d'erreur, sinon null. */
  complete: () => Promise<string | null>;
  /** Étape suivante, si elle existe. */
  next?: { label: string; go: () => void };
  /** Marque le parcours terminé et mène au tableau de bord ; rend le message d'erreur, sinon null. */
  finish: () => Promise<string | null>;
  steps: FirstStep[];
  /** « Étape X sur N · durée », à afficher en tête de l'étape tant qu'elle est à faire. */
  eyebrow: string;
};

export type StepPreviewProps = {
  club: Club;
  data: PreviewData;
  /** Change à chaque étape terminée : l'aperçu relit ce qu'il montre. */
  version: number;
};

export type FirstStep = {
  id: string;
  /** Libellé du fil d'Ariane. */
  label: string;
  /** Durée annoncée à côté de « Étape X sur N ». */
  duration?: string;
  /** Terminée si… */
  isDone: (state: OnboardingState) => boolean;
  Component: ComponentType<StepProps>;
  /** L'aperçu à droite : l'onglet de la PWA concerné par l'étape. */
  Preview: ComponentType<StepPreviewProps>;
  /** Pleine largeur, sous l'étape et l'aperçu. */
  Below?: ComponentType;
  /** Récapitulatif de l'écran final. */
  recap?: { done: string; todo: string };
  /** Écran de fin : absent du décompte « Étape X sur N ». */
  final?: boolean;
};

const lowerFirst = (text: string) => text.charAt(0).toLowerCase() + text.slice(1);

export default function FirstStepsFlow({ club, config, steps }: { club: Club; config: ClubConfig; steps: FirstStep[] }) {
  const navigate = useNavigate();
  const [state, setState] = useState(config.onboarding);
  const [index, setIndex] = useState(() => currentStepIndex(steps, config.onboarding));
  const [version, setVersion] = useState(0);
  const [previewOpen, setPreviewOpen] = useState(false);
  const [leaving, setLeaving] = useState(false);
  const [leaveError, setLeaveError] = useState<string | null>(null);
  const card = useRef<HTMLElement>(null);

  // Clavier et lecteur d'écran : le titre de l'étape prend le focus à chaque changement de vue.
  const firstRender = useRef(true);
  useEffect(() => {
    if (firstRender.current) { firstRender.current = false; return; }
    card.current?.querySelector<HTMLElement>('h2')?.focus();
  }, [index, version]);

  const step = steps[index];
  const progress = stepProgress(steps, index);
  const nextStep = steps[index + 1];
  const { Component, Preview, Below } = step;
  const name = config.brand.name || club.name;
  const data: PreviewData = { name, city: config.brand.city, slug: club.slug, color: config.brand.color ?? '', logo: config.brand.logo || null, photo: config.home.hero_image || null };

  const applied = (result: OnboardingWrite) => {
    if (result.error !== undefined) return result.error;
    setState(result.state);
    return null;
  };
  const complete = async () => {
    const error = applied(await completeFirstStep(club.id, step.id));
    if (!error) setVersion((v) => v + 1);
    return error;
  };
  const leave = async (write: (clubId: string) => Promise<OnboardingWrite>) => {
    const result = await write(club.id);
    if (result.error !== undefined) return result.error;
    navigate('/');
    return null;
  };
  const postpone = async () => {
    setLeaving(true);
    setLeaveError(await leave(postponeFirstSteps));
    setLeaving(false);
  };

  return (
    <div className="fs" style={brandTokens(config.brand.color) as CSSProperties}>
      <header className="fs-top">
        <div className="fs-shell fs-top-row">
          <span className="fs-identity">
            {data.logo
              ? <img src={data.logo} alt="" className="fs-logo" />
              : <span aria-hidden="true" className="fs-logo fs-logo-initial">{name.charAt(0)}</span>}
            <span className="fs-names">
              <span className="fs-name">{name}</span>
              <span className="fs-sub">Back-office · admin.feelike.pro</span>
            </span>
          </span>
          <span className="fs-chip fs-chip-soft"><span className="fs-dot" />{trialLabel(club.trial_ends_at)}</span>
        </div>
      </header>

      <main className="fs-shell fs-main">
        <nav aria-label="Fil d'Ariane" className="fs-crumbs">
          <ol>
            {steps.map((item, i) => (
              <li key={item.id}>
                {i > 0 && <span aria-hidden="true" className="fs-crumb-sep">›</span>}
                {i < index
                  ? <button type="button" className="fs-crumb-past" onClick={() => setIndex(i)}>
                      <span aria-hidden="true" className="fs-crumb-check">✓</span><span>{item.label}</span>
                    </button>
                  : i === index
                    ? <span aria-current="step" className="fs-crumb-now">{item.label}</span>
                    : <span className="fs-crumb-next">{item.label}</span>}
              </li>
            ))}
          </ol>
          <div aria-hidden="true" className="fs-bar"><div style={{ width: `${progress.percent}%` }} /></div>
        </nav>

        <div className="fs-layout">
          <section ref={card} className="fs-card fs-step" aria-live="polite">
            <Component
              key={step.id}
              club={club}
              config={config}
              state={state}
              steps={steps}
              eyebrow={`Étape ${progress.number} sur ${progress.total}${step.duration ? ` · ${step.duration}` : ''}`}
              complete={complete}
              next={nextStep && { label: lowerFirst(nextStep.label), go: () => setIndex(index + 1) }}
              finish={() => leave(finishFirstSteps)}
            />
            {!step.final && (
              <div className="fs-later">
                <button type="button" className="fs-link" disabled={leaving} onClick={postpone}>Je finirai plus tard</button>
                {leaveError && <p role="alert" className="fs-error">{leaveError}</p>}
              </div>
            )}
          </section>

          <section className={`fs-stage${previewOpen ? ' open' : ''}`} aria-label="Aperçu de l'app">
            <button type="button" className="fs-btn fs-btn-o fs-preview-toggle" aria-expanded={previewOpen} aria-controls="fs-preview" onClick={() => setPreviewOpen((open) => !open)}>
              {previewOpen ? 'Masquer l’aperçu' : 'Voir l’aperçu'}
            </button>
            <div id="fs-preview" className="fs-phone"><Preview club={club} data={data} version={version} /></div>
          </section>
        </div>
        {Below && <Below />}
      </main>
    </div>
  );
}
