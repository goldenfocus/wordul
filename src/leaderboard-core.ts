// src/leaderboard-core.ts — pure daily-leaderboard ranking (no Cloudflare deps,
// unit-tested). The daily Room DO already holds every player's gold + guesses in
// state.players; this turns that into a top-N board + the caller's own rank.

// Decoupled input shape: the Room maps its PlayerState[] into this so the module
// stays dependency-free. A player is RANKED iff they have a confirmed mint
// (goldAwarded is a number) and are not a bot.
export type RankablePlayer = {
  username: string;
  guessCount: number;
  won: boolean;
  isBot?: boolean;
  goldAwarded?: number | null;
};

export type LeaderEntry = { username: string; gold: number; guesses: number; won: boolean };
export type LeaderboardView = {
  top: LeaderEntry[];                            // top N by gold desc, then fewer guesses
  you: (LeaderEntry & { rank: number }) | null;  // caller's row + 1-based rank, ONLY when outside top N
  total: number;                                 // count of ranked players
};

function clampN(n: number): number {
  const v = Math.floor(n);
  if (!Number.isFinite(v) || v <= 0) return 3;
  return Math.min(10, v);
}

export function topDaily(players: RankablePlayer[], username: string, n: number): LeaderboardView {
  const ranked: LeaderEntry[] = (players ?? [])
    .filter((p) => p && !p.isBot && typeof p.goldAwarded === "number")
    .map((p) => ({ username: p.username, gold: p.goldAwarded as number, guesses: p.guessCount, won: p.won }))
    .sort((a, b) =>
      b.gold - a.gold ||
      a.guesses - b.guesses ||
      (a.username < b.username ? -1 : a.username > b.username ? 1 : 0));

  const size = clampN(n);
  const top = ranked.slice(0, size);
  const meIdx = ranked.findIndex((e) => e.username === username);
  const you = meIdx >= size ? { ...ranked[meIdx], rank: meIdx + 1 } : null;
  return { top, you, total: ranked.length };
}
