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
  finished_at: string | null;
  created_at: string;
  updated_at: string;
}

// ─── Type spécifique PWA ────────────────────────────────────────────────────

export interface Actu {
  id: string;
  titre: string;
  contenu: string;             // Markdown
  image_urls: string[];        // 0..N images
  published: boolean;
  published_at: string | null;
  created_at: string;
  updated_at: string;
}
