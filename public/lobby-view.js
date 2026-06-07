// public/lobby-view.js — pure lobby helpers (no DOM, no imports). Unit-tested in
// test/lobby-view.test.js. triesFor MUST stay in lockstep with server guessesFor
// (src/room.ts:85): Math.min(length + 1, 8).
export function triesFor(length) {
  return Math.min(length + 1, 8);
}

// Build the "Your table" seat model from a snapshot. Seats hold the rotation roster only
// (duelists + queued, capped at capacity); spectators are excluded and surface as a
// `watching` count instead. Seat 0 is "you" — unless YOU are the spectator (iAmSpectator),
// in which case there is no you-seat and the strip shows the table you're watching.
// capacity falls back to max(2, seated) when the server didn't send one.
export function seatModel(snap, me) {
  const players = Array.isArray(snap && snap.players) ? snap.players : [];
  const seated = players.filter((p) => p && p.role !== "spectator");
  const watching = players.length - seated.length;
  const mine = players.find((p) => p && p.username === me);
  const iAmSpectator = !!(mine && mine.role === "spectator");
  const capacity = Math.max(2, Number(snap && snap.capacity) || seated.length || 2);
  const others = seated.filter((p) => p.username !== me);
  const seats = [];
  if (!iAmSpectator) seats.push({ kind: "you", username: me, icon: null, ready: !!(mine && mine.ready) });
  for (const p of others) seats.push({ kind: "taken", username: p.username, isBot: !!p.isBot, ready: !!p.ready });
  while (seats.length < capacity) seats.push({ kind: "empty" });
  return {
    seats: seats.slice(0, Math.max(capacity, seats.length)),
    taken: seats.filter((s) => s.kind !== "empty").length,
    capacity,
    watching,
    iAmSpectator,
  };
}

// Direct-manipulation capacity (Air skin, Jun 7): the dashed empty seat IS the
// control — no − n/m + stepper line. Tapping an empty seat's ＋ adds a chair;
// the LAST empty chair carries a small ✕ to take it back. Host-only (canEdit),
// and a spectator never edits even if host succession handed them the crown.
export function emptySeatActions(model, canEdit, { min = 2, max = 6 } = {}) {
  if (!canEdit || model.iAmSpectator) return { addable: false, removableIndex: -1 };
  const addable = model.capacity < max;
  let removableIndex = -1;
  if (model.capacity > Math.max(min, model.taken)) {
    for (let i = model.seats.length - 1; i >= 0; i--) {
      if (model.seats[i].kind === "empty") { removableIndex = i; break; }
    }
  }
  return { addable, removableIndex };
}

// The mobile rail pill's label — the "▸" arrow is markup, this is just the words.
export function railPillLabel(n) {
  const c = Number(n) || 0;
  return `${c} table${c === 1 ? "" : "s"} open`;
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

// Pinned "Your table" rail row (iter3 §1): the first row of the open-tables rail is YOUR
// room, built from the LIVE snapshot (never the /api/arena/open feed — it may exclude or
// lag your own room). Same shape as compactRowProps so the row renderer is shared; the
// seats string is what ticks 1/2 → 1/3 when ＋/✕ or a join lands.
export function yourTableRowProps(snap, me) {
  const model = seatModel(snap, me);
  const cols = Number(snap && snap.wordLength) || 5;
  const rows = Number(snap && snap.maxGuesses) || triesFor(cols);
  return {
    avatar: me ? me[0].toUpperCase() : "◆",
    host: "Your table",
    dim: `${cols}×${rows}`,
    seats: `${model.taken}/${model.capacity}`,
  };
}

// Join-sound decision (iter3 §1): chime only when ANOTHER player takes a seat while we
// wait in the lobby. prevOthers is the other-player count from the last render — null
// on the first paint (which includes my own join), so arriving in a busy room is silent.
// My own capacity taps move capacity, not the taken count, so they never ring either.
export function shouldChimeOnJoin(prevOthers, others, phase) {
  if (phase !== "lobby") return false;
  if (prevOthers == null) return false;
  return others > prevOthers;
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
