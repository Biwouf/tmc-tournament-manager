export const FORMAT_POINTS: Record<string, { simples: number; doubles: number; doublePoints: number }>;
export const NOTE_MAX: number;
export const CONTEXTE_MAX: number;
export const MAX_RENCONTRES: number;

export interface PostMatchFact {
  type: 'simple' | 'double';
  joueurs: string[];
  score: string | null;
  vainqueur: 'club' | 'adversaire' | null;
  issue: 'forfait' | 'abandon' | null;
}

export interface PostRencontreFact {
  ref: string;
  equipe: string;
  jeunes: boolean;
  competition: string;
  division: string | null;
  journee: string;
  date: string | null;
  lieu: 'domicile' | 'extérieur';
  adversaire: string;
  score: string | null;
  resultat: 'victoire' | 'nul' | 'défaite' | null;
  forfait: boolean;
  matchs: PostMatchFact[];
  note: string | null;
  contexte_classement: string | null;
}

export interface PostFactsSource {
  rencontre: { id: string; club_adverse: string; date_heure: string; domicile: boolean; score_club: number | null; score_adverse: number | null; wo?: boolean };
  etape: { phase: 'poule' | 'finale'; numero_journee: number | null; stade_finale: string | null };
  equipe: { id: string; numero: number; division: string };
  competition: { nom: string; type: string; genre: string; categorie: string; format: string };
  lines: Array<{ match_type: 'simple' | 'double'; slot?: number; ordre: number; joueurs_club: Array<{ prenom: string; nom?: string | null }>; score: string | null; gagnant: 'club' | 'adverse' | null; result_kind?: string | null }>;
}

export function firstName(player: { prenom?: string | null } | null | undefined): string;
export function buildPostFacts(input: {
  rencontres: PostFactsSource[];
  extras?: Record<string, { note?: string; contexte?: string }>;
}): { facts: PostRencontreFact[]; warnings: string[]; ids: string[] };
