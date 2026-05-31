// src/stats.ts — pure per-user stats aggregation (no Cloudflare deps).

export type GameOutcome = "won" | "lost";

export type UserStats = {
  gamesPlayed: number;
  wins: number;
  currentStreak: number;
  bestStreak: number;
  guessDistribution: Record<number, number>;
};

export function emptyStats(): UserStats {
  return { gamesPlayed: 0, wins: 0, currentStreak: 0, bestStreak: 0, guessDistribution: {} };
}

export function applyGame(stats: UserStats, outcome: { result: GameOutcome; guesses: number }): UserStats {
  const next: UserStats = {
    ...stats,
    guessDistribution: { ...stats.guessDistribution },
  };
  next.gamesPlayed += 1;
  if (outcome.result === "won") {
    next.wins += 1;
    next.currentStreak += 1;
    next.bestStreak = Math.max(next.bestStreak, next.currentStreak);
    const g = outcome.guesses;
    next.guessDistribution[g] = (next.guessDistribution[g] ?? 0) + 1;
  } else {
    next.currentStreak = 0;
  }
  return next;
}

/** Prepend `item`, keep at most `cap` (most-recent-first). */
export function appendCapped<T>(list: T[], item: T, cap: number): T[] {
  return [item, ...list].slice(0, cap);
}
