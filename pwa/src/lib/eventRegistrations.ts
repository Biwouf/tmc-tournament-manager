// Partagé entre le bloc d'inscription membre et le panneau admin de la fiche événement.
export interface Participant {
  id: string;
  user_id: string | null;
  is_guest: boolean;
  prenom: string;
  nom: string;
  sections: SectionPick;
}

/** Sections choisies par une personne : null = tout l'événement. */
export type SectionPick = string[] | null;

/** Partie d'un événement (ex. animation puis repas), renvoyée par event_registration_state. */
export interface EventSection {
  id: string;
  titre: string;
  heure_debut: string | null;
  prix: number | null;
  capacity: number | null;
  taken: number;
}

export const inSection = (pick: SectionPick, sectionId: string) => pick === null || pick.includes(sectionId);

/** Choix proposé pour une nouvelle personne : tout, ou seulement les sections qui ont encore de la place. */
export const defaultPick = (sections: EventSection[]): SectionPick => {
  const open = sections.filter((s) => s.capacity === null || s.taken < s.capacity).map((s) => s.id);
  return open.length === sections.length || open.length === 0 ? null : open;
};

/** « Repas » ou « Animation + Repas » ; null quand la personne vient à tout l'événement. */
export const sectionsLabel = (pick: SectionPick, sections: EventSection[]) =>
  pick && sections.length > 0
    ? sections
        .filter((s) => pick.includes(s.id))
        .map((s) => s.titre)
        .join(' + ')
    : null;

export interface Member {
  id: string;
  prenom: string;
  nom: string;
}

// Personne sans compte : invité d'un membre ou personne saisie par un admin.
export type Guest = { prenom: string; nom: string; sections?: SectionPick };

export const ERRORS: Record<string, string> = {
  EVENT_FULL: 'Plus assez de places disponibles pour cette réservation.',
  SECTION_FULL: 'Plus assez de places dans une section',
  SECTION_REQUIRED: 'Choisissez au moins une partie de l’événement pour chaque personne.',
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
  if (error.message === 'SECTION_FULL') return error.details ? `${base} : ${error.details}.` : `${base}.`;
  return error.message === 'ALREADY_REGISTERED' && error.details ? `${base} : ${error.details}.` : base;
}

export const fullName = (p: { prenom: string; nom: string }) => `${p.prenom} ${p.nom}`.trim();

export const cleanGuests = (guests: Guest[]) =>
  guests.map((g) => ({ prenom: g.prenom.trim(), nom: g.nom.trim(), sections: g.sections ?? null }));
