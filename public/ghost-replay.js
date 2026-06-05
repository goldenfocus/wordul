// public/ghost-replay.js — pure ghost-tape replay math (no DOM), unit-tested in
// test/ghost-replay.test.js (the countdown.js pattern). A tape is the spectator-safe
// stream the original seeded race recorded: typing lengths, mask-only guess commits,
// finish stamps. app.js owns the clock + DOM; this module only answers "what does the
// field look like at elapsed t".

// Ghost player objects shaped like snapshot players, so the existing board renderer
// draws them unchanged. `word` is always "" — letters never exist in a tape.
export function ghostPlayersAt(tape, t) {
  const players = new Map(tape.players.map((p) => [p.username, {
    username: p.username, connected: true, status: "playing", guesses: [],
    points: 0, pointsSpent: 0, ready: false, role: "duelist",
    ghost: true, ghostHost: !!p.host, typingLen: 0,
  }]));
  for (const ev of tape.events) {
    if (ev.t > t) break; // events are recorded ascending
    const g = players.get(ev.u);
    if (!g) continue;
    if (ev.k === "typing") g.typingLen = ev.len;
    else if (ev.k === "guess") {
      g.guesses.push({ word: "", mask: ev.mask });
      g.typingLen = 0;
      g.status = ev.status;
    } else if (ev.k === "finish") {
      g.status = ev.status;
      g.typingLen = 0;
    }
  }
  return [...players.values()];
}

// Offset of the next event strictly after t, or null when the tape is exhausted.
export function nextEventAfter(tape, t) {
  for (const ev of tape.events) if (ev.t > t) return ev.t;
  return null;
}

// The host ghost's finish (the result to beat), or null on a truncated tape.
export function hostFinish(tape) {
  const host = tape.players.find((p) => p.host);
  if (!host) return null;
  for (const ev of tape.events) {
    if (ev.u === host.username && ev.k === "finish") {
      return { username: ev.u, t: ev.t, status: ev.status, guesses: ev.guesses };
    }
  }
  return null;
}
