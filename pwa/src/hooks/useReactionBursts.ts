import { useEffect, useRef, useState } from 'react';
import { LIVE_REACTIONS, type LiveReaction } from '../lib/liveActivity';
import { nextReaction, type ReactionStreak } from '../lib/reactionCombo';

// Mounted inside a screen keyed by club, match and account.
export function useReactionBursts(matchId: string | undefined) {
  const [bursts, setBursts] = useState<
    { id: string; user: string; emoji: string; combo: boolean }[]
  >([]);
  const streaks = useRef(new Map<string, ReactionStreak | null>());
  const seen = useRef(new Set<string>());
  useEffect(() => {
    if (!bursts.length) return;
    const timer = setTimeout(() => setBursts([]), 2300);
    return () => clearTimeout(timer);
  }, [bursts]);
  function receive(event: LiveReaction) {
    if (
      event.match_id !== matchId ||
      seen.current.has(event.id) ||
      !LIVE_REACTIONS.some(([emoji]) => emoji === event.emoji)
    )
      return;
    if (Date.now() - Date.parse(event.created_at) > 15000) return;
    seen.current.add(event.id);
    if (seen.current.size > 500)
      seen.current.delete(seen.current.values().next().value!);
    const result = nextReaction(
      streaks.current.get(event.user_id) ?? null,
      event.emoji,
      Date.parse(event.created_at),
    );
    if (streaks.current.size > 200) streaks.current.clear();
    streaks.current.set(event.user_id, result.streak);
    setBursts((b) => [
      ...(result.combo
        ? b.filter(
            (item) => item.user !== event.user_id || item.emoji !== event.emoji,
          )
        : b
      ).slice(-11),
      {
        id: event.id,
        user: event.user_id,
        emoji: event.emoji,
        combo: result.combo,
      },
    ]);
  }
  return {
    bursts,
    receive,
    remove: (id: string) =>
      setBursts((b) => b.filter((item) => item.id !== id)),
  };
}
