import type { TeamPlayer } from '../../lib/teamMatches';

/** Keep each ranking next to its player, including both partners in a double. */
export default function TeamPlayers({ players }: { players: TeamPlayer[] }) {
  return <span className="inline-flex flex-wrap items-baseline gap-x-1.5 gap-y-1">
    {players.map((player, index) => <span key={index} className="inline-flex flex-wrap items-baseline gap-x-1">
      {index > 0 && <span aria-hidden="true" className="mr-0.5 text-muted-foreground">/</span>}
      <span>{`${player.prenom} ${player.nom ?? ''}`.trim()}</span>
      <span className="text-xs font-normal text-muted-foreground">({player.classement?.trim() || 'NC'})</span>
    </span>)}
  </span>;
}
