import { useRef, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { supabase } from '../lib/supabase';

export function useTeamAction(clubId: string | null, rencontreId: string) {
  const client = useQueryClient();
  const lock = useRef(false);
  const request = useRef({ fingerprint: '', id: '' });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  async function call<T>(operation: string, data: Record<string, unknown>) {
    if (lock.current || !clubId) return null;
    lock.current = true; setBusy(true); setError('');
    const fingerprint = JSON.stringify([clubId, rencontreId, operation, data]);
    if (request.current.fingerprint !== fingerprint) request.current = { fingerprint, id: crypto.randomUUID() };
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 15_000);
    try {
      // La compo crée tous les simples d'un coup via sa propre commande serveur.
      const { data: result, error: failure } = await (operation === 'compo'
        ? supabase.rpc('team_compo_command', { p_club: clubId, p_rencontre: rencontreId, p_data: data, p_request_id: request.current.id })
        : supabase.rpc('team_match_command', {
          p_club: clubId, p_rencontre: rencontreId, p_operation: operation, p_data: data, p_request_id: request.current.id,
        })).abortSignal(controller.signal);
      if (failure) throw failure;
      request.current = { fingerprint: '', id: '' };
      await Promise.all([
        client.invalidateQueries({ queryKey: ['team-detail', clubId, rencontreId] }),
        client.invalidateQueries({ queryKey: ['team-rencontres'] }),
        client.invalidateQueries({ queryKey: ['matches', clubId] }),
      ]);
      return result as T;
    } catch (e) {
      setError(e && typeof e === 'object' && 'message' in e ? String(e.message) : 'Enregistrement impossible. Réessayez.');
      return null;
    } finally { clearTimeout(timer); lock.current = false; setBusy(false); }
  }
  const run = (operation: string, data: Record<string, unknown>) => call<{ id: string | null; live_match_id: string | null }>(operation, data);
  const compose = (data: Record<string, unknown>) => call<{ ids: string[]; classements_mis_a_jour: number }>('compo', data);
  return { run, compose, busy, error, clearError: () => setError('') };
}
