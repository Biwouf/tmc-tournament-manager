import type { TeamCompetition, TeamEquipe, TeamEtape, TeamRencontre } from '../../types';
import { competitionShortLabel } from './labels';

interface Props {
  rencontre: TeamRencontre;
  equipe: TeamEquipe;
  competition: TeamCompetition;
  etape: TeamEtape;
  state: 'upcoming' | 'past';
}

const JOURS = ['DIM', 'LUN', 'MAR', 'MER', 'JEU', 'VEN', 'SAM'];
const MOIS = ['JANV', 'FÉVR', 'MARS', 'AVR', 'MAI', 'JUIN', 'JUIL', 'AOÛT', 'SEPT', 'OCT', 'NOV', 'DÉC'];

function outcome(r: TeamRencontre): 'win' | 'lose' | 'draw' | null {
  if (r.score_club == null || r.score_adverse == null) return null;
  if (r.score_club > r.score_adverse) return 'win';
  if (r.score_club < r.score_adverse) return 'lose';
  return 'draw';
}

function etapeBadge(etape: TeamEtape): string {
  if (etape.phase === 'poule') return `JOURNÉE ${etape.numero_journee}`;
  return etape.stade_finale === 'finale' ? 'Finale' : (etape.stade_finale ?? 'Finale');
}

function formatHeure(d: Date): string {
  return d.toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' });
}

const RESULT_STYLES: Record<'win' | 'lose' | 'draw', { bg: string; label: string }> = {
  win: { bg: 'bg-green-700', label: 'VICTOIRE' },
  lose: { bg: 'bg-red-700', label: 'DÉFAITE' },
  draw: { bg: 'bg-amber-700', label: 'NUL' },
};

export default function MatchEquipeCell({ rencontre, equipe, competition, etape, state }: Props) {
  const date = new Date(rencontre.date_heure);
  const jour = JOURS[date.getDay()];
  const num = date.getDate();
  const mois = MOIS[date.getMonth()];

  const topLabel = `${competition.nom} · ${competitionShortLabel(competition)}`;
  const isUpcoming = state === 'upcoming';

  return (
    <div
      className="grid rounded-xl border border-border bg-card overflow-hidden"
      style={{
        gridTemplateColumns: isUpcoming ? '72px 1fr 58px' : '72px 1fr 78px',
        minHeight: 116,
      }}
    >
      {/* Col 1 — date */}
      <div
        className={`flex flex-col items-center justify-center gap-0.5 px-1 py-3 ${
          isUpcoming ? 'bg-muted' : ''
        }`}
        style={isUpcoming ? undefined : { backgroundColor: '#f6f3f3' }}
      >
        <span
          className={`text-[11px] font-bold tracking-wide ${
            isUpcoming ? 'text-primary' : 'text-muted-foreground'
          }`}
        >
          {jour}
        </span>
        <span
          className={`text-[30px] font-extrabold leading-none ${
            isUpcoming ? 'text-foreground' : 'text-muted-foreground'
          }`}
        >
          {num}
        </span>
        <span
          className={`text-[11px] font-semibold ${
            isUpcoming ? 'text-foreground/70' : 'text-muted-foreground'
          }`}
        >
          {mois}
        </span>
        {isUpcoming && (
          <span className="mt-1 rounded-full border border-accent px-1.5 py-0.5 text-[11px] font-bold text-primary">
            {formatHeure(date)}
          </span>
        )}
      </div>

      {/* Col 2 — contexte + adversaire */}
      <div className="flex flex-col justify-center gap-1.5 px-3 py-3 min-w-0">
        <span className="text-[11px] font-bold uppercase tracking-wide text-primary truncate">
          {topLabel}
        </span>
        <div className="flex flex-wrap items-center gap-1.5">
          <span className="whitespace-nowrap rounded-md bg-muted px-1.5 py-0.5 text-[10px] font-bold text-muted-foreground">
            ÉQUIPE {equipe.numero}
          </span>
          <span className="whitespace-nowrap rounded-md bg-muted px-1.5 py-0.5 text-[10px] font-bold uppercase text-muted-foreground">
            {etapeBadge(etape)}
          </span>
        </div>
        <span
          className="text-base font-extrabold text-foreground leading-tight overflow-hidden"
          style={{ display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical' }}
        >
          vs {rencontre.club_adverse}
        </span>
      </div>

      {/* Col 3 — lieu (upcoming) ou résultat (past) */}
      {isUpcoming ? (
        <div
          className={`flex flex-col items-center justify-center gap-1 ${
            rencontre.domicile ? 'bg-primary' : 'bg-foreground'
          } text-white`}
        >
          <span className="text-2xl leading-none">{rencontre.domicile ? '🏠' : '✈️'}</span>
          <span className="text-[9px] font-bold tracking-widest">
            {rencontre.domicile ? 'AU CLUB' : 'EXT.'}
          </span>
        </div>
      ) : (
        <ResultColumn rencontre={rencontre} />
      )}
    </div>
  );
}

function ResultColumn({ rencontre }: { rencontre: TeamRencontre }) {
  const issue = outcome(rencontre);
  if (!issue) {
    return (
      <div className="flex items-center justify-center bg-muted text-[10px] font-semibold text-muted-foreground text-center px-1">
        En attente
      </div>
    );
  }
  const { bg, label } = RESULT_STYLES[issue];
  return (
    <div className={`flex flex-col items-center justify-center gap-1 ${bg} text-white px-1`}>
      <span className="text-[9px] font-bold tracking-wide">{label}</span>
      <span className="text-[26px] font-black tabular-nums leading-none">
        {rencontre.score_club}
        <span className="opacity-55">–</span>
        {rencontre.score_adverse}
      </span>
    </div>
  );
}
