// public/profile-core.js — PURE view-model helpers for a public profile's "Recent games"
// list. No DOM, no fetch — unit-tested in test/profile-core.test.js. profile.js renders
// the markup from these.
//
// SPOILER RULES (mirror the home recap's invariant):
//   • The answer word is NEVER shown — the server already strips it (toPublicGame), and we
//     never read g.word here as a second layer.
//   • A player's board can only ever be drawn LETTERLESS (colors only), from solveGrid.
//   • TODAY's daily stays LOCKED (no colors at all) until the viewer has played today, so a
//     stranger's color pattern can't hint at the live answer. Past dailies + rooms are open.

// Turn a room slug ("snappy-moose") into a spaced Title Case label ("Snappy Moose").
export function prettyRoomLabel(slug) {
  return String(slug || "")
    .split("-")
    .filter(Boolean)
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(" ");
}

// Build the view-model for one recent game.
//   game: a PublicGameRecord ({ roomPath, result, guesses, solveGrid?, ... }) — NO word.
//   ctx:  { today: "YYYY-MM-DD", playedToday: boolean }
// Returns { kind, icon, label, result, date, grid, locked, roomHref }.
export function recentGameView(game, ctx = {}) {
  const { today = "", playedToday = false } = ctx;
  const roomPath = String(game.roomPath || "");
  const won = game.result === "won";
  const icon = won ? "✅" : "❌";
  const guesses = Number(game.guesses) || 0;
  const result = won ? `solved in ${guesses}` : "missed";

  if (roomPath.startsWith("daily/")) {
    const date = roomPath.slice("daily/".length);
    const isToday = date === today;
    const label = isToday ? "Daily" : `Daily · ${date}`;
    // Lock today's board until the viewer has played; withhold the colors while locked.
    const locked = isToday && !playedToday;
    const rawGrid = Array.isArray(game.solveGrid) ? game.solveGrid : null;
    return {
      kind: "daily", icon, label, result, date,
      grid: locked ? null : rawGrid,
      locked,
      roomHref: null,  // /@daily/<date> would render the VIEWER's own board — never link it
    };
  }

  // Room game: no stored letterless grid, so the only honest action is to open the room.
  const slug = roomPath.includes("/") ? roomPath.split("/")[1] || "" : roomPath;
  return {
    kind: "room", icon, label: prettyRoomLabel(slug), result, date: null,
    grid: null,
    locked: false,
    roomHref: roomPath ? `/@${roomPath}` : null,
  };
}
