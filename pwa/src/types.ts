// ─── Types copiés depuis le BO (src/types.ts) ───────────────────────────────
// À maintenir en sync si les types BO évoluent.

export type EventType = 'Animation' | 'Tournoi' | 'Match par équipe' | 'Sortie' | 'Soirée';

export interface ClubEvent {
  id: string;
  type: EventType;
  titre: string;
  description: string;         // Markdown
  date_debut: string;
  date_fin: string | null;
  image_url: string | null;
  prix: number | null;
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

// ─── Type spécifique PWA ────────────────────────────────────────────────────

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
  image_captions?: string[];   // parallel array — same length as image_urls
  published: boolean;
  published_at: string | null;
  created_at: string;
  updated_at: string;
}

// ─── Module Matches par équipe (lecture seule PWA) ──────────────
// Copié depuis le BO (src/types.ts, section Module Matches par équipe).
// À maintenir en sync si les types BO évoluent.

export type TeamCompetitionNom =
  | 'Pyrénées Interclubs' | 'CODEP' | 'GAN 35' | 'Thénégal' | 'Interclubs';
export type TeamType = 'adultes' | 'jeunes';
export type TeamGenre = 'hommes' | 'femmes' | 'mixte' | 'garcons' | 'filles';
export type TeamCategorie =
  | 'seniors' | '35_ans' | '60_ans' | '17_18' | '15_16' | '13_14' | '11_12';
export type TeamDivision = 'R1A' | 'R1B' | 'R2' | 'R3' | 'R4' | 'R5' | 'R6';
export type TeamStadeFinale = '1/16' | '1/8' | '1/4' | '1/2' | 'finale';

export interface TeamSaison {
  id: string; label: string; actif: boolean; created_at: string;
}
export interface TeamCompetition {
  id: string; saison_id: string;
  nom: TeamCompetitionNom; type: TeamType;
  genre: TeamGenre; categorie: TeamCategorie;
  // format pas utilisé PWA mais conservé pour cohérence type
  format: '2S1D' | '3S1D2' | '4S1D2' | '4S2D';
  created_at: string;
}
export interface TeamEquipe {
  id: string; competition_id: string;
  numero: number; division: TeamDivision;
  nb_journees_poule: number;
  qualifiee: boolean | null;
  stade_finale_depart: TeamStadeFinale | null;
  created_at: string;
}
export interface TeamEtape {
  id: string; equipe_id: string;
  phase: 'poule' | 'finale';
  numero_journee: number | null;
  stade_finale: TeamStadeFinale | null;
  created_at: string;
}
export interface TeamRencontre {
  id: string; etape_id: string;
  club_adverse: string; date_heure: string;
  domicile: boolean;
  score_club: number | null; score_adverse: number | null;
  photo_urls: string[];
  created_at: string; updated_at: string;
}
