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
  resigned?: boolean;   // gave up (vs ran out of guesses) — drives the 💀 board marker
  isBot?: boolean;
  goldAwarded?: number | null;
  grid?: string[];      // letterless color rows ("g"/"y"/"x") — home card's swappable card
  durationMs?: number;  // first guess → finish; omitted when unknown
};

export type LeaderEntry = {
  username: string; gold: number; guesses: number; won: boolean;
  resigned?: boolean; grid?: string[]; durationMs?: number;
};
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

// Shared filter + sort + map. A player is RANKED iff non-bot with a confirmed mint
// (goldAwarded is a number). Sort: gold desc → fewer guesses → username asc.
function rankedEntries(players: RankablePlayer[]): LeaderEntry[] {
  return (players ?? [])
    .filter((pl) => pl && !pl.isBot && typeof pl.goldAwarded === "number")
    .map((pl) => ({
      username: pl.username, gold: pl.goldAwarded as number, guesses: pl.guessCount,
      won: pl.won, resigned: pl.resigned, grid: pl.grid, durationMs: pl.durationMs,
    }))
    .sort((a, b) =>
      b.gold - a.gold ||
      a.guesses - b.guesses ||
      (a.username < b.username ? -1 : a.username > b.username ? 1 : 0));
}

export function topDaily(players: RankablePlayer[], username: string, n: number): LeaderboardView {
  const ranked = rankedEntries(players);
  const size = clampN(n);
  const top = ranked.slice(0, size);
  const meIdx = ranked.findIndex((e) => e.username === username);
  const you = meIdx >= size ? { ...ranked[meIdx], rank: meIdx + 1 } : null;
  return { top, you, total: ranked.length };
}
