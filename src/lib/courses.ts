import { supabase } from "./supabase";
export type Sex = "female" | "male";
export type RegistrationStatus =
  "pending" | "approved" | "denied" | "cancelled";
export type CourseType = {
  id: string;
  name: string;
  image_path: string | null;
  archived_at: string | null;
  revision: number;
};
export type Course = {
  id: string;
  type_id: string;
  type_name: string;
  name: string;
  owner_first_name: string | null;
  owner_id: string | null;
  starts_at: string;
  duration_minutes: number;
  capacity_female: number;
  capacity_male: number;
  approved_female: number;
  approved_male: number;
  pending_count: number;
  cancelled_at: string | null;
  revision: number;
  has_registrations: boolean;
};
export type CourseMember = {
  user_id: string;
  prenom: string | null;
  nom: string | null;
  sex: Sex | null;
  revision: number;
  complete: boolean;
};
export type Registration = {
  id: string;
  user_id: string;
  prenom: string;
  nom: string;
  status: RegistrationStatus;
  quota_sex: Sex;
  requested_at: string;
  denial_reason: string | null;
  revision: number;
  course_name?: string;
  starts_at?: string;
};
export type RegistrationEvent = {
  id: string;
  from_status: RegistrationStatus | null;
  to_status: RegistrationStatus;
  occurred_at: string;
  source: string;
  quota_sex: Sex;
  denial_reason: string | null;
};
export const statusLabels: Record<RegistrationStatus, string> = {
  pending: "En attente",
  approved: "Confirmée",
  denied: "Refusée",
  cancelled: "Annulée",
};
const errors: Record<string, string> = {
  OWNER_REQUIRED: "Choisissez un responsable membre de ce club.",
  REASON_REQUIRED: "Renseignez un motif de refus (1 à 1000 caractères).",
  FORBIDDEN: "Cette action est réservée aux administrateurs du club actif.",
  NOT_FOUND: "Élément introuvable dans ce club.",
  VERSION_CONFLICT: "Cet élément a changé. Actualisez avant de recommencer.",
  QUOTA_FULL:
    "Le quota est atteint. Libérez une place ou augmentez la capacité.",
  PROFILE_INCOMPLETE:
    "Un administrateur doit renseigner le prénom, le nom et le sexe de ce membre.",
  NOT_MEMBER: "Cette personne ne fait plus partie du club.",
  COURSE_CANCELLED: "Ce cours est annulé.",
  COURSE_STARTED: "Le cours a déjà commencé : modification impossible.",
  INVALID_TRANSITION: "Ce changement de statut est impossible.",
  ALREADY_REGISTERED:
    "Ce membre a déjà une inscription. Utilisez les actions sur sa demande.",
  SCHEDULE_LOCKED:
    "Des demandes existent : annulez puis recréez le cours pour changer sa date ou sa durée.",
  COURSE_HAS_HISTORY: "Ce cours possède un historique : utilisez l’annulation.",
  TYPE_IN_USE: "Ce type est utilisé : archivez-le.",
  VALIDATION_ERROR: "Vérifiez les champs du formulaire.",
};
export function courseError(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);
  for (const [code, label] of Object.entries(errors))
    if (message.includes(code)) return label;
  if (message.includes("23505") || message.includes("duplicate key"))
    return "Ce nom ou cette inscription existe déjà.";
  if (
    message.includes("check constraint") ||
    message.includes("not-null constraint") ||
    message.includes("invalid input syntax")
  )
    return "Vérifiez les champs obligatoires et les valeurs saisies.";
  if (message.includes("abort") || message.includes("timeout"))
    return "Le serveur ne répond pas. Actualisez l’état avant de réessayer ; une relance identique ne crée pas de doublon.";
  return message;
}
export async function readCourses<T>(
  club: string,
  kind: string,
  target?: string,
  search = "",
  offset = 0,
  filter = "",
): Promise<T[]> {
  const { data, error } = await supabase
    .rpc("course_admin_read", {
      p_club: club,
      p_kind: kind,
      p_target: target ?? null,
      p_search: search,
      p_offset: offset,
      p_filter: filter,
    })
    .abortSignal(AbortSignal.timeout(15000));
  if (error) throw new Error(error.message);
  return data as T[];
}
export async function courseCommand(
  club: string,
  operation: string,
  payload: Record<string, unknown>,
  requestId: string,
) {
  const { data, error } = await supabase
    .rpc("course_admin_command", {
      p_club: club,
      p_operation: operation,
      p_data: payload,
      p_request_id: requestId,
    })
    .abortSignal(AbortSignal.timeout(15000));
  if (error) throw new Error(error.message);
  return data as { id: string; revision: number };
}
export const formatCourseDate = (value: string) =>
  new Intl.DateTimeFormat("fr-FR", {
    timeZone: "Europe/Paris",
    dateStyle: "medium",
    timeStyle: "short",
  }).format(new Date(value));
export function parisInput(value: string) {
  const parts = new Intl.DateTimeFormat("sv-SE", {
    timeZone: "Europe/Paris",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).formatToParts(new Date(value));
  const get = (key: string) => parts.find((p) => p.type === key)?.value;
  return `${get("year")}-${get("month")}-${get("day")}T${get("hour")}:${get("minute")}`;
}
// Deux candidats explicites : les heures inexistantes donnent [], les ambiguës deux choix.
export function parisCandidates(value: string): string[] {
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(value)) return [];
  const utc = Date.parse(`${value}:00Z`);
  if (!Number.isFinite(utc)) return [];
  return [2, 1]
    .map((offset) => new Date(utc - offset * 3600000).toISOString())
    .filter((candidate) => parisInput(candidate) === value);
}
export function courseImage(path: string | null) {
  return path
    ? supabase.storage.from("course-type-images").getPublicUrl(path).data
        .publicUrl
    : null;
}
export async function uploadCourseImage(club: string, file: File) {
  if (file.size > 5 * 1024 * 1024)
    throw new Error("Image trop volumineuse (5 Mo maximum).");
  const bytes = new Uint8Array(await file.slice(0, 12).arrayBuffer());
  const type =
    bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff
      ? "jpg"
      : bytes[0] === 0x89 && String.fromCharCode(...bytes.slice(1, 4)) === "PNG"
        ? "png"
        : String.fromCharCode(...bytes.slice(0, 4)) === "RIFF" &&
            String.fromCharCode(...bytes.slice(8, 12)) === "WEBP"
          ? "webp"
          : null;
  if (!type) throw new Error("Choisissez une image JPEG, PNG ou WebP.");
  const bitmap = await createImageBitmap(file);
  bitmap.close();
  const path = `${club}/course-types/${crypto.randomUUID()}.${type}`;
  const { error } = await supabase.storage
    .from("course-type-images")
    .upload(path, file, {
      contentType: type === "jpg" ? "image/jpeg" : `image/${type}`,
      upsert: false,
    });
  if (error) throw new Error(error.message);
  return path;
}
