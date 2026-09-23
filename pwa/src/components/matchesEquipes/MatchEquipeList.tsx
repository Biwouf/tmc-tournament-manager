import type { TeamCompetition, TeamEquipe, TeamEtape, TeamRencontre } from '../../types';
import MatchEquipeCell from './MatchEquipeCell';

export interface EnrichedRencontre {
  rencontre: TeamRencontre;
  etape: TeamEtape;
  equipe: TeamEquipe;
  comp: TeamCompetition;
  isLive: boolean;
}

interface Props {
  items: EnrichedRencontre[];
  state: 'upcoming' | 'past';
}

export default function MatchEquipeList({ items, state }: Props) {
  if (items.length === 0) {
    return (
      <p className="text-center text-muted-foreground py-10">
        {state === 'upcoming' ? 'Aucune rencontre à venir ou en cours.' : 'Aucune rencontre passée.'}
      </p>
    );
  }

  return (
    <div className="flex flex-col gap-3 px-4 pb-4">
      {items.map(({ rencontre, etape, equipe, comp, isLive }) => (
        <MatchEquipeCell
          key={rencontre.id}
          rencontre={rencontre}
          equipe={equipe}
          competition={comp}
          etape={etape}
          state={state}
          isLive={isLive}
        />
      ))}
    </div>
  );
}
