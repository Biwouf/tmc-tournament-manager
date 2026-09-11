import { supabase } from './supabase';
export type Sex = 'female' | 'male';
export type CourseStatus = 'pending' | 'approved' | 'denied' | 'cancelled';
export type MyRegistration = {
  id: string;
  status: CourseStatus;
  quota_sex: Sex;
  denial_reason: string | null;
  requested_at: string;
  revision: number;
};
export type Course = {
  id: string;
  name: string;
  type_name: string;
  image_path: string | null;
  owner_first_name: string | null;
  starts_at: string;
  duration_minutes: number;
  cancelled_at: string | null;
  capacity_female: number;
  capacity_male: number;
  approved_female: number;
  approved_male: number;
  can_manage?: boolean;
  pending_count?: number;
  revision?: number;
  registration?: MyRegistration | null;
};
export type CourseView = 'all' | 'mine' | 'manage';
export type Profile = {
  prenom: string | null;
  nom: string | null;
  sex: Sex | null;
  revision: number;
};
export type CourseContext = {
  is_member: boolean;
  can_manage: boolean;
  profile: Profile | null;
  mine_count: number;
  attention_count: number;
};
export type CoursePage<T> = {
  items: T[];
  total: number;
  server_now: string;
  received_at: number;
  can_act?: boolean;
};
export type QueueRow = MyRegistration & {
  prenom: string | null;
  nom: string | null;
};

export async function courseRpc<T>(
  name: string,
  args: Record<string, unknown>,
): Promise<T> {
  const { data, error } = await supabase
    .rpc(name, args)
    .abortSignal(AbortSignal.timeout(15000));
  if (error) throw new Error(error.message);
  return data as T;
}
export async function getCoursePage(
  club: string,
  authenticated: boolean,
  view: CourseView,
  offset: number,
  target?: string,
): Promise<CoursePage<Course>> {
  const data = await courseRpc<CoursePage<Course>>(
    authenticated ? 'course_my_page' : 'course_catalog',
    {
      p_club: club,
      p_offset: offset,
      p_target: target ?? null,
      ...(authenticated ? { p_view: view } : {}),
    },
  );
  return { ...data, received_at: Date.now() };
}
export async function getCourseQueue(
  club: string,
  course: string,
  offset: number,
  filter: 'pending' | 'treated',
): Promise<CoursePage<QueueRow>> {
  const data = await courseRpc<CoursePage<QueueRow>>('course_manage_queue', {
    p_club: club,
    p_course: course,
    p_offset: offset,
    p_filter: filter,
  });
  return { ...data, received_at: Date.now() };
}
export const profileComplete = (p?: Profile | null) =>
  Boolean(p?.prenom?.trim() && p.nom?.trim() && p.sex);
export const courseEnd = (c: Course) =>
  Date.parse(c.starts_at) + c.duration_minutes * 60000;
export const bookingOpen = (c: Course, now: number) =>
  !c.cancelled_at && now < Date.parse(c.starts_at) - 4 * 3600000;
export function coursePhase(c: Course, now: number) {
  if (c.cancelled_at) return 'Cours annulé';
  if (now >= courseEnd(c)) return 'Terminé';
  if (now >= Date.parse(c.starts_at)) return 'En cours';
  if (!bookingOpen(c, now)) return 'Inscriptions closes';
  return '';
}
export function courseState(
  c: Course,
  now: number,
): { label: string; tone: string; note: string } {
  if (c.cancelled_at)
    return {
      label: 'Cours annulé',
      tone: 'danger',
      note: 'Ce cours n’aura pas lieu.',
    };
  switch (c.registration?.status) {
    case 'approved':
      return {
        label: 'Inscrit·e',
        tone: 'success',
        note: 'Votre place est confirmée.',
      };
    case 'pending':
      return {
        label: 'Demande envoyée',
        tone: 'warning',
        note:
          now >= courseEnd(c)
            ? 'Terminé — demande non validée.'
            : 'En attente de validation par le club.',
      };
    case 'denied':
      return {
        label: 'Demande refusée',
        tone: 'danger',
        note: c.registration.denial_reason
          ? 'Le club a précisé un motif de refus.'
          : 'Votre demande n’a pas été retenue.',
      };
    case 'cancelled':
      return {
        label: 'Inscription annulée',
        tone: 'neutral',
        note: bookingOpen(c, now)
          ? 'Vous pouvez envoyer une nouvelle demande.'
          : 'Votre inscription est annulée.',
      };
    default:
      return {
        label:
          coursePhase(c, now) ||
          (c.approved_female >= c.capacity_female &&
          c.approved_male >= c.capacity_male
            ? 'Complet'
            : 'Places disponibles'),
        tone: 'neutral',
        note: bookingOpen(c, now)
          ? 'Une demande ne réserve pas de place.'
          : 'Aucune nouvelle demande possible.',
      };
  }
}
export const courseTime = (date: string | number) =>
  new Intl.DateTimeFormat('fr-FR', {
    timeZone: 'Europe/Paris',
    hour: '2-digit',
    minute: '2-digit',
  }).format(new Date(date));
export const courseDay = (date: string) =>
  new Intl.DateTimeFormat('fr-FR', {
    timeZone: 'Europe/Paris',
    weekday: 'long',
    day: 'numeric',
    month: 'long',
  }).format(new Date(date));
export const courseDate = (date: string | number) =>
  new Intl.DateTimeFormat('fr-FR', {
    timeZone: 'Europe/Paris',
    dateStyle: 'medium',
    timeStyle: 'short',
  }).format(new Date(date));
export const quotaLabel = (sex: Sex) =>
  sex === 'female' ? 'Femmes' : 'Hommes';
export function courseImage(path: string | null) {
  return path
    ? supabase.storage.from('course-type-images').getPublicUrl(path).data
        .publicUrl
    : null;
}
const errors: Record<string, string> = {
  FORBIDDEN: 'Vous n’avez plus accès à cette action. Actualisez les cours.',
  NOT_MEMBER:
    'Votre compte doit être rattaché à ce club pour demander une place.',
  PROFILE_INCOMPLETE: 'Complétez votre prénom, nom et sexe pour demander une place.',
  BOOKING_CLOSED:
    'Les demandes et désistements ferment 4 heures avant le cours.',
  COURSE_STARTED: 'Le cours a commencé. Aucune modification n’est possible.',
  COURSE_CANCELLED: 'Le cours a été annulé.',
  VERSION_CONFLICT:
    'Les données ont changé. Relisez le statut actualisé avant de recommencer.',
  QUOTA_FULL: 'Le quota est atteint. Cette demande reste en attente.',
  INVALID_TRANSITION:
    'Cette demande a déjà été traitée ou ne permet plus cette action.',
  REASON_REQUIRED: 'Saisissez un motif de refus entre 1 et 1000 caractères.',
  VALIDATION_ERROR: 'Vérifiez les champs saisis.',
  NOT_FOUND: 'Ce cours n’est plus disponible.',
};
export function courseError(error: unknown) {
  const message = error instanceof Error ? error.message : String(error);
  for (const [key, value] of Object.entries(errors))
    if (message.includes(key)) return value;
  return 'La réponse du serveur est incertaine. Actualisez le statut avant de réessayer. Une relance identique ne crée pas de doublon.';
}
