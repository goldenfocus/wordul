// public/lobby-view.js — pure lobby helpers (no DOM, no imports). Unit-tested in
// test/lobby-view.test.js. triesFor MUST stay in lockstep with server guessesFor
// (src/room.ts:85): Math.min(length + 1, 8).
export function triesFor(length) {
  return Math.min(length + 1, 8);
}

// Build the "Your table" seat model from a snapshot. Seat 0 is always "you";
// remaining joined players are "taken"; pad with "empty" up to capacity.
// capacity falls back to max(2, players.length) when the server didn't send one.
export function seatModel(snap, me) {
  const players = Array.isArray(snap && snap.players) ? snap.players : [];
  const capacity = Math.max(2, Number(snap && snap.capacity) || players.length || 2);
  const mine = players.find((p) => p && p.username === me);
  const others = players.filter((p) => p && p.username !== me);
  const seats = [];
  seats.push({ kind: "you", username: me, icon: null, ready: !!(mine && mine.ready) });
  for (const p of others) seats.push({ kind: "taken", username: p.username, isBot: !!p.isBot, ready: !!p.ready });
  while (seats.length < capacity) seats.push({ kind: "empty" });
  return { seats: seats.slice(0, Math.max(capacity, seats.length)), taken: players.length, capacity };
}

// Challenge rooms are solo-vs-ghosts (one DO per player): the seat strip shows the
// real ghost field, not the fictional 1/8 the default capacity would suggest.
export function ghostSeatModel(tape) {
  const ghosts = Array.isArray(tape && tape.players) ? tape.players : [];
  return {
    seats: [{ kind: "you" }, ...ghosts.map((g) => ({ kind: "ghost", username: g.username || "" }))],
    taken: 1 + ghosts.length,
    capacity: 1 + ghosts.length,
  };
}

// Map a server OpenGame to a compact floor-row's props. The row shows the board as
// letters×rows (e.g. 5×6); OpenGame has no maxGuesses, so rows = triesFor(wordLength)
// (the smart default — a host's set_rows override isn't carried in the open-games feed).
export function compactRowProps(game) {
  const tries = triesFor(game.wordLength);
  return {
    routePath: game.routePath,
    avatar: game.personaIcon,
    host: game.host,
    wordLength: game.wordLength,
    tries,
    dim: `${game.wordLength}×${tries}`,
    seats: game.seats || "1/2",
    edition: game.edition,
  };
}
