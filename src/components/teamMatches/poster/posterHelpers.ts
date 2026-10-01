import type {
  TeamCompetition,
  TeamEquipe,
  TeamMatch,
  TeamRencontre,
} from '../../../types';

/** Rencontre avec son contexte (étape → équipe → compétition). */
export interface RencontreWithContext extends TeamRencontre {
  etape: {
    equipe: (TeamEquipe & { competition: TeamCompetition | null }) | null;
  } | null;
}

export const MAX_POSTER_MATCHES = 8;

export function formatRencontreDate(iso: string): string {
  const d = new Date(iso);
  const datePart = d.toLocaleDateString('fr-FR', {
    weekday: 'short',
    day: 'numeric',
    month: 'long',
  });
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${datePart}, ${d.getHours()}h${pad(d.getMinutes())}`;
}

export function rencontreToTeamMatch(
  rencontre: TeamRencontre,
  equipe: TeamEquipe,
  competition: TeamCompetition,
): TeamMatch {
  const dt = new Date(rencontre.date_heure);
  const pad = (n: number) => String(n).padStart(2, '0');

  // date locale YYYY-MM-DD
  const date = `${dt.getFullYear()}-${pad(dt.getMonth() + 1)}-${pad(dt.getDate())}`;
  // heure locale HH:MM
  const time = `${pad(dt.getHours())}:${pad(dt.getMinutes())}`;

  const teamNumber = Math.min(equipe.numero, 3) as 1 | 2 | 3;

  return {
    id: rencontre.id,
    competitionName: competition.nom,
    gender: competition.genre,
    ageCategory: competition.categorie,
    teamNumber,
    opponent: rencontre.club_adverse,
    location: rencontre.domicile ? 'home' : 'away',
    date,
    time,
  };
}
