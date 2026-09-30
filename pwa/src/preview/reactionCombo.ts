export type ReactionStreak = { emoji: string; startedAt: number; count: number };

// A different emoji, a completed combo or a two-second window starts a new streak.
export function nextReaction(streak: ReactionStreak | null, emoji: string, now: number) {
  const continues = streak && streak.emoji === emoji && now - streak.startedAt < 2000;
  const next = continues ? { ...streak, count: streak.count + 1 } : { emoji, startedAt: now, count: 1 };
  const combo = next.count === 4;
  return { combo, streak: combo ? null : next };
}
