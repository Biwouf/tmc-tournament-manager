import { Link } from 'react-router-dom';
import type { TeamCompetition, TeamEquipe, TeamSaison } from '../../types';
import { competitionLabel } from './teamMatchLabels';

export interface EquipeBadge {
  label: string;
  tone: 'neutral' | 'success' | 'danger' | 'final';
}

const TONE_CLASSES: Record<EquipeBadge['tone'], string> = {
  neutral: 'bg-gray-100 text-gray-700',
  success: 'bg-emerald-100 text-emerald-800',
  danger: 'bg-red-100 text-red-700',
  final: 'bg-amber-100 text-amber-800',
};

interface Props {
  equipe: TeamEquipe;
  competition: TeamCompetition;
  saison: TeamSaison;
  badge: EquipeBadge;
  onDelete: () => void;
}

export default function TeamEquipeCard({ equipe, competition, saison, badge, onDelete }: Props) {
  return (
    <div className="flex flex-col rounded-2xl border bg-card/90 p-6 shadow-sm transition hover:shadow-md">
      <div className="mb-3 flex items-center gap-2">
        <span className={`rounded-full px-2.5 py-0.5 text-xs font-medium ${TONE_CLASSES[badge.tone]}`}>
          {badge.label}
        </span>
        <span className="ml-auto rounded-full bg-muted px-2.5 py-0.5 text-xs font-medium text-muted-foreground">
          {equipe.division}
        </span>
      </div>

      <h3 className="text-lg font-semibold text-card-foreground">{competitionLabel(competition)}</h3>
      <p className="mt-1 text-sm font-medium text-foreground">Équipe {equipe.numero}</p>
      <p className="mt-1 text-sm text-muted-foreground">Saison {saison.label}</p>

      <div className="mt-4 flex flex-wrap gap-2 pt-2">
        <Link
          to={`/team-matches/equipe/${equipe.id}`}
          className="rounded-lg bg-primary px-4 py-1.5 text-sm font-medium text-primary-foreground shadow-sm transition hover:brightness-95"
        >
          Voir
        </Link>
        <button
          onClick={onDelete}
          className="ml-auto rounded-lg border border-red-200 bg-red-50 px-3 py-1.5 text-sm font-medium text-red-700 transition hover:bg-red-100"
        >
          Supprimer
        </button>
      </div>
    </div>
  );
}
