// Synchronisation Ten'Up groupée : logique pure (sans React), testée dans
// tests/tenup-batch.test.mjs.
import type { TenupSyncProps } from '../../../shared/TenupSync';
import type { RencontreEntry } from './gridTypes';

export const TENUP_BATCH_DAYS = { min: 1, max: 60, default: 7 };
// `team_tenup_begin` refuse plus de 3 aperçus par minute et par utilisateur :
// un aperçu toutes les 21 s n'atteint jamais le quota.
export const TENUP_BATCH_SPACING_MS = 21_000;
const QUOTA_RETRY_MS = 61_000;

/**
 * Rencontres créées depuis Ten'Up (lien et côté connus), jamais synchronisées,
 * jouées dans les `days` derniers jours — de la plus ancienne à la plus récente.
 */
export function tenupBatchCandidates(entries: RencontreEntry[], days: number, now = Date.now()) {
  const from = now - days * 86_400_000;
  return entries
    .filter(({ rencontre: r }) => {
      const t = Date.parse(r.date_heure);
      return !!r.tenup_url && r.tenup_side != null && !r.wo && !r.tenup_synced_at && t >= from && t <= now;
    })
    .sort((a, b) => Date.parse(a.rencontre.date_heure) - Date.parse(b.rencontre.date_heure));
}

export type TenupBatchStatus = 'pending' | 'running' | 'imported' | 'failed' | 'cancelled';
export interface TenupBatchItem { id: string; url: string; side: number }

interface Deps {
  clientFor: (rencontreId: string) => Pick<TenupSyncProps, 'preview' | 'apply'>;
  onUpdate: (id: string, status: TenupBatchStatus, message?: string) => void;
  shouldStop: () => boolean;
  sleep?: (ms: number) => Promise<void>;
  now?: () => number;
}

const errorMessage = (e: unknown) => (e instanceof Error ? e.message : 'Synchronisation impossible.');

/**
 * Enchaîne aperçu puis import pour chaque rencontre, une à la fois. Une feuille
 * indisponible n'interrompt pas le lot ; l'arrêt prend effet avant la rencontre suivante.
 */
export async function runTenupBatch(items: TenupBatchItem[], deps: Deps) {
  const sleep = deps.sleep ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)));
  const now = deps.now ?? Date.now;
  let lastStart = -Infinity;
  for (const item of items) {
    if (deps.shouldStop()) { deps.onUpdate(item.id, 'cancelled'); continue; }
    deps.onUpdate(item.id, 'running');
    const client = deps.clientFor(item.id);
    try {
      let preview;
      for (let attempt = 0; ; attempt++) {
        await sleep(Math.max(0, lastStart + TENUP_BATCH_SPACING_MS - now()));
        if (deps.shouldStop()) break;
        lastStart = now();
        try { preview = await client.preview(item.url); break; }
        catch (e) {
          // Quota déjà entamé (synchro manuelle juste avant) : une seule relance.
          if (attempt === 0 && /Trop de demandes/.test(errorMessage(e))) { await sleep(QUOTA_RETRY_MS); continue; }
          throw e;
        }
      }
      if (!preview) { deps.onUpdate(item.id, 'cancelled'); continue; }
      const result = await client.apply(preview.id, item.side);
      deps.onUpdate(item.id, 'imported', `${result.imported} match(s) importé(s)`);
    } catch (e) {
      deps.onUpdate(item.id, 'failed', errorMessage(e));
    }
  }
}
