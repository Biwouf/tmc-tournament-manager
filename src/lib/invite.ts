// Appel de l'Edge Function `invite-user`, partagé entre le panneau d'invitation de
// l'écran Membres (MembersPage) et l'invitation du premier admin d'un club fraîchement
// provisionné par le super-admin (SuperAdminPage).
//
// Contrat de la function (PR4) : { email, redirectTo, action, club_id, role }.
// `club_id` et `role` sont obligatoires, et l'autorisation est vérifiée côté serveur
// (admin du club demandé, ou super-admin) — le club envoyé par le front ne fait pas foi.
//
// PR5-bis : le parsing d'erreur non-2xx vit désormais dans `lib/functions.ts`, partagé
// avec `club-members`.
import { invokeEdgeFunction, type EdgeResult } from './functions';

export type InvokeResult = EdgeResult<{ action_link?: string; already_existed?: boolean }>;

export function invokeInvite(body: Record<string, unknown>): Promise<InvokeResult> {
  return invokeEdgeFunction('invite-user', body, 'Erreur inconnue lors de l’envoi de l’invitation.');
}
