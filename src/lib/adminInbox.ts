import { createContext, useContext } from 'react';
import type { TeamCompetition } from '../types';

// PR-BO2 — réponse de la RPC `admin_inbox` (2026112501), réservée à l'admin du club.
export interface AdminInbox {
  signup_pending: number;
  signup_oldest_at: string | null;
  scores_to_enter: number;
  scores_oldest_at: string | null;
  /** Les deux rencontres les plus anciennes. */
  scores_preview: (Pick<TeamCompetition, 'nom' | 'genre' | 'categorie'> & {
    id: string;
    date_heure: string;
    club_adverse: string;
    numero: number;
  })[];
  course_pending: number;
  course_oldest_at: string | null;
  /** Cours à venir le plus proche ayant une demande en attente. */
  course_next: { id: string; name: string; starts_at: string } | null;
  /** Tous les matchs « En direct », oubliés compris (compteur neutre). */
  live_count: number;
  stale_lives: number;
  stale_lives_oldest_at: string | null;
}

export function inboxTotal(inbox: AdminInbox): number {
  return inbox.signup_pending + inbox.scores_to_enter + inbox.course_pending + inbox.stale_lives;
}

interface AdminInboxValue {
  /** `null` : pas encore lu, lecture en échec ou rôle sans accès. */
  inbox: AdminInbox | null;
  error: boolean;
  refresh: () => void;
}

export const AdminInboxContext = createContext<AdminInboxValue>({ inbox: null, error: false, refresh: () => {} });

export function useAdminInbox(): AdminInboxValue {
  return useContext(AdminInboxContext);
}
