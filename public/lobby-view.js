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
  const others = players.filter((p) => p && p.username !== me);
  const seats = [];
  seats.push({ kind: "you", username: me, icon: null });
  for (const p of others) seats.push({ kind: "taken", username: p.username, isBot: !!p.isBot });
  while (seats.length < capacity) seats.push({ kind: "empty" });
  return { seats: seats.slice(0, Math.max(capacity, seats.length)), taken: players.length, capacity };
}

// Map a server OpenGame to a compact floor-row's props, adding ×T tries.
export function compactRowProps(game) {
  return {
    routePath: game.routePath,
    avatar: game.personaIcon,
    host: game.host,
    wordLength: game.wordLength,
    tries: triesFor(game.wordLength),
    seats: game.seats || "1/2",
    edition: game.edition,
  };
}
