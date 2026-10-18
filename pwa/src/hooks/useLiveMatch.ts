import { useCallback, useEffect, useRef, useState } from 'react';
import { supabase } from '../lib/supabase';
import { LIVE_SAFETY_POLL, listenLiveTopic, matchTopic } from '../lib/liveChannel';
import { writeLiveMatch, readLiveMatch, hasLiveMatchRevision } from '../lib/liveMatchWrites';
import type { LiveMatch } from '../types';

/** Lecture publique ; une sauvegarde en vol, autorité serveur et événements versionnés. */
export function useLiveMatch(id: string | undefined, clubId: string | null, userId: string | null, canEdit?: boolean) {
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
    if (!id || !clubId) return;
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
  }, [id, clubId, receive]);

  useEffect(() => {
    const lifetime = ++generation.current;
    current.current = null;
    busy.current = false;
    setMatch(null);
    setLoading(true);
    setSaving(false);
    setSavingError(null);
    setError(null);
    if (!id || !clubId) return;
    let active = true;
    let subscribed = false;
    let lastRead = Date.now();
    const revalidate = () => { lastRead = Date.now(); void reload(); };
    // Broadcast publié en base (live:match:<id>) : la ligne complète après chaque écriture.
    const stop = listenLiveTopic(supabase, matchTopic(id), {
      onMessage: ({ event, payload }) => {
        if (active && event === 'score' && payload.row) receive(payload.row as LiveMatch);
      },
      onStatus: ok => {
        subscribed = ok;
        if (active && ok) revalidate();
      },
    });
    revalidate();
    // Revalidation après une coupure ; polling de secours si le canal est indisponible, sinon simple filet.
    const refresh = () => { if (document.visibilityState !== 'hidden' && !busy.current) revalidate(); };
    const tick = () => { if (!subscribed || Date.now() - lastRead >= LIVE_SAFETY_POLL) refresh(); };
    window.addEventListener('online', refresh);
    window.addEventListener('focus', refresh);
    const timer = setInterval(tick, 30_000);
    return () => {
      active = false;
      generation.current = lifetime + 1;
      clearInterval(timer);
      window.removeEventListener('online', refresh);
      window.removeEventListener('focus', refresh);
      stop();
    };
  }, [id, clubId, userId, receive, reload]);

  const save = useCallback(async (patch: Partial<LiveMatch>) => {
    const base = current.current;
    if (!base || !userId || busy.current || !(canEdit ?? base.scored_by === userId)) return;
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
      if (version !== generation.current) return;
      receive(row);
      return row;
    } catch (e) {
      if (version === generation.current) {
        await reload();
        if (version === generation.current) setSavingError(e instanceof Error ? e.message : 'Sauvegarde impossible.');
      }
    } finally {
      if (version === generation.current) { busy.current = false; setSaving(false); }
    }
  }, [clubId, userId, receive, reload, match, canEdit]);
  return { match, loading, error, saving, savingError, save, reload };
}
