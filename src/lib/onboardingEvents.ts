// Onboarding « Ten'Up d'abord », PR P0 — événements internes après activation (table
// `onboarding_events`, migration `2026111502_onboarding_events.sql`). `club_activated` et
// `site_published` sont écrits par la base ; ceux-ci viennent du navigateur.
// Spec : `docs/specs/SAAS_ONBOARDING.md` §14.
import type { SupabaseClient } from '@supabase/supabase-js';

export type ClientOnboardingEvent = 'teams_import_started' | 'teams_imported' | 'poster_generated' | 'app_shared' | 'first_steps_finished';

/**
 * Écrit un événement sans jamais bloquer ni faire échouer le parcours : la mesure est
 * secondaire. Seule propriété admise : `count` pour `teams_imported`.
 */
export async function logOnboardingEvent(
  client: Pick<SupabaseClient, 'rpc'>, clubId: string | null, name: ClientOnboardingEvent, props?: { count: number },
): Promise<void> {
  if (!clubId) return;
  try {
    const { error } = await client.rpc('onboarding_event_log', { p_club: clubId, p_name: name, p_props: props ?? {} });
    if (error) console.warn('[onboarding-events] not recorded', { name, code: error.code });
  } catch {
    console.warn('[onboarding-events] not recorded', { name });
  }
}
