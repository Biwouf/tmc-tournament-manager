import type { FirstStep } from './FirstStepsFlow';
import ActuStep from './ActuStep';
import ActuPreview from './ActuPreview';
import EquipesStep from './EquipesStep';
import EquipesPreview from './EquipesPreview';
import AffichesStep from './AffichesStep';
import AffichesPreview from './AffichesPreview';
import FinalStep, { Discover } from './FinalStep';

// SaaS S5 — LA liste des premiers pas. Ajouter une étape (S6 `equipes`, S7 `affiches`) = une entrée
// ici : fil d'Ariane, « Étape X sur N », barre, reprise et récapitulatif en découlent.
export const FIRST_STEPS: FirstStep[] = [
  {
    id: 'actu',
    label: 'Première actu',
    duration: '1 minute',
    isDone: (state) => state.completed_steps.includes('actu'),
    Component: ActuStep,
    Preview: ActuPreview,
    recap: { done: 'Première actu publiée', todo: 'Première actu à publier' },
  },
  {
    id: 'equipes',
    label: 'Vos équipes',
    duration: '1 minute par équipe',
    isDone: (state) => state.completed_steps.includes('equipes'),
    Component: EquipesStep,
    Preview: EquipesPreview,
    recap: { done: 'Vos équipes et leur calendrier', todo: 'Aucune équipe pour l’instant' },
  },
  {
    id: 'affiches',
    label: 'Vos affiches',
    duration: '1 minute',
    isDone: (state) => state.completed_steps.includes('affiches'),
    Component: AffichesStep,
    Preview: AffichesPreview,
    recap: { done: 'Affiche du week-end prête', todo: 'Affiche du week-end à générer' },
  },
  {
    id: 'fin',
    label: 'C’est prêt',
    isDone: () => false,
    Component: FinalStep,
    Preview: ActuPreview,
    Below: Discover,
    final: true,
  },
];
