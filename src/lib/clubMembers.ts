// Appels typés de l'Edge Function `club-members` (PR5-bis) — lister les membres d'un
// club, changer un rôle, retirer quelqu'un, relancer une invitation.
//
// Tout passe par la function en service role : l'email et le statut « invitation en
// attente » vivent dans `auth.users`, hors de portée de la clé anon, et `club_members`
// n'a aucune policy d'écriture (docs/specs/MULTI_TENANT.md §4.2). L'autorisation
// — admin de CE club, ou super-admin — est vérifiée côté serveur ; le `club_id` envoyé
// ici ne fait pas foi.
import { invokeEdgeFunction, type EdgeResult } from './functions';
import type { ClubRole } from '../contexts/ClubRoleContext';

export type ClubMember = {
  user_id: string;
  email: string;
  prenom: string;
  nom: string;
  role: ClubRole;
  created_at: string;
  // pending = compte créé par l'invitation mais jamais activé (last_sign_in_at nul).
  status: 'active' | 'pending';
};

const FALLBACK = 'Erreur inconnue lors de la gestion des membres.';

export function listClubMembers(clubId: string) {
  return invokeEdgeFunction<{ members: ClubMember[] }>(
    'club-members',
    { club_id: clubId, action: 'list' },
    FALLBACK,
  );
}

export function setClubMemberRole(clubId: string, userId: string, role: ClubRole) {
  return invokeEdgeFunction(
    'club-members',
    { club_id: clubId, action: 'set-role', user_id: userId, role },
    FALLBACK,
  );
}

export function removeClubMember(clubId: string, userId: string) {
  return invokeEdgeFunction(
    'club-members',
    { club_id: clubId, action: 'remove', user_id: userId },
    FALLBACK,
  );
}

// `email_sent` dit ce qui s'est réellement passé : un email est reparti, ou seul un
// lien a pu être régénéré (§7 du brief). L'UI doit annoncer l'un ou l'autre, pas le
// résultat espéré.
export type ResendResult = EdgeResult<{
  email: string;
  email_sent: boolean;
  action_link?: string;
}>;

export function resendClubInvite(
  clubId: string,
  userId: string,
  redirectTo: string,
): Promise<ResendResult> {
  return invokeEdgeFunction(
    'club-members',
    { club_id: clubId, action: 'resend-invite', user_id: userId, redirectTo },
    FALLBACK,
  );
}
