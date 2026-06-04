// public/daily-stats.js — pure view-model for the daily Stats page.
// Takes a SciencePublicDailySummary (privacy-preserving public aggregates) and
// derives only what we can honestly show: play count, solve rate, average guesses
// (among solves), average score, and a guess-distribution for bars. No usernames
// exist in the source, so no leaderboard here — that's a deliberate fast-follow.

export function computeDailyStatsView(summary) {
  const totals = (summary && summary.totals) || {};
  const outcomes = (summary && summary.outcomes) || {};

  const played = totals.roundsStarted ?? totals.playerFinishes ?? 0;
  const wins = totals.wins ?? 0;
  const losses = totals.losses ?? 0;
  const resigns = totals.resigns ?? 0;
  const finished = wins + losses + resigns;
  const winRate = finished > 0 ? Math.round((wins / finished) * 100) : null;

  // Guess distribution covers solved games keyed by guess count ("1".."8").
  const dist = outcomes.guessDistribution || {};
  let weighted = 0;
  let solved = 0;
  let maxCount = 0;
  const distRows = [];
  for (let g = 1; g <= 8; g++) {
    const count = dist[g] ?? dist[String(g)] ?? 0;
    if (count > 0) { weighted += g * count; solved += count; }
    if (count > maxCount) maxCount = count;
    distRows.push({ guesses: g, count });
  }
  const avgGuesses = solved > 0 ? weighted / solved : null;
  const avgScore = outcomes.points && typeof outcomes.points.mean === "number"
    ? outcomes.points.mean
    : null;

  return { played, wins, losses, finished, winRate, avgGuesses, avgScore, distRows, maxCount };
}

// Shape the full-roster API response ({ players:[{rank,username,gold,guesses,won,resigned,durationMs}], youRank, total })
// into rows ready to render, marking the viewer's own row. Pure — no DOM.
export function computeRosterView(full, me) {
  const players = (full && Array.isArray(full.players)) ? full.players : [];
  const rows = players.map((e) => ({
    rank: e.rank,
    username: e.username,
    gold: e.gold,
    guesses: e.guesses,
    won: !!e.won,
    durationMs: e.durationMs,
    isYou: e.username === me,
  }));
  return { rows, total: (full && typeof full.total === "number") ? full.total : rows.length };
}
