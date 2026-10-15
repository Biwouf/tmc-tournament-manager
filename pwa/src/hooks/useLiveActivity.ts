import { useEffect, useRef, useState } from 'react';
import { useInfiniteQuery, useQueryClient } from '@tanstack/react-query';
import { supabase } from '../lib/supabase';
import { activityCommand, readActivity } from '../lib/liveActivity';

export function useLiveActivity(
  match: string | undefined,
  club: string | null,
  user: string | null,
) {
  const client = useQueryClient();
  const locked = useRef(false);
  const generation = useRef(0);
  const request = useRef({ fingerprint: '', id: '' });
  const [busy, setBusy] = useState(false);
  const [actionError, setActionError] = useState('');
  const [reacting, setReacting] = useState<string[]>([]);
  const key = ['live-activity', club, match, user];
  const page = useInfiniteQuery({
    queryKey: key,
    enabled: !!match && !!club,
    initialPageParam: null as number | null,
    queryFn: ({ pageParam }) => readActivity(match!, club!, pageParam),
    getNextPageParam: (p) => (p.has_more ? p.before : undefined),
    refetchInterval: 15000,
    refetchOnWindowFocus: 'always',
    staleTime: 0,
  });
  useEffect(() => {
    const version = ++generation.current;
    locked.current = false;
    setBusy(false);
    setActionError('');
    setReacting([]);
    request.current = { fingerprint: '', id: '' };
    if (!match || !club) return;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let active = true;
    const refresh = () => {
      if (timer) return;
      timer = setTimeout(() => {
        timer = undefined;
        if (active)
          void client.invalidateQueries({
            queryKey: ['live-activity', club, match],
          });
      }, 200);
    };
    const channel = supabase
      .channel(`activity_${club}_${match}_${user ?? 'guest'}`)
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'live_posts',
          filter: `match_id=eq.${match}`,
        },
        refresh,
      )
      .subscribe((status) => {
        if (status === 'SUBSCRIBED') refresh();
      });
    window.addEventListener('online', refresh);
    return () => {
      active = false;
      generation.current = version + 1;
      clearTimeout(timer);
      window.removeEventListener('online', refresh);
      void supabase.removeChannel(channel);
    };
  }, [match, club, user, client]);
  async function run(
    action: string,
    input: Record<string, unknown>,
  ): Promise<boolean> {
    if (!match || !club || !user || locked.current) return false;
    const lifetime = generation.current;
    locked.current = true;
    setBusy(true);
    setActionError('');
    const fingerprint = JSON.stringify([match, club, action, input]);
    if (request.current.fingerprint !== fingerprint)
      request.current = { fingerprint, id: crypto.randomUUID() };
    try {
      await activityCommand(
        match,
        club,
        action,
        action === 'message' || action === 'poll'
          ? { ...input, id: request.current.id }
          : input,
      );
      if (lifetime !== generation.current) return false;
      request.current = { fingerprint: '', id: '' };
      await client.invalidateQueries({
        queryKey: ['live-activity', club, match],
      });
      return true;
    } catch (error) {
      if (lifetime === generation.current)
        setActionError(
          error instanceof Error ? error.message : 'Enregistrement impossible.',
        );
      return false;
    } finally {
      if (lifetime === generation.current) {
        locked.current = false;
        setBusy(false);
      }
    }
  }
  // Indépendant de `run` : réagir ne bloque ni la publication ni les autres posts.
  async function react(post: string, emoji: string | null) {
    if (!match || !club || !user) return;
    const lifetime = generation.current;
    setReacting((ids) => [...ids, post]);
    setActionError('');
    try {
      await activityCommand(match, club, 'react', { id: post, emoji });
      if (lifetime === generation.current)
        await client.invalidateQueries({
          queryKey: ['live-activity', club, match],
        });
    } catch (error) {
      if (lifetime === generation.current)
        setActionError(
          error instanceof Error ? error.message : 'Réaction non enregistrée.',
        );
    } finally {
      if (lifetime === generation.current)
        setReacting((ids) => ids.filter((id) => id !== post));
    }
  }
  const items = [
    ...new Map(
      page.data?.pages.flatMap((p) => p.items).map((p) => [p.id, p]) ?? [],
    ).values(),
  ].sort((a, b) => a.sequence - b.sequence);
  return {
    ...page,
    items,
    canAnimate: page.data?.pages[0]?.can_animate ?? false,
    busy,
    actionError,
    run,
    reacting,
    react,
  };
}
