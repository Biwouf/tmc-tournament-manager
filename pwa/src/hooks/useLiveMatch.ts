import { useCallback, useEffect, useRef, useState } from 'react';
import { supabase } from '../lib/supabase';
import { writeLiveMatch, readLiveMatch, hasLiveMatchRevision } from '../lib/liveMatchWrites';
import type { LiveMatch } from '../types';

/** Copie BO/PWA : une sauvegarde en vol, autorité serveur et événements versionnés. */
export function useLiveMatch(id: string | undefined, clubId: string | null, userId: string | null) {
  const [match, setMatch] = useState<LiveMatch | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [savingError, setSavingError] = useState<string | null>(null);
  const current = useRef<LiveMatch | null>(null);
  const busy = useRef(false);
  const generation = useRef(0);
  const reads = useRef(0);
  const receive = useCallback((row: LiveMatch) => {
    // Ignorer un événement incomplet ; une lecture valide peut réparer un ancien état HMR.
    if (!hasLiveMatchRevision(row)) return;
    if (!current.current || !hasLiveMatchRevision(current.current) || row.revision > current.current.revision) {
      current.current = row;
      setMatch(row);
    }
  }, []);

  const reload = useCallback(async () => {
    if (!id || !clubId || !userId) return;
    const version = generation.current;
    const read = ++reads.current;
    try {
      const row = await readLiveMatch(id, clubId);
      if (generation.current !== version || reads.current !== read) return;
      receive(row);
      setError(null);
      setSavingError(null);
    } catch (e) {
      if (generation.current === version && reads.current === read) setError(e instanceof Error ? e.message : 'Connexion impossible.');
    } finally { if (generation.current === version && reads.current === read) setLoading(false); }
  }, [id, clubId, userId, receive]);

  useEffect(() => {
    const lifetime = ++generation.current;
    current.current = null;
    busy.current = false;
    setMatch(null);
    setLoading(true);
    setSaving(false);
    setSavingError(null);
    setError(null);
    if (!id || !clubId || !userId) return;
    let active = true;
    const channel = supabase.channel(`score_${id}_${userId}`)
      .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'live_matches', filter: `id=eq.${id}` }, payload => {
        if (active) receive(payload.new as LiveMatch);
      })
      .subscribe(status => {
        if (active && status === 'SUBSCRIBED') void reload();
      });
    void reload();
    // Revalidation après une coupure et filet de secours si le canal est indisponible.
    const refresh = () => { if (document.visibilityState !== 'hidden' && !busy.current) void reload(); };
    window.addEventListener('online', refresh);
    window.addEventListener('focus', refresh);
    const timer = setInterval(refresh, 30_000);
    return () => {
      active = false;
      generation.current = lifetime + 1;
      clearInterval(timer);
      window.removeEventListener('online', refresh);
      window.removeEventListener('focus', refresh);
      void supabase.removeChannel(channel);
    };
  }, [id, clubId, userId, receive, reload]);

  const save = useCallback(async (patch: Partial<LiveMatch>) => {
    const base = current.current;
    if (!base || !userId || busy.current || base.scored_by !== userId) return;
    if (base.revision !== match?.revision) {
      setSavingError('Le score vient de changer. Vérifiez-le avant de continuer.');
      return;
    }
    busy.current = true; // Verrou synchrone : protège aussi deux clics dans le même rendu.
    setSaving(true);
    setSavingError(null);
    const version = generation.current;
    try {
      const row = await writeLiveMatch(base, clubId, patch);
      if (version === generation.current) receive(row);
    } catch (e) {
      if (version === generation.current) {
        await reload();
        if (version === generation.current) setSavingError(e instanceof Error ? e.message : 'Sauvegarde impossible.');
      }
    } finally {
      if (version === generation.current) { busy.current = false; setSaving(false); }
    }
  }, [clubId, userId, receive, reload, match]);
  return { match, loading, error, saving, savingError, save, reload };
}
