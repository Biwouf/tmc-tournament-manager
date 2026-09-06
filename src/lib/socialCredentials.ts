// Comptes sociaux d'un club (PR8, décision D10) — lecture directe, écriture par function.
//
// LECTURE : `club_social_credentials` a une policy SELECT admin-only et un GRANT par
// COLONNE qui exclut `token` (migration 20260906). D'où le `select` explicite ci-dessous :
// un `select('*')` demanderait la colonne interdite et PostgREST refuserait la requête
// entière. C'est le comportement voulu — le secret ne descend pas dans le navigateur.
//
// ÉCRITURE : aucune policy INSERT/UPDATE/DELETE. Tout passe par l'Edge Function
// `social-credentials`, qui valide le token auprès de Facebook avant d'écrire et qui
// contrôle elle-même que l'appelant est admin du club — le `club_id` envoyé d'ici ne fait
// pas foi.
import { supabase } from './supabase';
import { invokeEdgeFunction } from './functions';

export type SocialPlatform = 'facebook';

export type SocialCredential = {
  club_id: string;
  platform: SocialPlatform;
  page_id: string;
  page_name: string | null;
  token_expires_at: string | null;
  connected_by: string | null;
  created_at: string;
  updated_at: string;
};

const READABLE_COLUMNS =
  'club_id, platform, page_id, page_name, token_expires_at, connected_by, created_at, updated_at';

const FALLBACK = 'Erreur inconnue lors de la gestion des comptes sociaux.';

/** La page Facebook connectée au club, ou `null` si le club n'en a pas. */
export async function getFacebookCredential(clubId: string): Promise<SocialCredential | null> {
  const { data, error } = await supabase
    .from('club_social_credentials')
    .select(READABLE_COLUMNS)
    .eq('club_id', clubId)
    .eq('platform', 'facebook')
    .maybeSingle();
  if (error) throw error;
  return (data as SocialCredential | null) ?? null;
}

/** Valide le token auprès de Facebook puis enregistre la page qu'il désigne. */
export function connectFacebookPage(clubId: string, token: string) {
  return invokeEdgeFunction<{
    page_id: string;
    page_name: string;
    token_expires_at: string | null;
  }>('social-credentials', { club_id: clubId, action: 'connect', token }, FALLBACK);
}

export function disconnectFacebookPage(clubId: string) {
  return invokeEdgeFunction('social-credentials', { club_id: clubId, action: 'disconnect' }, FALLBACK);
}
