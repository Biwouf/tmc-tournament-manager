// Onboarding « Ten'Up d'abord », PR P0 — événements internes après activation (table
// `onboarding_events`, migration `2026111502_onboarding_events.sql`). `club_activated` et
// `site_published` sont écrits par la base ; ceux-ci viennent du navigateur. W1 (story vidéo en
// vedette) ajoute les quatre `video_*` (migration `2026111903_onboarding_video_events.sql`).
// Spec : `docs/specs/SAAS_ONBOARDING.md` §14.
import type { SupabaseClient } from '@supabase/supabase-js';

/** Raison d'un échec de la vidéo : un code court, jamais un message d'erreur brut. */
export type VideoFailure = 'encode' | 'share';

/** Propriétés admises par événement (la RPC refuse toute autre clé). */
type EventProps = {
  teams_import_started: undefined;
  teams_imported: { count: number };
  poster_generated: undefined;
  app_shared: undefined;
  first_steps_finished: undefined;
  /** Aperçu animé vu 3 s. */
  video_previewed: undefined;
  /** Durée de la vidéo (s), temps d'encodage (ms), poids (octets) : entiers. */
  video_exported: { seconds: number; ms: number; bytes: number };
  video_shared: { method: 'share' | 'download' };
  video_export_failed: { reason: VideoFailure };
};

export type ClientOnboardingEvent = keyof EventProps;

/**
 * Écrit un événement sans jamais bloquer ni faire échouer le parcours : la mesure est
 * secondaire.
 */
export async function logOnboardingEvent<N extends ClientOnboardingEvent>(
  client: Pick<SupabaseClient, 'rpc'>, clubId: string | null, name: N, ...props: EventProps[N] extends undefined ? [] : [EventProps[N]]
): Promise<void> {
  if (!clubId) return;
  try {
    const { error } = await client.rpc('onboarding_event_log', { p_club: clubId, p_name: name, p_props: props[0] ?? {} });
    if (error) console.warn('[onboarding-events] not recorded', { name, code: error.code });
  } catch {
    console.warn('[onboarding-events] not recorded', { name });
  }
}
