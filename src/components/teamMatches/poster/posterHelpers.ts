import type {
  TeamCompetition,
  TeamEquipe,
  TeamMatch,
  TeamMatchGender,
  TeamMatchType,
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

  const gender: TeamMatchGender =
    competition.genre === 'femmes' || competition.genre === 'filles'
      ? 'Féminin'
      : 'Masculin';

  const matchTypeMap: Record<string, TeamMatchType> = {
    seniors: 'Seniors',
    '35_ans': 'Seniors +35',
    '60_ans': 'Seniors +35', // pas d'entrée dédiée — fallback
    '17_18': 'Jeunes 15/16 ans',
    '15_16': 'Jeunes 15/16 ans',
    '13_14': 'Jeunes 13/14 ans',
    '11_12': 'Jeunes 11/12 ans',
  };
  const matchType: TeamMatchType = matchTypeMap[competition.categorie] ?? 'Seniors';

  const teamNumber = Math.min(equipe.numero, 3) as 1 | 2 | 3;

  return {
    id: rencontre.id,
    gender,
    matchType,
    teamNumber,
    opponent: rencontre.club_adverse,
    location: rencontre.domicile ? 'home' : 'away',
    date,
    time,
  };
}
