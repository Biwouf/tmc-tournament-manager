import { useEffect, useRef, useState } from 'react';
import {
  useInfiniteQuery,
  useQueryClient,
  type InfiniteData,
} from '@tanstack/react-query';
import {
  activityCommand,
  mergeActivityHead,
  readActivity,
  type LiveActivityPage,
} from '../lib/liveActivity';
import { matchTopic } from '../lib/liveChannel';
import { LIVE_SAFETY_POLL, useLiveTopic } from './useLiveTopic';

type Feed = InfiniteData<LiveActivityPage, number | null>;

export function useLiveActivity(
  match: string | undefined,
  club: string | null,
  user: string | null,
) {
  const client = useQueryClient();
  const locked = useRef(false);
  const generation = useRef(0);
  const request = useRef({ fingerprint: '', id: '' });
  const burst = useRef<{
    timer?: ReturnType<typeof setTimeout>;
    full: boolean;
    sequence: number | null;
  }>({ full: false, sequence: null });
  const [busy, setBusy] = useState(false);
  const [actionError, setActionError] = useState('');
  const [reacting, setReacting] = useState<string[]>([]);
  const key = ['live-activity', club, match, user];
  // Un topic par match, indépendant du compte : se connecter ne rouvre pas le canal.
  const subscribed = useLiveTopic(
    match && club ? matchTopic(match) : null,
    ({ event, payload }) => {
      if (event === 'subscribed') schedule(null, true);
      else if (event === 'post') {
        // Écho de sa propre publication, déjà affichée par la lecture qui suit la commande.
        if (payload.op === 'INSERT' && sequenceOf(payload.id) !== undefined)
          return;
        schedule(
          typeof payload.sequence === 'number' ? payload.sequence : null,
          false,
        );
      }
    },
  );
  const page = useInfiniteQuery({
    queryKey: key,
    enabled: !!match && !!club,
    initialPageParam: null as number | null,
    queryFn: ({ pageParam }) => readActivity(match!, club!, pageParam),
    getNextPageParam: (p) => (p.has_more ? p.before : undefined),
    // Le Broadcast pousse les changements : le polling n'est qu'un secours, ou un filet.
    refetchInterval: subscribed ? LIVE_SAFETY_POLL : 15000,
    refetchOnWindowFocus: 'always',
    staleTime: 0,
  });
  function sequenceOf(id: unknown) {
    return client
      .getQueryData<Feed>(key)
      ?.pages.flatMap((p) => p.items)
      .find((p) => p.id === id)?.sequence;
  }
  /**
   * Relit la tête du fil et la fusionne dans la première page. Ne recharge tout le fil que si
   * le changement touche une page plus ancienne, ou est inconnu (`full`).
   */
  async function refreshHead(sequence: number | null, full = false) {
    if (!match || !club) return;
    const data = client.getQueryData<Feed>(key);
    const first = data?.pages[0];
    if (
      full ||
      !data ||
      data.pages.length < 2 ||
      first?.before == null ||
      (sequence !== null && sequence < first.before)
    ) {
      // Une seule page chargée : l'invalidation ne coûte qu'une lecture.
      await client.invalidateQueries({ queryKey: key, exact: true });
      return;
    }
    const head = await readActivity(match, club, null);
    client.setQueryData<Feed>(key, (old) =>
      old && old.pages[0] === first
        ? {
            ...old,
            pages: [mergeActivityHead(first, head), ...old.pages.slice(1)],
          }
        : old,
    );
  }
  function schedule(sequence: number | null, full: boolean) {
    const b = burst.current;
    b.full ||= full;
    if (sequence !== null)
      b.sequence = b.sequence === null ? sequence : Math.min(b.sequence, sequence);
    if (b.timer) return;
    const version = generation.current;
    b.timer = setTimeout(() => {
      const { full: all, sequence: lowest } = burst.current;
      burst.current = { full: false, sequence: null };
      if (version === generation.current)
        void refreshHead(lowest, all).catch(() => undefined);
    }, 200);
  }
  useEffect(() => {
    const version = ++generation.current;
    locked.current = false;
    setBusy(false);
    setActionError('');
    setReacting([]);
    request.current = { fingerprint: '', id: '' };
    if (!match || !club) return;
    const refresh = () => schedule(null, true);
    window.addEventListener('online', refresh);
    return () => {
      generation.current = version + 1;
      clearTimeout(burst.current.timer);
      burst.current = { full: false, sequence: null };
      window.removeEventListener('online', refresh);
    };
    // `schedule` ne lit que des refs et la clé du rendu courant.
    // eslint-disable-next-line react-hooks/exhaustive-deps
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
      // Nouvelle publication : en tête ; vote, clôture, suppression : là où se trouve le post.
      await refreshHead(sequenceOf(input.id) ?? null).catch(() => undefined);
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
        await refreshHead(sequenceOf(post) ?? null).catch(() => undefined);
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
