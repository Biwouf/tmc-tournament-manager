// Tennis rankings from NC (lowest) to 4/6 (highest)
export type TennisRanking =
  | 'NC' | '40' | '30/5' | '30/4' | '30/3' | '30/2' | '30/1' | '30'
  | '15/5' | '15/4' | '15/3' | '15/2' | '15/1' | '15'
  | '5/6' | '4/6';

export const TENNIS_RANKINGS: TennisRanking[] = [
  'NC',
  '40', '30/5', '30/4', '30/3', '30/2', '30/1', '30',
  '15/5', '15/4', '15/3', '15/2', '15/1', '15',
  '5/6', '4/6'
];

export type Gender = 'homme' | 'femme';

export interface DailyTimeSlot {
  date: string; // ISO date string (YYYY-MM-DD)
  firstMatchStart: string; // Time in HH:mm format
  lastMatchStart: string; // Time in HH:mm format
}

export interface TournamentConfig {
  id: string;
  gender: Gender;
  numberOfPlayers: number;
  minRanking: TennisRanking;
  maxRanking: TennisRanking;
}

export interface GlobalConfig {
  name: string;
  startDate: string; // ISO date string
  endDate: string; // ISO date string
  numberOfCourts: number;
  matchDuration: number; // Duration in minutes
  dailyTimeSlots: DailyTimeSlot[];
  tournaments: TournamentConfig[];
}

export type MatchType =
  | 'quarter-final'
  | 'semi-final'
  | 'final'
  | 'ranking-5-8'
  | 'ranking-3-4';

export interface Match {
  id: string;
  tournamentId: string;
  matchType: MatchType;
  round: number;
  playerSlots: number[]; // Indices of players (to be filled)
  description: string; // e.g., "1/4 finale", "Finale", "Match pour la 3ème place"
}

export interface ScheduledMatch {
  match: Match;
  court: number;
  date: string; // ISO date string
  startTime: string; // Time in HH:mm format
  endTime: string; // Time in HH:mm format
}

export interface Schedule {
  scheduledMatches: ScheduledMatch[];
  tournaments: TournamentConfig[];
  unscheduledMatches?: Match[]; // Matches that couldn't be scheduled
  warnings?: string[]; // Warning messages
}

export interface TournamentEntry {
  id: string;
  config: GlobalConfig;
  schedule: Schedule | null;
}
