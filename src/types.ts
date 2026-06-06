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

export type SlotFillingStrategy = 'smooth' | 'max';

export interface GlobalConfig {
  name: string;
  startDate: string; // ISO date string
  endDate: string; // ISO date string
  numberOfCourts: number;
  matchDuration: number; // Duration in minutes
  dailyTimeSlots: DailyTimeSlot[];
  tournaments: TournamentConfig[];
  // Strategy for filling slots:
  //  - 'smooth' (default): spreads matches evenly across the available period
  //  - 'max': fills each slot to capacity (numberOfCourts) before moving on
  slotFillingStrategy?: SlotFillingStrategy;
}

export type MatchType =
  | 'quarter-final'
  | 'semi-final'
  | 'final'
  | 'ranking-5-8'
  | 'ranking-3-4';

// Bracket lineage. Used by the scheduler to enforce the 4-hour rule per
// player path rather than per absolute round (otherwise the consolante
// finales would block the main finale on asymmetric brackets).
// First round of any consolante is fed by the main bracket — see scheduler.
export type MatchBracket =
  | 'main'
  | 'cons-5-8'
  | 'cons-9-12'
  | 'cons-9-16'
  | 'cons-17-24';

export interface Match {
  id: string;
  tournamentId: string;
  matchType: MatchType;
  bracket: MatchBracket;
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
  // Tous les créneaux générés par la configuration — utilisés pour afficher
  // les créneaux vides dans la vue calendrier (drop zones persistantes après D&D).
  allTimeSlots?: Array<{ date: string; startTime: string; endTime: string }>;
}

export interface TournamentEntry {
  id: string;
  config: GlobalConfig;
  schedule: Schedule | null;
}

export type EventType = 'Animation' | 'Tournoi' | 'Match par équipe' | 'Sortie' | 'Soirée';

export const EVENT_TYPES: EventType[] = ['Animation', 'Tournoi', 'Match par équipe', 'Sortie', 'Soirée'];

export type TeamMatchGender = 'Masculin' | 'Féminin';

export type TeamMatchType =
  | 'Seniors'
  | 'Seniors +35'
  | 'Jeunes 15/16 ans'
  | 'Jeunes 13/14 ans'
  | 'Jeunes 11/12 ans';

export const TEAM_MATCH_TYPES: TeamMatchType[] = [
  'Seniors',
  'Seniors +35',
  'Jeunes 15/16 ans',
  'Jeunes 13/14 ans',
  'Jeunes 11/12 ans',
];

export interface TeamMatch {
  id: string;                // local uuid, used for React keys and reordering
  gender: TeamMatchGender;
  matchType: TeamMatchType;
  teamNumber: 1 | 2 | 3;
  opponent: string;
  location: 'home' | 'away'; // home = Au club, away = Chez l'adversaire
  date: string;              // "YYYY-MM-DD"
  time: string;              // "HH:MM"
}

export interface ClubEvent {
  id: string;
  type: EventType;
  titre: string;
  description: string;
  date_debut: string;
  date_fin: string | null;
  image_url: string | null;
  prix: number | null;
  team_matches: TeamMatch[] | null; // null si type !== 'Match par équipe'
  created_at: string;
  updated_at: string;
}

export interface ActuFocalPoint {
  x: number; // 0–100
  y: number; // 0–100
}

export interface Actu {
  id: string;
  titre: string;
  contenu: string;             // Markdown
  image_urls: string[];        // 0..N images
  image_focal_points: (ActuFocalPoint | null)[]; // parallel array — same length as image_urls
  image_captions: string[];    // parallel array — caption Facebook par image (BO-only, jamais affichée PWA)
  published: boolean;          // false = brouillon, true = publié
  published_at: string | null; // first publication timestamp, never overwritten
  created_at: string;
  updated_at: string;
}

export interface Profile {
  id: string;
  prenom: string;
  nom: string;
}

export type LiveMatchStatus = 'pending' | 'live' | 'finished';
export type LiveMatchType = 'simple' | 'double';
export type LiveSet3Format = 'normal' | 'super_tiebreak';
export type LiveMatchWinner = 'j1' | 'j2';

export interface LiveMatch {
  id: string;
  match_date: string;
  start_time: string | null;
  match_type: LiveMatchType;

  j1_prenom: string;
  j1_nom: string;
  j1_classement: string;
  j1_club: string;

  j2_prenom: string;
  j2_nom: string;
  j2_classement: string;
  j2_club: string;

  j3_prenom: string | null;
  j3_nom: string | null;
  j3_classement: string | null;
  j3_club: string | null;

  j4_prenom: string | null;
  j4_nom: string | null;
  j4_classement: string | null;
  j4_club: string | null;

  event_id: string | null;
  scored_by: string | null;
  type_tournoi: string | null;
  court: string | null;

  status: LiveMatchStatus;

  set1_j1: number | null;
  set1_j2: number | null;
  set1_tb_j1: number | null;
  set1_tb_j2: number | null;

  set2_j1: number | null;
  set2_j2: number | null;
  set2_tb_j1: number | null;
  set2_tb_j2: number | null;

  set3_format: LiveSet3Format | null;
  set3_j1: number | null;
  set3_j2: number | null;
  set3_tb_j1: number | null;
  set3_tb_j2: number | null;

  winner: LiveMatchWinner | null;
  retired_player: LiveMatchWinner | null;
  started_at: string | null;
  finished_at: string | null;
  created_at: string;
  updated_at: string;
}

// ============================================================
// Module Matches par équipe
// ============================================================

export type TeamCompetitionNom =
  | 'Pyrénées Interclubs'
  | 'CODEP'
  | 'GAN 35'
  | 'Thénégal'
  | 'Interclubs';

export type TeamType = 'adultes' | 'jeunes';

export type TeamGenre =
  | 'hommes'
  | 'femmes'
  | 'mixte'
  | 'garcons'
  | 'filles';

export type TeamCategorie =
  | 'seniors'
  | '35_ans'
  | '60_ans'
  | '17_18'
  | '15_16'
  | '13_14'
  | '11_12';

export type TeamFormat =
  | '2S1D'    // 2 simples et 1 double
  | '3S1D2'   // 3 simples et 1 double (double = 2 pts)
  | '4S1D2'   // 4 simples et 1 double (double = 2 pts)
  | '4S2D';   // 4 simples et 2 doubles

export type TeamDivision = 'R1A' | 'R1B' | 'R2' | 'R3' | 'R4' | 'R5' | 'R6';

export type TeamStadeFinale = '1/16' | '1/8' | '1/4' | '1/2' | 'finale';

export type TeamMatchLineType = 'simple' | 'double';

export type TeamMatchGagnant = 'club' | 'adverse';

export interface TeamSaison {
  id: string;
  label: string;       // ex. "2025/2026"
  actif: boolean;
  created_at: string;
}

export interface TeamCompetition {
  id: string;
  saison_id: string;
  nom: TeamCompetitionNom;
  type: TeamType;
  genre: TeamGenre;
  categorie: TeamCategorie;
  format: TeamFormat;
  created_at: string;
}

export interface TeamEquipe {
  id: string;
  competition_id: string;
  numero: number;           // 1, 2, 3…
  division: TeamDivision;
  nb_journees_poule: number;
  qualifiee: boolean | null; // null = non encore déterminé
  stade_finale_depart: TeamStadeFinale | null;
  created_at: string;
}

export interface TeamEtape {
  id: string;
  equipe_id: string;
  phase: 'poule' | 'finale';
  numero_journee: number | null;        // renseigné si phase = 'poule'
  stade_finale: TeamStadeFinale | null;  // renseigné si phase = 'finale'
  created_at: string;
}

export interface TeamJoueur {
  prenom: string;
  nom: string | null;
  classement: string; // ex. "30", "15/2"
}

export interface TeamMatchLine {
  id: string;
  rencontre_id: string;
  ordre: number;
  match_type: TeamMatchLineType;
  joueurs_club: TeamJoueur[];
  joueurs_adverse: TeamJoueur[];
  live_match_id: string | null;
  score: string | null;         // saisie libre si pas de live
  gagnant: TeamMatchGagnant | null;
  created_at: string;
}

export interface TeamRencontre {
  id: string;
  etape_id: string;
  club_adverse: string;
  date_heure: string;          // ISO 8601
  domicile: boolean;
  score_club: number | null;
  score_adverse: number | null;
  photo_urls: string[];
  created_at: string;
  updated_at: string;
}
