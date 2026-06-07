// public/daily-stats.js — pure view-models for the daily Stats page.
// EVERYTHING on the page derives from one source: the daily room's full roster
// (/api/daily/<date>/leaderboard?full=1). The Science feed still powers /feed (the
// Lab) but is no longer used here — it is day-sharded across ALL modes (rooms,
// challenges, daily) and counts rounds, not people, which made the tiles disagree
// with the player list (Jun 6 incident: "2 PLAYED" above a 4-player roster).

export function computeDailyStatsFromRoster(full) {
  const rows = (full && Array.isArray(full.players)) ? full.players : [];
  const played = rows.length;
  const wins = rows.filter((r) => r.won).length;
  const losses = rows.filter((r) => !r.won && !r.resigned).length;
  const winRate = played > 0 ? Math.round((wins / played) * 100) : null;

  // Guess distribution over SOLVES (a loser's row count is not a solve).
  let weighted = 0;
  let maxCount = 0;
  const distRows = [];
  for (let g = 1; g <= 8; g++) {
    const count = rows.filter((r) => r.won && r.guesses === g).length;
    if (count > 0) weighted += g * count;
    if (count > maxCount) maxCount = count;
    distRows.push({ guesses: g, count });
  }
  const avgGuesses = wins > 0 ? weighted / wins : null;

  const scores = rows.filter((r) => typeof r.score === "number");
  const avgScore = scores.length > 0
    ? scores.reduce((sum, r) => sum + r.score, 0) / scores.length
    : null;

  return { played, wins, losses, winRate, avgGuesses, avgScore, distRows, maxCount };
}

// Shape the full-roster API response ({ players:[{rank,username,gold,guesses,won,resigned,durationMs,grid,words?}], youRank, total })
// into rows ready to render, marking the viewer's own row. Pure — no DOM. Keeps
// resigned (skull vs cross), grid/words (tap-to-replay; words only arrive finisher-
// gated) and durationMs (shown in the replay modal, never inline in the row).
export function computeRosterView(full, me) {
  const players = (full && Array.isArray(full.players)) ? full.players : [];
  const rows = players.map((e) => ({
    rank: e.rank,
    username: e.username,
    gold: e.gold,
    guesses: e.guesses,
    won: !!e.won,
    resigned: !!e.resigned,
    grid: e.grid,
    words: e.words,
    durationMs: e.durationMs,
    isYou: e.username === me,
  }));
  return { rows, total: (full && typeof full.total === "number") ? full.total : rows.length };
}

// The share line for a day's recap — spoiler-free, written to make a friend want to
// try (never the answer, never the stats URL — the caller pairs it with the PLAY link).
// Pure for tests: rows are computeRosterView rows; the viewer's row keys the message.
export function buildDayShareLine(rows, total) {
  const mine = Array.isArray(rows) ? rows.find((r) => r.isYou) : null;
  if (mine && mine.won) {
    return `I'm #${mine.rank} of ${total} on today's Wordul — solved in ${mine.guesses}. Your turn.`;
  }
  if (mine) return `Today's Wordul got me. Avenge me?`;
  return `One word a day. Today's Wordul is waiting.`;
}
