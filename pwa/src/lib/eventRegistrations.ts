// Partagé entre le bloc d'inscription membre et le panneau admin de la fiche événement.
export interface Participant {
  id: string;
  user_id: string | null;
  is_guest: boolean;
  prenom: string;
  nom: string;
}

export interface Member {
  id: string;
  prenom: string;
  nom: string;
}

// Personne sans compte : invité d'un membre ou personne saisie par un admin.
export type Guest = { prenom: string; nom: string };

export const ERRORS: Record<string, string> = {
  EVENT_FULL: 'Plus assez de places disponibles pour cette réservation.',
  QUOTA_EXCEEDED: 'Trop de personnes pour une seule réservation.',
  ALREADY_REGISTERED: 'Déjà inscrit à cet événement',
  REGISTRATION_CLOSED: 'Les inscriptions sont closes.',
  NOT_MEMBER: 'Réservé aux membres du club.',
  NOT_REGISTERED: 'Vous n’êtes pas inscrit à cet événement.',
  VALIDATION_ERROR: 'Prénom et nom obligatoires pour chaque personne, et au moins une personne par groupe.',
  FORBIDDEN: 'Réservé aux administrateurs du club.',
};

export function errorMessage(error: { message: string; details?: string | null }): string {
  const base = ERRORS[error.message] ?? 'Une erreur est survenue, réessayez.';
  return error.message === 'ALREADY_REGISTERED' && error.details ? `${base} : ${error.details}.` : base;
}

export const fullName = (p: { prenom: string; nom: string }) => `${p.prenom} ${p.nom}`.trim();

export const cleanGuests = (guests: Guest[]) =>
  guests.map((g) => ({ prenom: g.prenom.trim(), nom: g.nom.trim() }));
